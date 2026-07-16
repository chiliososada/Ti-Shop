import "server-only";

import { realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

import {
  MediaKind,
  Prisma,
  ProductMediaRole,
} from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import type {
  CategoryAssignmentFormInput,
  CategoryFormInput,
  CreateCategoryFormInput,
  CreateProductFormInput,
  CreateProductMediaFormInput,
  CreateVariantFormInput,
  DetachProductMediaFormInput,
  ProductFormInput,
  UpdateProductMediaFormInput,
  VariantFormInput,
  VariantPriceFormInput,
} from "@/server/admin/catalog/validators";
import { normalizeCatalogMediaSource } from "@/server/admin/catalog/validators";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { withSerializableRetry } from "@/server/orders/retry";

const productAuditSelect = {
  publicId: true,
  slug: true,
  title: true,
  subtitle: true,
  shortDescription: true,
  description: true,
  brand: true,
  purity: true,
  casNumber: true,
  appearance: true,
  storageInstructions: true,
  status: true,
  isFeatured: true,
  position: true,
  publishedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const categoryAuditSelect = {
  publicId: true,
  slug: true,
  name: true,
  description: true,
  status: true,
  position: true,
  publishedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const variantAuditSelect = {
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
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  prices: {
    where: { currency: "USD", deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      publicId: true,
      amountMinor: true,
      currency: true,
      kind: true,
      countryCode: true,
      taxInclusive: true,
      isActive: true,
      startsAt: true,
      endsAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.ProductVariantSelect;

const productRefreshBaseSelect = {
  slug: true,
  isFeatured: true,
} as const;

const mediaAuditSelect = {
  publicId: true,
  kind: true,
  storageProvider: true,
  storageKey: true,
  publicUrl: true,
  altText: true,
  isPrivate: true,
  deletedAt: true,
  updatedAt: true,
} as const;

const productMediaAuditSelect = {
  id: true,
  role: true,
  position: true,
  variant: { select: { publicId: true } },
  media: { select: { id: true, ...mediaAuditSelect } },
} satisfies Prisma.ProductMediaSelect;

function serializable<T>(operation: () => Promise<T>) {
  return withSerializableRetry(operation);
}

function transactionOptions() {
  return {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 15_000,
  } as const;
}

async function writeCatalogOutbox(
  tx: Prisma.TransactionClient,
  input: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Prisma.InputJsonObject;
  },
) {
  await tx.outboxEvent.create({ data: input, select: { id: true } });
}

type ProductRefreshState = {
  slug: string;
  isFeatured: boolean;
  categorySlugs: string[];
  hasPlacement: boolean;
};

async function readProductRefreshState(
  tx: Prisma.TransactionClient,
  productId: bigint,
  base?: { slug: string; isFeatured: boolean },
): Promise<ProductRefreshState> {
  const product =
    base ??
    (await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: productRefreshBaseSelect,
    }));
  // Keep these relation reads sequential. Prisma 7's query-plan interpreter
  // can otherwise issue sibling relation queries concurrently on one pg
  // transaction client, which pg 9 will reject.
  const categories = await tx.productCategory.findMany({
    where: { productId },
    orderBy: [{ position: "asc" }, { categoryId: "asc" }],
    select: { category: { select: { slug: true } } },
  });
  const placement = await tx.merchandisingPlacement.findFirst({
    where: { productId },
    select: { id: true },
  });

  return {
    slug: product.slug,
    isFeatured: product.isFeatured,
    categorySlugs: categories.map(({ category }) => category.slug),
    hasPlacement: placement !== null,
  };
}

function productRefreshResult(publicId: string, product: ProductRefreshState) {
  return {
    publicId,
    productPublicId: publicId,
    slug: product.slug,
    categorySlugs: product.categorySlugs,
    refreshHome: product.isFeatured || product.hasPlacement,
  };
}

async function syncUsdPrice(
  tx: Prisma.TransactionClient,
  variantId: bigint,
  priceMode: "FIXED" | "ON_REQUEST",
  amountMinor: bigint | null,
) {
  await tx.price.updateMany({
    where: {
      variantId,
      currency: "USD",
      isActive: true,
      deletedAt: null,
    },
    data: { isActive: false },
  });

  if (priceMode === "FIXED") {
    if (amountMinor === null) return false;
    await tx.price.create({
      data: {
        variantId,
        currency: "USD",
        kind: "REGULAR",
        amountMinor,
        countryCode: "US",
        taxInclusive: false,
        isActive: true,
        startsAt: null,
        endsAt: null,
      },
      select: { id: true },
    });
  }
  return true;
}

function isRoleCompatible(kind: MediaKind, role: ProductMediaRole) {
  return (
    (kind === MediaKind.IMAGE &&
      ( [
        ProductMediaRole.PRIMARY,
        ProductMediaRole.GALLERY,
        ProductMediaRole.SWATCH,
      ] as ProductMediaRole[]).includes(role)) ||
    (kind === MediaKind.VIDEO && role === ProductMediaRole.VIDEO) ||
    (kind === MediaKind.DOCUMENT && role === ProductMediaRole.DOCUMENT)
  );
}

async function ensureLocalPublicFile(source: string) {
  if (!source.startsWith("/")) return true;
  try {
    const publicRoot = await realpath(resolve(process.cwd(), "public"));
    const candidate = resolve(publicRoot, source.slice(1));
    const candidateRealPath = await realpath(candidate);
    if (
      candidateRealPath !== publicRoot &&
      !candidateRealPath.startsWith(`${publicRoot}${sep}`)
    ) {
      return false;
    }
    return (await stat(candidateRealPath)).isFile();
  } catch {
    return false;
  }
}

export async function createAdminProduct(input: CreateProductFormInput) {
  const authorization = await requirePermission("catalog.manage", "/admin/catalog");
  return serializable(() =>
    getDb().$transaction(async (tx) => {
      if (await tx.product.findUnique({ where: { slug: input.slug }, select: { id: true } })) {
        return { ok: false as const, reason: "slug_conflict" as const };
      }
      const after = await tx.product.create({
        data: {
          slug: input.slug,
          title: input.title,
          position: input.position,
          status: "DRAFT",
          publishedAt: null,
          dataQualityStatus: "REVIEW_REQUIRED",
        },
        select: productAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "catalog.product.create",
        resourceType: "product",
        resourceId: after.publicId,
        before: { exists: false },
        after,
      });
      await writeCatalogOutbox(tx, {
        aggregateType: "product",
        aggregateId: after.publicId,
        eventType: "catalog.product.created",
        payload: { publicId: after.publicId, slug: after.slug, status: after.status },
      });
      return {
        ok: true as const,
        publicId: after.publicId,
        productPublicId: after.publicId,
        slug: after.slug,
        categorySlugs: [] as string[],
        refreshHome: false,
      };
    }, transactionOptions()),
  );
}

export async function updateAdminProduct(input: ProductFormInput) {
  const authorization = await requirePermission(
    "catalog.manage",
    `/admin/catalog/products/${input.publicId}`,
  );
  return serializable(() =>
    getDb().$transaction(async (tx) => {
      const existing = await tx.product.findFirst({
        where: { publicId: input.publicId, deletedAt: null },
        select: {
          id: true,
          ...productAuditSelect,
        },
      });
      if (!existing) return { ok: false as const, reason: "not_found" as const };
      const refreshState = await readProductRefreshState(tx, existing.id, existing);
      const activeVariant = await tx.productVariant.findFirst({
        where: {
          productId: existing.id,
          deletedAt: null,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      if (input.status === "ACTIVE" && activeVariant === null) {
        return { ok: false as const, reason: "missing_active_variant" as const };
      }

      const after = await tx.product.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          subtitle: input.subtitle,
          shortDescription: input.shortDescription,
          description: input.description,
          brand: input.brand,
          purity: input.purity,
          casNumber: input.casNumber,
          appearance: input.appearance,
          storageInstructions: input.storageInstructions,
          status: input.status,
          isFeatured: input.isFeatured,
          position: input.position,
          publishedAt: input.publishedAt,
        },
        select: productAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "catalog.product.update",
        resourceType: "product",
        resourceId: input.publicId,
        before: existing,
        after,
      });
      await writeCatalogOutbox(tx, {
        aggregateType: "product",
        aggregateId: input.publicId,
        eventType:
          after.status === "ARCHIVED"
            ? "catalog.product.archived"
            : "catalog.product.updated",
        payload: {
          publicId: input.publicId,
          slug: after.slug,
          statusBefore: existing.status,
          statusAfter: after.status,
        },
      });
      return {
        ok: true as const,
        ...productRefreshResult(input.publicId, refreshState),
        refreshHome:
          input.isFeatured || existing.isFeatured || refreshState.hasPlacement,
      };
    }, transactionOptions()),
  );
}

export async function createAdminCategory(input: CreateCategoryFormInput) {
  const authorization = await requirePermission("catalog.manage", "/admin/catalog");
  return serializable(() =>
    getDb().$transaction(async (tx) => {
      if (await tx.category.findUnique({ where: { slug: input.slug }, select: { id: true } })) {
        return { ok: false as const, reason: "slug_conflict" as const };
      }
      const after = await tx.category.create({
        data: {
          slug: input.slug,
          name: input.name,
          position: input.position,
          status: "DRAFT",
          publishedAt: null,
        },
        select: categoryAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "catalog.category.create",
        resourceType: "category",
        resourceId: after.publicId,
        before: { exists: false },
        after,
      });
      await writeCatalogOutbox(tx, {
        aggregateType: "category",
        aggregateId: after.publicId,
        eventType: "catalog.category.created",
        payload: { publicId: after.publicId, slug: after.slug, status: after.status },
      });
      return { ok: true as const, publicId: after.publicId, slug: after.slug };
    }, transactionOptions()),
  );
}

export async function updateAdminCategory(input: CategoryFormInput) {
  const authorization = await requirePermission(
    "catalog.manage",
    `/admin/catalog/categories/${input.publicId}`,
  );
  return serializable(() =>
    getDb().$transaction(async (tx) => {
      const existing = await tx.category.findFirst({
        where: { publicId: input.publicId, deletedAt: null },
        select: {
          id: true,
          ...categoryAuditSelect,
          products: { select: { product: { select: { slug: true } } } },
        },
      });
      if (!existing) return { ok: false as const, reason: "not_found" as const };
      const after = await tx.category.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          description: input.description,
          status: input.status,
          position: input.position,
          publishedAt: input.publishedAt,
        },
        select: categoryAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "catalog.category.update",
        resourceType: "category",
        resourceId: input.publicId,
        before: existing,
        after,
      });
      await writeCatalogOutbox(tx, {
        aggregateType: "category",
        aggregateId: input.publicId,
        eventType:
          after.status === "ARCHIVED"
            ? "catalog.category.archived"
            : "catalog.category.updated",
        payload: {
          publicId: input.publicId,
          slug: after.slug,
          statusBefore: existing.status,
          statusAfter: after.status,
        },
      });
      return {
        ok: true as const,
        publicId: input.publicId,
        slug: existing.slug,
        productSlugs: existing.products.map(({ product }) => product.slug),
      };
    }, transactionOptions()),
  );
}

export async function createAdminVariant(input: CreateVariantFormInput) {
  const authorization = await requirePermission(
    "catalog.manage",
    `/admin/catalog/products/${input.productPublicId}`,
  );
  return serializable(() =>
    getDb().$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { publicId: input.productPublicId, deletedAt: null },
        select: { id: true, ...productRefreshBaseSelect },
      });
      if (!product) return { ok: false as const, reason: "not_found" as const };
      if (
        input.sku &&
        (await tx.productVariant.findUnique({ where: { sku: input.sku }, select: { id: true } }))
      ) {
        return { ok: false as const, reason: "sku_conflict" as const };
      }
      if (input.priceMode === "FIXED" && input.amountMinor === null) {
        return { ok: false as const, reason: "invalid_price" as const };
      }
      const created = await tx.productVariant.create({
        data: {
          productId: product.id,
          title: input.title,
          sku: input.sku,
          status: input.status,
          priceMode: input.priceMode,
          optionValues: input.optionValues,
          trackInventory: input.trackInventory,
          position: input.position,
          publishedAt: input.publishedAt,
        },
        select: { id: true, publicId: true },
      });
      await syncUsdPrice(tx, created.id, input.priceMode, input.amountMinor);
      const after = await tx.productVariant.findUniqueOrThrow({
        where: { id: created.id },
        select: variantAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "catalog.variant.create",
        resourceType: "product_variant",
        resourceId: created.publicId,
        before: { exists: false },
        after,
      });
      await writeCatalogOutbox(tx, {
        aggregateType: "product_variant",
        aggregateId: created.publicId,
        eventType: "catalog.variant.created",
        payload: {
          publicId: created.publicId,
          productPublicId: input.productPublicId,
          status: after.status,
          priceMode: after.priceMode,
        },
      });
      return {
        ok: true as const,
        variantPublicId: created.publicId,
        ...productRefreshResult(
          input.productPublicId,
          await readProductRefreshState(tx, product.id, product),
        ),
      };
    }, transactionOptions()),
  );
}

export async function updateAdminVariant(input: VariantFormInput) {
  const authorization = await requirePermission(
    "catalog.manage",
    `/admin/catalog/products/${input.productPublicId}`,
  );
  return serializable(() =>
    getDb().$transaction(async (tx) => {
      const existing = await tx.productVariant.findFirst({
        where: {
          publicId: input.variantPublicId,
          deletedAt: null,
          product: { publicId: input.productPublicId, deletedAt: null },
        },
        select: {
          id: true,
          ...variantAuditSelect,
        },
      });
      if (!existing) return { ok: false as const, reason: "not_found" as const };
      if (
        input.sku &&
        (await tx.productVariant.findFirst({
          where: { sku: input.sku, id: { not: existing.id } },
          select: { id: true },
        }))
      ) {
        return { ok: false as const, reason: "sku_conflict" as const };
      }
      if (!input.trackInventory) {
        const reservedLevels = await tx.inventoryLevel.count({
          where: { variantId: existing.id, reservedQuantity: { gt: 0 } },
        });
        if (reservedLevels > 0) {
          return { ok: false as const, reason: "inventory_conflict" as const };
        }
      }
      if (input.priceMode === "FIXED" && input.amountMinor === null) {
        return { ok: false as const, reason: "invalid_price" as const };
      }
      await tx.productVariant.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          sku: input.sku,
          status: input.status,
          priceMode: input.priceMode,
          optionValues: input.optionValues,
          trackInventory: input.trackInventory,
          position: input.position,
          publishedAt: input.publishedAt,
        },
        select: { id: true },
      });
      await syncUsdPrice(tx, existing.id, input.priceMode, input.amountMinor);
      const after = await tx.productVariant.findUniqueOrThrow({
        where: { id: existing.id },
        select: variantAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "catalog.variant.update",
        resourceType: "product_variant",
        resourceId: input.variantPublicId,
        before: existing,
        after,
      });
      await writeCatalogOutbox(tx, {
        aggregateType: "product_variant",
        aggregateId: input.variantPublicId,
        eventType:
          after.status === "ARCHIVED"
            ? "catalog.variant.archived"
            : "catalog.variant.updated",
        payload: {
          publicId: input.variantPublicId,
          productPublicId: input.productPublicId,
          statusBefore: existing.status,
          statusAfter: after.status,
          priceMode: after.priceMode,
        },
      });
      return {
        ok: true as const,
        variantPublicId: input.variantPublicId,
        ...productRefreshResult(
          input.productPublicId,
          await readProductRefreshState(tx, existing.productId),
        ),
      };
    }, transactionOptions()),
  );
}

export async function updateAdminVariantPrice(input: VariantPriceFormInput) {
  const authorization = await requirePermission(
    "catalog.manage",
    `/admin/catalog/products/${input.productPublicId}`,
  );
  return serializable(() =>
    getDb().$transaction(async (tx) => {
      const existing = await tx.productVariant.findFirst({
        where: {
          publicId: input.variantPublicId,
          product: { publicId: input.productPublicId, deletedAt: null },
          deletedAt: null,
        },
        select: {
          id: true,
          ...variantAuditSelect,
        },
      });
      if (!existing) return { ok: false as const, reason: "not_found" as const };
      if (input.priceMode === "FIXED" && input.amountMinor === null) {
        return { ok: false as const, reason: "invalid_price" as const };
      }
      await tx.productVariant.update({
        where: { id: existing.id },
        data: { priceMode: input.priceMode },
      });
      await syncUsdPrice(tx, existing.id, input.priceMode, input.amountMinor);
      const after = await tx.productVariant.findUniqueOrThrow({
        where: { id: existing.id },
        select: variantAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "catalog.variant.price.update",
        resourceType: "product_variant",
        resourceId: input.variantPublicId,
        before: existing,
        after,
      });
      await writeCatalogOutbox(tx, {
        aggregateType: "product_variant",
        aggregateId: input.variantPublicId,
        eventType: "catalog.variant.price_updated",
        payload: {
          publicId: input.variantPublicId,
          productPublicId: input.productPublicId,
          priceMode: after.priceMode,
          amountMinor: input.amountMinor?.toString() ?? null,
          currency: "USD",
        },
      });
      return {
        ok: true as const,
        ...productRefreshResult(
          input.productPublicId,
          await readProductRefreshState(tx, existing.productId),
        ),
      };
    }, transactionOptions()),
  );
}

export async function updateAdminProductCategories(
  input: CategoryAssignmentFormInput,
) {
  const authorization = await requirePermission(
    "catalog.manage",
    `/admin/catalog/products/${input.productPublicId}`,
  );
  return serializable(() =>
    getDb().$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { publicId: input.productPublicId, deletedAt: null },
        select: {
          id: true,
          ...productRefreshBaseSelect,
        },
      });
      if (!product) return { ok: false as const, reason: "not_found" as const };
      const existingCategories = await tx.productCategory.findMany({
        where: { productId: product.id },
        orderBy: [{ position: "asc" }, { categoryId: "asc" }],
        select: {
          position: true,
          category: { select: { publicId: true, slug: true, name: true } },
        },
      });
      const categories = await tx.category.findMany({
        where: { publicId: { in: input.categoryPublicIds }, deletedAt: null },
        select: { id: true, publicId: true, slug: true, name: true },
      });
      if (categories.length !== input.categoryPublicIds.length) {
        return { ok: false as const, reason: "category_not_found" as const };
      }
      const byPublicId = new Map(categories.map((category) => [category.publicId, category]));
      const orderedPublicIds = input.primaryCategoryPublicId
        ? [
            input.primaryCategoryPublicId,
            ...input.categoryPublicIds.filter(
              (publicId) => publicId !== input.primaryCategoryPublicId,
            ),
          ]
        : [];
      await tx.productCategory.deleteMany({ where: { productId: product.id } });
      if (orderedPublicIds.length) {
        await tx.productCategory.createMany({
          data: orderedPublicIds.map((publicId, position) => ({
            productId: product.id,
            categoryId: byPublicId.get(publicId)!.id,
            position,
          })),
        });
      }
      const after = orderedPublicIds.map((publicId, position) => ({
        publicId,
        slug: byPublicId.get(publicId)!.slug,
        name: byPublicId.get(publicId)!.name,
        position,
        primary: position === 0,
      }));
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "catalog.product.categories.update",
        resourceType: "product",
        resourceId: input.productPublicId,
        before: existingCategories,
        after,
      });
      await writeCatalogOutbox(tx, {
        aggregateType: "product",
        aggregateId: input.productPublicId,
        eventType: "catalog.product.categories_updated",
        payload: {
          publicId: input.productPublicId,
          primaryCategoryPublicId: input.primaryCategoryPublicId,
          categoryPublicIds: orderedPublicIds,
        },
      });
      return {
        ok: true as const,
        ...productRefreshResult(
          input.productPublicId,
          await readProductRefreshState(tx, product.id, product),
        ),
        categorySlugs: [
          ...new Set([
            ...existingCategories.map(({ category }) => category.slug),
            ...categories.map((category) => category.slug),
          ]),
        ],
      };
    }, transactionOptions()),
  );
}

export async function createAdminProductMedia(
  input: CreateProductMediaFormInput,
) {
  const authorization = await requirePermission(
    "catalog.manage",
    `/admin/catalog/products/${input.productPublicId}`,
  );
  if (input.sourceUrl && !(await ensureLocalPublicFile(input.sourceUrl))) {
    return { ok: false as const, reason: "source_not_found" as const };
  }
  return serializable(() =>
    getDb().$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { publicId: input.productPublicId, deletedAt: null },
        select: { id: true, ...productRefreshBaseSelect },
      });
      if (!product) return { ok: false as const, reason: "not_found" as const };
      const variant = input.variantPublicId
        ? await tx.productVariant.findFirst({
            where: {
              publicId: input.variantPublicId,
              productId: product.id,
              deletedAt: null,
            },
            select: { id: true, publicId: true },
          })
        : null;
      if (input.variantPublicId && !variant) {
        return { ok: false as const, reason: "variant_not_found" as const };
      }

      let media = input.existingMediaPublicId
        ? await tx.media.findFirst({
            where: { publicId: input.existingMediaPublicId, deletedAt: null },
            select: { id: true, ...mediaAuditSelect },
          })
        : null;
      if (input.existingMediaPublicId && !media) {
        return { ok: false as const, reason: "media_not_found" as const };
      }
      if (media) {
        const normalized = media.publicUrl
          ? normalizeCatalogMediaSource(media.publicUrl)
          : null;
        if (!normalized || media.isPrivate || !(await ensureLocalPublicFile(normalized))) {
          return { ok: false as const, reason: "invalid_media_source" as const };
        }
      } else {
        const source = input.sourceUrl;
        if (!source) return { ok: false as const, reason: "invalid_media_source" as const };
        media = await tx.media.findFirst({
          where: { publicUrl: source, deletedAt: null },
          select: { id: true, ...mediaAuditSelect },
        });
        if (!media) {
          const storageKey = source.startsWith("/")
            ? source.slice(1)
            : `external:${source}`;
          const archived = await tx.media.findUnique({
            where: { storageKey },
            select: { id: true },
          });
          if (archived) {
            return { ok: false as const, reason: "source_conflict" as const };
          }
          media = await tx.media.create({
            data: {
              kind: input.kind,
              storageProvider: source.startsWith("/")
                ? "local-public"
                : "external-https",
              storageKey,
              publicUrl: source,
              altText: input.altText,
              isPrivate: false,
            },
            select: { id: true, ...mediaAuditSelect },
          });
        }
      }
      if (media.kind !== input.kind) {
        return { ok: false as const, reason: "kind_conflict" as const };
      }
      if (!isRoleCompatible(media.kind, input.role)) {
        return { ok: false as const, reason: "role_conflict" as const };
      }
      if (
        await tx.productMedia.findFirst({
          where: { productId: product.id, mediaId: media.id },
          select: { id: true },
        })
      ) {
        return { ok: false as const, reason: "already_attached" as const };
      }
      if (input.role === ProductMediaRole.PRIMARY) {
        await tx.productMedia.updateMany({
          where: { productId: product.id, role: ProductMediaRole.PRIMARY },
          data: { role: ProductMediaRole.GALLERY },
        });
      }
      // An empty alt field on the attach form must not erase metadata on a
      // shared existing asset. The dedicated edit form can intentionally clear it.
      if (input.altText !== null && media.altText !== input.altText) {
        media = await tx.media.update({
          where: { id: media.id },
          data: { altText: input.altText },
          select: { id: true, ...mediaAuditSelect },
        });
      }
      const association = await tx.productMedia.create({
        data: {
          productId: product.id,
          variantId: variant?.id ?? null,
          mediaId: media.id,
          role: input.role,
          position: input.position,
        },
        select: productMediaAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "catalog.product.media.attach",
        resourceType: "product_media",
        resourceId: `${input.productPublicId}:${media.publicId}`,
        before: { attached: false },
        after: association,
      });
      await writeCatalogOutbox(tx, {
        aggregateType: "product",
        aggregateId: input.productPublicId,
        eventType: "catalog.product.media_attached",
        payload: {
          productPublicId: input.productPublicId,
          mediaPublicId: media.publicId,
          variantPublicId: variant?.publicId ?? null,
          role: input.role,
          position: input.position,
        },
      });
      return {
        ok: true as const,
        mediaPublicId: media.publicId,
        ...productRefreshResult(
          input.productPublicId,
          await readProductRefreshState(tx, product.id, product),
        ),
      };
    }, transactionOptions()),
  );
}

export async function updateAdminProductMedia(
  input: UpdateProductMediaFormInput,
) {
  const authorization = await requirePermission(
    "catalog.manage",
    `/admin/catalog/products/${input.productPublicId}`,
  );
  return serializable(() =>
    getDb().$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { publicId: input.productPublicId, deletedAt: null },
        select: { id: true, ...productRefreshBaseSelect },
      });
      if (!product) return { ok: false as const, reason: "not_found" as const };
      const existing = await tx.productMedia.findFirst({
        where: {
          productId: product.id,
          media: { publicId: input.mediaPublicId, deletedAt: null },
        },
        select: productMediaAuditSelect,
      });
      if (!existing) return { ok: false as const, reason: "media_not_found" as const };
      if (!isRoleCompatible(existing.media.kind, input.role)) {
        return { ok: false as const, reason: "role_conflict" as const };
      }
      const source = existing.media.publicUrl
        ? normalizeCatalogMediaSource(existing.media.publicUrl)
        : null;
      if (!source || existing.media.isPrivate || !(await ensureLocalPublicFile(source))) {
        return { ok: false as const, reason: "invalid_media_source" as const };
      }
      const variant = input.variantPublicId
        ? await tx.productVariant.findFirst({
            where: {
              publicId: input.variantPublicId,
              productId: product.id,
              deletedAt: null,
            },
            select: { id: true, publicId: true },
          })
        : null;
      if (input.variantPublicId && !variant) {
        return { ok: false as const, reason: "variant_not_found" as const };
      }
      if (input.role === ProductMediaRole.PRIMARY) {
        await tx.productMedia.updateMany({
          where: {
            productId: product.id,
            role: ProductMediaRole.PRIMARY,
            id: { not: existing.id },
          },
          data: { role: ProductMediaRole.GALLERY },
        });
      }
      await tx.media.update({
        where: { id: existing.media.id },
        data: { altText: input.altText },
      });
      const after = await tx.productMedia.update({
        where: { id: existing.id },
        data: {
          variantId: variant?.id ?? null,
          role: input.role,
          position: input.position,
        },
        select: productMediaAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "catalog.product.media.update",
        resourceType: "product_media",
        resourceId: `${input.productPublicId}:${input.mediaPublicId}`,
        before: existing,
        after,
      });
      await writeCatalogOutbox(tx, {
        aggregateType: "product",
        aggregateId: input.productPublicId,
        eventType: "catalog.product.media_updated",
        payload: {
          productPublicId: input.productPublicId,
          mediaPublicId: input.mediaPublicId,
          variantPublicId: variant?.publicId ?? null,
          role: input.role,
          position: input.position,
        },
      });
      return {
        ok: true as const,
        mediaPublicId: input.mediaPublicId,
        ...productRefreshResult(
          input.productPublicId,
          await readProductRefreshState(tx, product.id, product),
        ),
      };
    }, transactionOptions()),
  );
}

export async function detachAdminProductMedia(
  input: DetachProductMediaFormInput,
) {
  const authorization = await requirePermission(
    "catalog.manage",
    `/admin/catalog/products/${input.productPublicId}`,
  );
  return serializable(() =>
    getDb().$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { publicId: input.productPublicId, deletedAt: null },
        select: { id: true, ...productRefreshBaseSelect },
      });
      if (!product) return { ok: false as const, reason: "not_found" as const };
      const existing = await tx.productMedia.findFirst({
        where: { productId: product.id, media: { publicId: input.mediaPublicId } },
        select: productMediaAuditSelect,
      });
      if (!existing) return { ok: false as const, reason: "media_not_found" as const };
      await tx.productMedia.delete({ where: { id: existing.id } });
      let promotedMediaPublicId: string | null = null;
      if (existing.role === ProductMediaRole.PRIMARY) {
        const replacement = await tx.productMedia.findFirst({
          where: {
            productId: product.id,
            role: { in: [ProductMediaRole.GALLERY, ProductMediaRole.SWATCH] },
            media: { kind: MediaKind.IMAGE, deletedAt: null, isPrivate: false },
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: { id: true, media: { select: { publicId: true } } },
        });
        if (replacement) {
          await tx.productMedia.update({
            where: { id: replacement.id },
            data: { role: ProductMediaRole.PRIMARY },
          });
          promotedMediaPublicId = replacement.media.publicId;
        }
      }
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "catalog.product.media.detach",
        resourceType: "product_media",
        resourceId: `${input.productPublicId}:${input.mediaPublicId}`,
        before: existing,
        after: { attached: false, promotedMediaPublicId },
      });
      await writeCatalogOutbox(tx, {
        aggregateType: "product",
        aggregateId: input.productPublicId,
        eventType: "catalog.product.media_detached",
        payload: {
          productPublicId: input.productPublicId,
          mediaPublicId: input.mediaPublicId,
          promotedMediaPublicId,
        },
      });
      return {
        ok: true as const,
        mediaPublicId: input.mediaPublicId,
        ...productRefreshResult(
          input.productPublicId,
          await readProductRefreshState(tx, product.id, product),
        ),
      };
    }, transactionOptions()),
  );
}
