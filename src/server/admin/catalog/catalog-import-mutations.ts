import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import type {
  CatalogImportDocument,
  CatalogImportProduct,
  CatalogImportVariant,
} from "@/server/admin/catalog/catalog-import";
import { requirePermission } from "@/server/auth/rbac";
import { getAuthRuntimeEnv } from "@/server/config/runtime-env";
import { getDb } from "@/server/db/client";
import { withSerializableRetry } from "@/server/orders/retry";

type Transaction = Prisma.TransactionClient;
type ImportMode = "preview" | "apply";

export type CatalogImportSummary = {
  rowCount: number;
  productCount: number;
  variantCount: number;
  productChangeCount: number;
  variantChangeCount: number;
  categoryAssignmentChangeCount: number;
  priceChangeCount: number;
  totalChangeCount: number;
  applied: boolean;
};

export type CatalogImportMutationResult =
  | { ok: true; summary: CatalogImportSummary; previewToken?: string }
  | {
      ok: false;
      reason:
        | "permission_changed"
        | "unknown_product"
        | "product_slug_changed"
        | "unknown_variant"
        | "variant_product_mismatch"
        | "unknown_category"
        | "sku_conflict"
        | "inventory_conflict"
        | "missing_active_variant"
        | "stale_preview";
      row: number | null;
      message: string;
    };

type CatalogImportFailure = Extract<CatalogImportMutationResult, { ok: false }>;

type ExistingProduct = {
  id: bigint;
  publicId: string;
  slug: string;
  title: string;
  status: string;
  publishedAt: Date | null;
  updatedAt: Date;
};

type ExistingVariant = {
  id: bigint;
  publicId: string;
  productId: bigint;
  title: string;
  sku: string | null;
  status: string;
  priceMode: string;
  optionValues: Prisma.JsonValue;
  trackInventory: boolean;
  position: number;
  publishedAt: Date | null;
  updatedAt: Date;
};

type ExistingPrice = {
  id: bigint;
  variantId: bigint;
  amountMinor: bigint;
  currency: string;
  kind: string;
  countryCode: string | null;
  taxInclusive: boolean;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  updatedAt: Date;
};

type LockedRevision = {
  id: string;
  revision: string;
};

type LockedRelationRevision = {
  leftId: string;
  rightId: string;
  revision: string;
};

type CatalogLockSnapshot = {
  products: LockedRevision[];
  variants: LockedRevision[];
  inventoryLevels: LockedRevision[];
  prices: LockedRevision[];
  categories: LockedRevision[];
  categoryAssignments: LockedRelationRevision[];
};

type ImportPlan = {
  productChanges: Array<{
    existing: ExistingProduct;
    desired: CatalogImportProduct;
  }>;
  variantChanges: Array<{
    existing: ExistingVariant;
    desired: CatalogImportVariant;
  }>;
  priceChanges: Array<{
    existing: ExistingVariant;
    desired: CatalogImportVariant;
  }>;
  categoryChanges: Array<{
    product: ExistingProduct;
    desiredCategoryIds: bigint[];
  }>;
};

type ImportPlanResult = {
  plan: ImportPlan;
  approvalFingerprint: string;
};

const TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 30_000,
} as const;

const PREVIEW_TOKEN_VERSION = "v1";
const PREVIEW_TOKEN_LIFETIME_MS = 15 * 60 * 1_000;
const PREVIEW_TOKEN_CLOCK_SKEW_MS = 5_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const TOKEN_TAG_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

type PreviewApproval = {
  expiresAt: number;
  stateTag: string;
};

function uuidList(values: readonly string[]) {
  return Prisma.join(values.map((value) => Prisma.sql`${value}::uuid`));
}

function safeTokenEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function approvalStateTag(approvalFingerprint: string) {
  return createHmac("sha256", getAuthRuntimeEnv().secret)
    .update(`catalog-import-state:${PREVIEW_TOKEN_VERSION}:${approvalFingerprint}`)
    .digest("base64url");
}

function approvalSignature(input: {
  actorUserId: string;
  sha256: string;
  expiresAt: number;
  stateTag: string;
}) {
  return createHmac("sha256", getAuthRuntimeEnv().secret)
    .update(
      [
        "catalog-import-preview",
        PREVIEW_TOKEN_VERSION,
        input.actorUserId,
        input.sha256,
        input.expiresAt.toString(),
        input.stateTag,
      ].join(":"),
    )
    .digest("base64url");
}

function createPreviewApprovalToken(input: {
  actorUserId: string;
  sha256: string;
  approvalFingerprint: string;
}) {
  const expiresAt = Date.now() + PREVIEW_TOKEN_LIFETIME_MS;
  const stateTag = approvalStateTag(input.approvalFingerprint);
  const signature = approvalSignature({
    actorUserId: input.actorUserId,
    sha256: input.sha256,
    expiresAt,
    stateTag,
  });
  return [PREVIEW_TOKEN_VERSION, expiresAt, stateTag, signature].join(".");
}

function readPreviewApprovalToken(
  token: string | undefined,
  input: { actorUserId: string; sha256: string },
): PreviewApproval | null {
  if (!token || token.length > 160 || !SHA256_PATTERN.test(input.sha256)) {
    return null;
  }
  const [version, expiresRaw, stateTag, signature, extra] = token.split(".");
  if (
    extra !== undefined ||
    version !== PREVIEW_TOKEN_VERSION ||
    !/^\d{13}$/u.test(expiresRaw) ||
    !TOKEN_TAG_PATTERN.test(stateTag) ||
    !TOKEN_TAG_PATTERN.test(signature)
  ) {
    return null;
  }

  const expiresAt = Number(expiresRaw);
  const now = Date.now();
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < now ||
    expiresAt > now + PREVIEW_TOKEN_LIFETIME_MS + PREVIEW_TOKEN_CLOCK_SKEW_MS
  ) {
    return null;
  }

  const expected = approvalSignature({
    actorUserId: input.actorUserId,
    sha256: input.sha256,
    expiresAt,
    stateTag,
  });
  return safeTokenEqual(expected, signature) ? { expiresAt, stateTag } : null;
}

function stableFingerprintJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "bigint") {
    return `{"$bigint":${JSON.stringify(value.toString())}}`;
  }
  if (value instanceof Date) {
    return `{"$date":${JSON.stringify(value.toISOString())}}`;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableFingerprintJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${stableFingerprintJson(item)}`,
      )
      .join(",")}}`;
  }
  throw new TypeError("Catalog approval fingerprint contained an unsupported value.");
}

function catalogApprovalFingerprint(
  locks: CatalogLockSnapshot,
  plan: ImportPlan,
) {
  const planIdentity = {
    products: plan.productChanges.map(({ existing }) => existing.publicId).sort(),
    variants: plan.variantChanges.map(({ existing }) => existing.publicId).sort(),
    prices: plan.priceChanges
      .map(({ existing }) => existing.publicId)
      .sort(),
    categories: plan.categoryChanges
      .map(({ product, desiredCategoryIds }) => ({
        productPublicId: product.publicId,
        desiredCategoryIds: desiredCategoryIds.map(String),
      }))
      .sort((left, right) =>
        left.productPublicId.localeCompare(right.productPublicId),
      ),
  };
  return createHash("sha256")
    .update(
      stableFingerprintJson({
        version: PREVIEW_TOKEN_VERSION,
        locks,
        plan: planIdentity,
      }),
    )
    .digest("hex");
}

async function actorStillCanImportCatalog(
  tx: Transaction,
  actorUserId: string,
) {
  const accounts = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT account."id"
    FROM "app"."users" AS account
    WHERE account."id" = ${actorUserId}::uuid
    FOR UPDATE OF account
  `;
  if (!accounts[0]) return false;

  const profiles = await tx.$queryRaw<Array<{ userId: string }>>`
    SELECT profile."user_id" AS "userId"
    FROM "app"."admin_profiles" AS profile
    WHERE profile."user_id" = ${actorUserId}::uuid
    FOR UPDATE OF profile
  `;
  if (!profiles[0]) return false;

  const rows = await tx.$queryRaw<Array<{ allowed: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM "app"."users" AS account
      INNER JOIN "app"."admin_profiles" AS profile
        ON profile."user_id" = account."id"
      INNER JOIN "app"."user_roles" AS assignment
        ON assignment."user_id" = account."id"
      INNER JOIN "app"."role_permissions" AS role_permission
        ON role_permission."role_id" = assignment."role_id"
      INNER JOIN "app"."permissions" AS permission
        ON permission."id" = role_permission."permission_id"
      WHERE account."id" = ${actorUserId}::uuid
        AND account."email_verified" = TRUE
        AND account."disabled_at" IS NULL
        AND profile."is_active" = TRUE
        AND permission."slug" = 'catalog.manage'
    ) AS "allowed"
  `;
  return rows[0]?.allowed === true;
}

async function acquireCatalogLocks(
  tx: Transaction,
  document: CatalogImportDocument,
): Promise<CatalogLockSnapshot> {
  const productPublicIds = document.products
    .map((product) => product.publicId)
    .sort();
  const productRows = await tx.$queryRaw<
    Array<{ id: bigint; revision: string }>
  >(Prisma.sql`
    SELECT product."id", product.xmin::text AS "revision"
    FROM "app"."products" AS product
    WHERE product."public_id" IN (${uuidList(productPublicIds)})
    ORDER BY product."public_id"
    FOR UPDATE OF product
  `);

  // Lock every live variant under each imported product. This makes the
  // product activation invariant stable even when the CSV intentionally
  // updates only a subset of an exported product's variants.
  const variantRows = await tx.$queryRaw<
    Array<{ id: bigint; revision: string }>
  >(Prisma.sql`
    SELECT variant."id", variant.xmin::text AS "revision"
    FROM "app"."product_variants" AS variant
    INNER JOIN "app"."products" AS product
      ON product."id" = variant."product_id"
    WHERE product."public_id" IN (${uuidList(productPublicIds)})
      AND variant."deleted_at" IS NULL
    ORDER BY variant."public_id"
    FOR UPDATE OF variant
  `);

  const variantPublicIds = document.products
    .flatMap((product) => product.variants.map((variant) => variant.publicId))
    .sort();
  let inventoryRows: Array<{ id: bigint; revision: string }> = [];
  let priceRows: Array<{ id: bigint; revision: string }> = [];
  if (variantPublicIds.length) {
    inventoryRows = await tx.$queryRaw<
      Array<{ id: bigint; revision: string }>
    >(Prisma.sql`
      SELECT level."id", level.xmin::text AS "revision"
      FROM "app"."inventory_levels" AS level
      INNER JOIN "app"."product_variants" AS variant
        ON variant."id" = level."variant_id"
      WHERE variant."public_id" IN (${uuidList(variantPublicIds)})
      ORDER BY level."id"
      FOR UPDATE OF level
    `);
    priceRows = await tx.$queryRaw<
      Array<{ id: bigint; revision: string }>
    >(Prisma.sql`
      SELECT price."id", price.xmin::text AS "revision"
      FROM "app"."prices" AS price
      INNER JOIN "app"."product_variants" AS variant
        ON variant."id" = price."variant_id"
      WHERE variant."public_id" IN (${uuidList(variantPublicIds)})
        AND price."currency" = 'USD'
        AND price."is_active" = TRUE
        AND price."deleted_at" IS NULL
      ORDER BY price."id"
      FOR UPDATE OF price
    `);
  }

  const categoryAssignmentRows = await tx.$queryRaw<
    Array<{
      productId: bigint;
      categoryId: bigint;
      revision: string;
    }>
  >(Prisma.sql`
    SELECT
      relation."product_id" AS "productId",
      relation."category_id" AS "categoryId",
      relation.xmin::text AS "revision"
    FROM "app"."product_categories" AS relation
    INNER JOIN "app"."products" AS product
      ON product."id" = relation."product_id"
    WHERE product."public_id" IN (${uuidList(productPublicIds)})
    ORDER BY relation."product_id", relation."position", relation."category_id"
    FOR UPDATE OF relation
  `);

  const categorySlugs = [...new Set(
    document.products.flatMap((product) => product.categorySlugs),
  )].sort();
  let categoryRows: Array<{ id: bigint; revision: string }> = [];
  if (categorySlugs.length) {
    categoryRows = await tx.$queryRaw<
      Array<{ id: bigint; revision: string }>
    >(Prisma.sql`
      SELECT category."id", category.xmin::text AS "revision"
      FROM "app"."categories" AS category
      WHERE category."slug" IN (${Prisma.join(categorySlugs)})
      ORDER BY category."slug"
      FOR UPDATE OF category
    `);
  }

  const revisionRows = (
    rows: Array<{ id: bigint; revision: string }>,
  ): LockedRevision[] =>
    rows.map((row) => ({ id: row.id.toString(), revision: row.revision }));
  return {
    products: revisionRows(productRows),
    variants: revisionRows(variantRows),
    inventoryLevels: revisionRows(inventoryRows),
    prices: revisionRows(priceRows),
    categories: revisionRows(categoryRows),
    categoryAssignments: categoryAssignmentRows.map((row) => ({
      leftId: row.productId.toString(),
      rightId: row.categoryId.toString(),
      revision: row.revision,
    })),
  };
}

function dateEqual(left: Date | null, right: Date | null) {
  return left?.getTime() === right?.getTime();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function productNeedsUpdate(
  existing: ExistingProduct,
  desired: CatalogImportProduct,
) {
  return (
    existing.title !== desired.title ||
    existing.status !== desired.status ||
    !dateEqual(existing.publishedAt, desired.publishedAt)
  );
}

function variantNeedsUpdate(
  existing: ExistingVariant,
  desired: CatalogImportVariant,
) {
  return (
    existing.title !== desired.title ||
    existing.sku !== desired.sku ||
    existing.status !== desired.status ||
    existing.priceMode !== desired.priceMode ||
    stableJson(existing.optionValues) !== stableJson(desired.optionValues) ||
    existing.trackInventory !== desired.trackInventory ||
    existing.position !== desired.position ||
    !dateEqual(existing.publishedAt, desired.publishedAt)
  );
}

function priceNeedsUpdate(
  prices: readonly ExistingPrice[],
  desired: CatalogImportVariant,
) {
  if (desired.priceMode === "ON_REQUEST") return prices.length > 0;
  return !(
    desired.amountMinor !== null &&
    prices.length === 1 &&
    prices[0].currency === "USD" &&
    prices[0].kind === "REGULAR" &&
    prices[0].countryCode === "US" &&
    prices[0].taxInclusive === false &&
    prices[0].isActive === true &&
    prices[0].startsAt === null &&
    prices[0].endsAt === null &&
    prices[0].amountMinor === desired.amountMinor
  );
}

function categoryIdsEqual(
  existing: readonly bigint[],
  desired: readonly bigint[],
) {
  return (
    existing.length === desired.length &&
    existing.every((id, index) => id === desired[index])
  );
}

function failure(
  reason: CatalogImportFailure["reason"],
  row: number | null,
  message: string,
): CatalogImportFailure {
  return { ok: false, reason, row, message };
}

async function readAndValidatePlan(
  tx: Transaction,
  document: CatalogImportDocument,
  locks: CatalogLockSnapshot,
): Promise<ImportPlanResult | CatalogImportFailure> {
  const productPublicIds = document.products.map((product) => product.publicId);
  const products = await tx.product.findMany({
    where: { publicId: { in: productPublicIds }, deletedAt: null },
    select: {
      id: true,
      publicId: true,
      slug: true,
      title: true,
      status: true,
      publishedAt: true,
      updatedAt: true,
    },
  });
  const productByPublicId = new Map(products.map((product) => [product.publicId, product]));
  for (const desired of document.products) {
    const existing = productByPublicId.get(desired.publicId);
    if (!existing) {
      return failure(
        "unknown_product",
        desired.row,
        "The product public ID no longer identifies an editable product.",
      );
    }
    if (existing.slug !== desired.slug) {
      return failure(
        "product_slug_changed",
        desired.row,
        "The product slug no longer matches this public ID. Export a fresh CSV.",
      );
    }
  }

  const productIds = products.map((product) => product.id);
  const variants = await tx.productVariant.findMany({
    where: { productId: { in: productIds }, deletedAt: null },
    select: {
      id: true,
      publicId: true,
      productId: true,
      title: true,
      sku: true,
      status: true,
      priceMode: true,
      optionValues: true,
      trackInventory: true,
      position: true,
      publishedAt: true,
      updatedAt: true,
    },
  });
  const variantByPublicId = new Map(variants.map((variant) => [variant.publicId, variant]));
  const desiredVariants = document.products.flatMap((product) =>
    product.variants.map((variant) => ({ product, variant })),
  );
  for (const { product, variant } of desiredVariants) {
    const existing = variantByPublicId.get(variant.publicId);
    if (!existing) {
      return failure(
        "unknown_variant",
        variant.row,
        "The variant public ID no longer identifies an editable variant.",
      );
    }
    if (existing.productId !== productByPublicId.get(product.publicId)!.id) {
      return failure(
        "variant_product_mismatch",
        variant.row,
        "The variant does not belong to the product public ID on this row.",
      );
    }
  }

  const categorySlugs = [...new Set(
    document.products.flatMap((product) => product.categorySlugs),
  )];
  const categories = categorySlugs.length
    ? await tx.category.findMany({
        where: { slug: { in: categorySlugs }, deletedAt: null },
        select: { id: true, slug: true },
      })
    : [];
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));
  for (const desired of document.products) {
    if (desired.categorySlugs.some((slug) => !categoryBySlug.has(slug))) {
      return failure(
        "unknown_category",
        desired.row,
        "A category slug no longer identifies an editable category.",
      );
    }
  }

  const desiredSkus = desiredVariants.flatMap(({ variant }) =>
    variant.sku ? [variant.sku] : [],
  );
  if (desiredSkus.length) {
    const importedVariantIds = desiredVariants.map(({ variant }) => variant.publicId);
    const conflict = await tx.productVariant.findFirst({
      where: {
        sku: { in: desiredSkus },
        publicId: { notIn: importedVariantIds },
      },
      select: { sku: true },
    });
    if (conflict?.sku) {
      const row = desiredVariants.find(({ variant }) => variant.sku === conflict.sku)?.variant.row;
      return failure(
        "sku_conflict",
        row ?? null,
        "A SKU is already reserved by another current or archived variant.",
      );
    }
  }

  const importedVariantIds = desiredVariants.map(({ variant }) =>
    variantByPublicId.get(variant.publicId)!.id,
  );
  const inventoryLevels = importedVariantIds.length
    ? await tx.inventoryLevel.findMany({
        where: { variantId: { in: importedVariantIds }, reservedQuantity: { gt: 0 } },
        select: { variantId: true, reservedQuantity: true },
      })
    : [];
  const variantsWithReservations = new Set(
    inventoryLevels.map((level) => level.variantId.toString()),
  );
  for (const { variant } of desiredVariants) {
    const existing = variantByPublicId.get(variant.publicId)!;
    if (
      !variant.trackInventory &&
      variantsWithReservations.has(existing.id.toString())
    ) {
      return failure(
        "inventory_conflict",
        variant.row,
        "Inventory tracking cannot be disabled while units are reserved for orders.",
      );
    }
  }

  const desiredVariantById = new Map(
    desiredVariants.map(({ variant }) => [variant.publicId, variant]),
  );
  for (const desiredProduct of document.products) {
    if (desiredProduct.status !== "ACTIVE") continue;
    const productId = productByPublicId.get(desiredProduct.publicId)!.id;
    const hasActiveVariant = variants.some((existing) => {
      if (existing.productId !== productId) return false;
      const desired = desiredVariantById.get(existing.publicId);
      return (desired?.status ?? existing.status) === "ACTIVE";
    });
    if (!hasActiveVariant) {
      return failure(
        "missing_active_variant",
        desiredProduct.row,
        "An active product must retain at least one active variant.",
      );
    }
  }

  const prices = importedVariantIds.length
    ? await tx.price.findMany({
        where: {
          variantId: { in: importedVariantIds },
          currency: "USD",
          isActive: true,
          deletedAt: null,
        },
        select: {
          id: true,
          variantId: true,
          amountMinor: true,
          currency: true,
          kind: true,
          countryCode: true,
          taxInclusive: true,
          isActive: true,
          startsAt: true,
          endsAt: true,
          updatedAt: true,
        },
      })
    : [];
  const pricesByVariant = new Map<string, ExistingPrice[]>();
  for (const price of prices) {
    const key = price.variantId.toString();
    const list = pricesByVariant.get(key) ?? [];
    list.push(price);
    pricesByVariant.set(key, list);
  }

  const categoryRelations = await tx.productCategory.findMany({
    where: { productId: { in: productIds } },
    orderBy: [{ productId: "asc" }, { position: "asc" }, { categoryId: "asc" }],
    select: { productId: true, categoryId: true },
  });
  const categoriesByProduct = new Map<string, bigint[]>();
  for (const relation of categoryRelations) {
    const key = relation.productId.toString();
    const list = categoriesByProduct.get(key) ?? [];
    list.push(relation.categoryId);
    categoriesByProduct.set(key, list);
  }

  const productChanges = document.products.flatMap((desired) => {
    const existing = productByPublicId.get(desired.publicId)!;
    return productNeedsUpdate(existing, desired) ? [{ existing, desired }] : [];
  });
  const variantChanges = desiredVariants.flatMap(({ variant: desired }) => {
    const existing = variantByPublicId.get(desired.publicId)!;
    return variantNeedsUpdate(existing, desired) ? [{ existing, desired }] : [];
  });
  const priceChanges = desiredVariants.flatMap(({ variant: desired }) => {
    const existing = variantByPublicId.get(desired.publicId)!;
    return priceNeedsUpdate(pricesByVariant.get(existing.id.toString()) ?? [], desired)
      ? [{ existing, desired }]
      : [];
  });
  const categoryChanges = document.products.flatMap((desired) => {
    const product = productByPublicId.get(desired.publicId)!;
    const desiredCategoryIds = desired.categorySlugs.map(
      (slug) => categoryBySlug.get(slug)!.id,
    );
    const existingCategoryIds = categoriesByProduct.get(product.id.toString()) ?? [];
    return categoryIdsEqual(existingCategoryIds, desiredCategoryIds)
      ? []
      : [{ product, desiredCategoryIds }];
  });

  const plan: ImportPlan = {
    productChanges,
    variantChanges,
    priceChanges,
    categoryChanges,
  };
  return {
    plan,
    approvalFingerprint: catalogApprovalFingerprint(locks, plan),
  };
}

function databaseStatus(status: "DRAFT" | "ACTIVE" | "ARCHIVED") {
  return status.toLowerCase();
}

function databasePriceMode(mode: "FIXED" | "ON_REQUEST") {
  return mode.toLowerCase();
}

async function applyPlan(
  tx: Transaction,
  plan: ImportPlan,
) {
  const skuChanges = plan.variantChanges.filter(
    ({ existing, desired }) => existing.sku !== desired.sku,
  );
  if (skuChanges.length) {
    await tx.productVariant.updateMany({
      where: { id: { in: skuChanges.map(({ existing }) => existing.id) } },
      data: { sku: null },
    });
  }

  if (plan.variantChanges.length) {
    const payload = JSON.stringify(
      plan.variantChanges.map(({ existing, desired }) => ({
        id: existing.id.toString(),
        title: desired.title,
        sku: desired.sku,
        status: databaseStatus(desired.status),
        priceMode: databasePriceMode(desired.priceMode),
        optionValues: desired.optionValues,
        trackInventory: desired.trackInventory,
        position: desired.position,
        publishedAt: desired.publishedAt?.toISOString() ?? null,
      })),
    );
    const updated = await tx.$executeRaw(Prisma.sql`
      WITH desired AS (
        SELECT *
        FROM jsonb_to_recordset(${payload}::jsonb) AS input(
          "id" bigint,
          "title" text,
          "sku" text,
          "status" text,
          "priceMode" text,
          "optionValues" jsonb,
          "trackInventory" boolean,
          "position" integer,
          "publishedAt" timestamptz
        )
      )
      UPDATE "app"."product_variants" AS variant
      SET
        "title" = desired."title",
        "sku" = desired."sku",
        "status" = desired."status"::"app"."catalog_status",
        "price_mode" = desired."priceMode"::"app"."price_mode",
        "option_values" = desired."optionValues",
        "track_inventory" = desired."trackInventory",
        "position" = desired."position",
        "published_at" = desired."publishedAt",
        "updated_at" = CURRENT_TIMESTAMP
      FROM desired
      WHERE variant."id" = desired."id"
    `);
    if (updated !== plan.variantChanges.length) {
      throw new Error("Catalog import variant update count changed after locking.");
    }
  }

  if (plan.priceChanges.length) {
    const variantIds = plan.priceChanges.map(({ existing }) => existing.id);
    await tx.price.updateMany({
      where: {
        variantId: { in: variantIds },
        currency: "USD",
        isActive: true,
        deletedAt: null,
      },
      data: { isActive: false },
    });
    const fixedPrices = plan.priceChanges.flatMap(({ existing, desired }) =>
      desired.priceMode === "FIXED" && desired.amountMinor !== null
        ? [{
            variantId: existing.id,
            currency: "USD",
            kind: "REGULAR" as const,
            amountMinor: desired.amountMinor,
            countryCode: "US",
            taxInclusive: false,
            isActive: true,
            startsAt: null,
            endsAt: null,
          }]
        : [],
    );
    if (fixedPrices.length) await tx.price.createMany({ data: fixedPrices });
  }

  if (plan.categoryChanges.length) {
    const productIds = plan.categoryChanges.map(({ product }) => product.id);
    await tx.productCategory.deleteMany({ where: { productId: { in: productIds } } });
    const assignments = plan.categoryChanges.flatMap(({ product, desiredCategoryIds }) =>
      desiredCategoryIds.map((categoryId, position) => ({
        productId: product.id,
        categoryId,
        position,
      })),
    );
    if (assignments.length) await tx.productCategory.createMany({ data: assignments });
  }

  if (plan.productChanges.length) {
    const payload = JSON.stringify(
      plan.productChanges.map(({ existing, desired }) => ({
        id: existing.id.toString(),
        title: desired.title,
        status: databaseStatus(desired.status),
        publishedAt: desired.publishedAt?.toISOString() ?? null,
      })),
    );
    const updated = await tx.$executeRaw(Prisma.sql`
      WITH desired AS (
        SELECT *
        FROM jsonb_to_recordset(${payload}::jsonb) AS input(
          "id" bigint,
          "title" text,
          "status" text,
          "publishedAt" timestamptz
        )
      )
      UPDATE "app"."products" AS product
      SET
        "title" = desired."title",
        "status" = desired."status"::"app"."catalog_status",
        "published_at" = desired."publishedAt",
        "updated_at" = CURRENT_TIMESTAMP
      FROM desired
      WHERE product."id" = desired."id"
    `);
    if (updated !== plan.productChanges.length) {
      throw new Error("Catalog import product update count changed after locking.");
    }
  }
}

export async function processAdminCatalogImport(
  document: CatalogImportDocument,
  input: { mode: ImportMode; sha256: string; previewToken?: string },
): Promise<CatalogImportMutationResult> {
  const authorization = await requirePermission("catalog.manage", "/admin/catalog/import");
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      if (!(await actorStillCanImportCatalog(tx, actorUserId))) {
        return failure(
          "permission_changed",
          null,
          "Catalog permission changed before the import could be processed.",
        );
      }
      if (!SHA256_PATTERN.test(input.sha256)) {
        return failure(
          "stale_preview",
          null,
          "The catalog preview approval is invalid or stale. Preview this exact file again.",
        );
      }
      const approval = input.mode === "apply"
        ? readPreviewApprovalToken(input.previewToken, {
            actorUserId,
            sha256: input.sha256,
          })
        : null;
      if (input.mode === "apply" && !approval) {
        return failure(
          "stale_preview",
          null,
          "The catalog preview approval is invalid or stale. Preview this exact file again.",
        );
      }

      const locks = await acquireCatalogLocks(tx, document);
      const planned = await readAndValidatePlan(tx, document, locks);
      if ("ok" in planned) {
        return input.mode === "apply"
          ? failure(
              "stale_preview",
              null,
              "Catalog state changed after preview. Preview this exact file again before applying.",
            )
          : planned;
      }
      const { plan, approvalFingerprint } = planned;
      if (
        input.mode === "apply" &&
        approval &&
        (approval.expiresAt < Date.now() ||
          !safeTokenEqual(
            approval.stateTag,
            approvalStateTag(approvalFingerprint),
          ))
      ) {
        return failure(
          "stale_preview",
          null,
          "Catalog state changed after preview. Preview this exact file again before applying.",
        );
      }

      const totalChangeCount =
        plan.productChanges.length +
        plan.variantChanges.length +
        plan.categoryChanges.length +
        plan.priceChanges.length;
      const summary: CatalogImportSummary = {
        rowCount: document.rowCount,
        productCount: document.products.length,
        variantCount: document.variantCount,
        productChangeCount: plan.productChanges.length,
        variantChangeCount: plan.variantChanges.length,
        categoryAssignmentChangeCount: plan.categoryChanges.length,
        priceChangeCount: plan.priceChanges.length,
        totalChangeCount,
        applied: input.mode === "apply" && totalChangeCount > 0,
      };

      if (input.mode === "preview") {
        return {
          ok: true as const,
          summary,
          previewToken: createPreviewApprovalToken({
            actorUserId,
            sha256: input.sha256,
            approvalFingerprint,
          }),
        };
      }
      if (totalChangeCount === 0) {
        return { ok: true as const, summary };
      }

      await applyPlan(tx, plan);
      const auditCounts = {
        sha256: input.sha256,
        rowCount: document.rowCount,
        productCount: document.products.length,
        variantCount: document.variantCount,
      };
      const changeCounts = {
        ...auditCounts,
        productChangeCount: plan.productChanges.length,
        variantChangeCount: plan.variantChanges.length,
        categoryAssignmentChangeCount: plan.categoryChanges.length,
        priceChangeCount: plan.priceChanges.length,
        totalChangeCount,
      };
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "catalog.import.apply",
        resourceType: "catalog_import",
        resourceId: input.sha256,
        before: auditCounts,
        after: changeCounts,
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "catalog_import",
          aggregateId: input.sha256,
          eventType: "catalog.import.applied",
          payload: changeCounts,
        },
        select: { id: true },
      });
      return { ok: true as const, summary };
    }, TRANSACTION_OPTIONS),
  );
}
