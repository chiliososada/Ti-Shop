import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  CORE_MERCHANDISING_MANUAL_POSITION_START,
  CORE_MERCHANDISING_PLACEMENT_KEYS,
} from "@/domain/merchandising";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import type {
  PlacementCreateFormInput,
  PlacementDeleteFormInput,
  PlacementUpdateFormInput,
  ProductTagAssignmentFormInput,
  TagArchiveOrDeleteFormInput,
  TagCreateFormInput,
  TagUpdateFormInput,
} from "@/server/admin/catalog/organization-validators";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { withSerializableRetry } from "@/server/orders/retry";

const SERIALIZABLE = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 20_000,
} as const;
const MAX_PLACEMENTS_PER_KEY = 100;
const MAX_POSITION = 1_000_000;
const CORE_PLACEMENT_KEYS = new Set<string>(
  CORE_MERCHANDISING_PLACEMENT_KEYS,
);

type Transaction = Prisma.TransactionClient;

const tagAuditSelect = {
  publicId: true,
  slug: true,
  name: true,
  status: true,
} as const;

const placementAuditSelect = {
  publicId: true,
  key: true,
  position: true,
  isActive: true,
  product: { select: { publicId: true } },
} satisfies Prisma.MerchandisingPlacementSelect;

type PlacementLock = {
  id: bigint;
  publicId: string;
  productId: bigint;
  position: number;
  isActive: boolean;
  isLegacyManaged: boolean;
};

type ProductPath = {
  productPublicId: string;
  slug: string;
  categorySlugs: string[];
};

async function actorStillCanManageCatalog(
  tx: Transaction,
  actorUserId: string,
) {
  const users = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT account."id"
    FROM "app"."users" AS account
    WHERE account."id" = ${actorUserId}::uuid
    FOR UPDATE OF account
  `;
  if (!users[0]) return false;

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

async function runAuthorizedMutation<T>(
  actorUserId: string,
  operation: (tx: Transaction) => Promise<T>,
) {
  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      if (!(await actorStillCanManageCatalog(tx, actorUserId))) {
        return { ok: false as const, reason: "permission_changed" as const };
      }
      return operation(tx);
    }, SERIALIZABLE),
  );
}

function isUniqueConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

async function recordChange(
  tx: Transaction,
  input: {
    actorUserId: string;
    action: string;
    resourceType: "tag" | "product" | "merchandising_placement";
    resourceId: string;
    before: unknown;
    after: unknown;
    aggregateType: "tag" | "product" | "merchandising_placement";
    eventType: string;
    payload: Prisma.InputJsonObject;
  },
) {
  await writeAdminAuditLog(tx, {
    actorUserId: input.actorUserId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    before: input.before,
    after: input.after,
  });
  await tx.outboxEvent.create({
    data: {
      aggregateType: input.aggregateType,
      aggregateId: input.resourceId,
      eventType: input.eventType,
      payload: input.payload,
    },
    select: { id: true },
  });
}

function sameTag(
  record: { slug: string; name: string; status: string },
  input: Pick<TagCreateFormInput, "slug" | "name" | "status">,
) {
  return (
    record.slug === input.slug &&
    record.name === input.name &&
    record.status === input.status
  );
}

async function lockTag(tx: Transaction, publicId: string) {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT tag."id"
    FROM "app"."tags" AS tag
    WHERE tag."public_id" = ${publicId}::uuid
      AND tag."deleted_at" IS NULL
    FOR UPDATE OF tag
  `;
  return rows[0]?.id ?? null;
}

async function lockProduct(tx: Transaction, publicId: string) {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT product."id"
    FROM "app"."products" AS product
    WHERE product."public_id" = ${publicId}::uuid
      AND product."deleted_at" IS NULL
    FOR UPDATE OF product
  `;
  return rows[0]?.id ?? null;
}

async function lockPlacementKey(tx: Transaction, key: string) {
  return tx.$queryRaw<PlacementLock[]>(Prisma.sql`
    SELECT
      placement."id",
      placement."public_id" AS "publicId",
      placement."product_id" AS "productId",
      placement."position",
      placement."is_active" AS "isActive",
      placement."metadata" IS NOT NULL AS "isLegacyManaged"
    FROM "app"."merchandising_placements" AS placement
    WHERE placement."key" = ${key}
    ORDER BY placement."id"
    FOR UPDATE OF placement
  `);
}

async function lockRequestedTags(
  tx: Transaction,
  publicIds: readonly string[],
) {
  if (!publicIds.length) return [];
  const values = Prisma.join(
    publicIds.map((publicId) => Prisma.sql`${publicId}::uuid`),
  );
  return tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
    SELECT tag."id"
    FROM "app"."tags" AS tag
    WHERE tag."public_id" IN (${values})
      AND tag."deleted_at" IS NULL
    ORDER BY tag."id"
    FOR UPDATE OF tag
  `);
}

async function productPaths(
  tx: Transaction,
  productIds: readonly bigint[],
): Promise<ProductPath[]> {
  const ids = [...new Set(productIds)];
  if (!ids.length) return [];
  const products = await tx.product.findMany({
    where: { id: { in: ids } },
    orderBy: { id: "asc" },
    select: {
      publicId: true,
      slug: true,
      categories: {
        orderBy: [{ position: "asc" }, { categoryId: "asc" }],
        select: { category: { select: { slug: true } } },
      },
    },
  });
  return products.map((product) => ({
    productPublicId: product.publicId,
    slug: product.slug,
    categorySlugs: product.categories.map(({ category }) => category.slug),
  }));
}

async function tagProductPaths(tx: Transaction, tagId: bigint) {
  const rows = await tx.productTag.findMany({
    where: { tagId },
    orderBy: { productId: "asc" },
    select: { productId: true },
  });
  return productPaths(
    tx,
    rows.map(({ productId }) => productId),
  );
}

function placementKeyExists(key: string, rows: readonly PlacementLock[]) {
  return CORE_PLACEMENT_KEYS.has(key) || rows.length > 0;
}

function temporaryPosition(rows: readonly PlacementLock[]) {
  const used = new Set(rows.map(({ position }) => position));
  let candidate = 2_147_483_647;
  while (candidate > MAX_POSITION && used.has(candidate)) candidate -= 1;
  if (candidate <= MAX_POSITION) {
    throw new Error("No safe temporary placement position is available.");
  }
  return candidate;
}

async function placementSnapshot(tx: Transaction, id: bigint) {
  return tx.merchandisingPlacement.findUniqueOrThrow({
    where: { id },
    select: placementAuditSelect,
  });
}

export async function createAdminTag(input: TagCreateFormInput) {
  const authorization = await requirePermission(
    "catalog.manage",
    "/admin/catalog/organization",
  );
  const actorUserId = authorization.session.user.id;
  const operation = () =>
    runAuthorizedMutation(actorUserId, async (tx) => {
      const bySubmission = await tx.tag.findUnique({
        where: { publicId: input.submissionId },
        select: { deletedAt: true, ...tagAuditSelect },
      });
      if (bySubmission) {
        return bySubmission.deletedAt === null && sameTag(bySubmission, input)
          ? {
              ok: true as const,
              duplicate: true,
              publicId: bySubmission.publicId,
              affectedProducts: [] as ProductPath[],
            }
          : { ok: false as const, reason: "idempotency_conflict" as const };
      }

      if (
        await tx.tag.findUnique({
          where: { slug: input.slug },
          select: { id: true },
        })
      ) {
        return { ok: false as const, reason: "slug_conflict" as const };
      }

      const after = await tx.tag.create({
        data: {
          publicId: input.submissionId,
          slug: input.slug,
          name: input.name,
          status: input.status,
        },
        select: tagAuditSelect,
      });
      await recordChange(tx, {
        actorUserId,
        action: "catalog.tag.create",
        resourceType: "tag",
        resourceId: after.publicId,
        before: null,
        after,
        aggregateType: "tag",
        eventType: "catalog.tag.created",
        payload: {
          publicId: after.publicId,
          slug: after.slug,
          status: after.status,
        },
      });
      return {
        ok: true as const,
        duplicate: false,
        publicId: after.publicId,
        affectedProducts: [] as ProductPath[],
      };
    });

  try {
    return await operation();
  } catch (error) {
    if (isUniqueConflict(error)) return operation();
    throw error;
  }
}

export async function updateAdminTag(input: TagUpdateFormInput) {
  const authorization = await requirePermission(
    "catalog.manage",
    "/admin/catalog/organization",
  );
  const actorUserId = authorization.session.user.id;
  const operation = () =>
    runAuthorizedMutation(actorUserId, async (tx) => {
      const tagId = await lockTag(tx, input.publicId);
      if (tagId === null) {
        return { ok: false as const, reason: "not_found" as const };
      }
      const existing = await tx.tag.findUniqueOrThrow({
        where: { id: tagId },
        select: tagAuditSelect,
      });
      const conflictingSlug = await tx.tag.findUnique({
        where: { slug: input.slug },
        select: { id: true },
      });
      if (conflictingSlug && conflictingSlug.id !== tagId) {
        return { ok: false as const, reason: "slug_conflict" as const };
      }
      const affectedProducts = await tagProductPaths(tx, tagId);
      if (sameTag(existing, input)) {
        return {
          ok: true as const,
          duplicate: true,
          publicId: existing.publicId,
          affectedProducts,
        };
      }

      const after = await tx.tag.update({
        where: { id: tagId },
        data: { slug: input.slug, name: input.name, status: input.status },
        select: tagAuditSelect,
      });
      await recordChange(tx, {
        actorUserId,
        action: "catalog.tag.update",
        resourceType: "tag",
        resourceId: after.publicId,
        before: existing,
        after,
        aggregateType: "tag",
        eventType:
          after.status === "ARCHIVED"
            ? "catalog.tag.archived"
            : "catalog.tag.updated",
        payload: {
          publicId: after.publicId,
          slug: after.slug,
          statusBefore: existing.status,
          statusAfter: after.status,
        },
      });
      return {
        ok: true as const,
        duplicate: false,
        publicId: after.publicId,
        affectedProducts,
      };
    });

  try {
    return await operation();
  } catch (error) {
    if (isUniqueConflict(error)) return operation();
    throw error;
  }
}

export async function archiveOrDeleteAdminTag(
  input: TagArchiveOrDeleteFormInput,
) {
  const authorization = await requirePermission(
    "catalog.manage",
    "/admin/catalog/organization",
  );
  const actorUserId = authorization.session.user.id;
  return runAuthorizedMutation(actorUserId, async (tx) => {
    const tagId = await lockTag(tx, input.publicId);
    if (tagId === null) {
      const reserved = await tx.tag.findUnique({
        where: { publicId: input.publicId },
        select: { id: true },
      });
      return reserved
        ? { ok: false as const, reason: "not_found" as const }
        : {
            ok: true as const,
            duplicate: true,
            mode: "deleted" as const,
            publicId: input.publicId,
            affectedProducts: [] as ProductPath[],
          };
    }
    const existing = await tx.tag.findUniqueOrThrow({
      where: { id: tagId },
      select: tagAuditSelect,
    });
    const relations = await tx.$queryRaw<Array<{ productId: bigint }>>`
      SELECT relation."product_id" AS "productId"
      FROM "app"."product_tags" AS relation
      WHERE relation."tag_id" = ${tagId}
      ORDER BY relation."product_id"
      FOR UPDATE OF relation
    `;
    const affectedProducts = await productPaths(
      tx,
      relations.map(({ productId }) => productId),
    );

    if (relations.length > 0) {
      if (existing.status === "ARCHIVED") {
        return {
          ok: true as const,
          duplicate: true,
          mode: "archived" as const,
          publicId: existing.publicId,
          affectedProducts,
        };
      }
      const after = await tx.tag.update({
        where: { id: tagId },
        data: { status: "ARCHIVED" },
        select: tagAuditSelect,
      });
      await recordChange(tx, {
        actorUserId,
        action: "catalog.tag.archive",
        resourceType: "tag",
        resourceId: after.publicId,
        before: existing,
        after,
        aggregateType: "tag",
        eventType: "catalog.tag.archived",
        payload: {
          publicId: after.publicId,
          statusBefore: existing.status,
          statusAfter: after.status,
          associationCount: relations.length,
        },
      });
      return {
        ok: true as const,
        duplicate: false,
        mode: "archived" as const,
        publicId: after.publicId,
        affectedProducts,
      };
    }

    await tx.tag.delete({ where: { id: tagId }, select: { id: true } });
    await recordChange(tx, {
      actorUserId,
      action: "catalog.tag.delete",
      resourceType: "tag",
      resourceId: existing.publicId,
      before: existing,
      after: { exists: false },
      aggregateType: "tag",
      eventType: "catalog.tag.deleted",
      payload: { publicId: existing.publicId, slug: existing.slug },
    });
    return {
      ok: true as const,
      duplicate: false,
      mode: "deleted" as const,
      publicId: existing.publicId,
      affectedProducts,
    };
  });
}

export async function updateAdminProductTags(
  input: ProductTagAssignmentFormInput,
) {
  const returnTo = `/admin/catalog/products/${input.productPublicId}`;
  const authorization = await requirePermission("catalog.manage", returnTo);
  const actorUserId = authorization.session.user.id;
  return runAuthorizedMutation(actorUserId, async (tx) => {
    const productId = await lockProduct(tx, input.productPublicId);
    if (productId === null) {
      return { ok: false as const, reason: "not_found" as const };
    }
    await lockRequestedTags(tx, input.tagPublicIds);
    const requestedTags = await tx.tag.findMany({
      where: {
        publicId: { in: input.tagPublicIds },
        deletedAt: null,
        status: { not: "ARCHIVED" },
      },
      orderBy: { publicId: "asc" },
      select: { id: true, publicId: true },
    });
    if (requestedTags.length !== input.tagPublicIds.length) {
      return { ok: false as const, reason: "tag_not_found" as const };
    }

    const existing = await tx.productTag.findMany({
      where: { productId },
      orderBy: { tag: { publicId: "asc" } },
      select: { tagId: true, tag: { select: { publicId: true } } },
    });
    const before = existing.map(({ tag }) => tag.publicId);
    const after = requestedTags.map(({ publicId }) => publicId);
    const affectedProducts = await productPaths(tx, [productId]);
    if (
      before.length === after.length &&
      before.every((publicId, index) => publicId === after[index])
    ) {
      return {
        ok: true as const,
        duplicate: true,
        productPublicId: input.productPublicId,
        affectedProducts,
      };
    }

    await tx.productTag.deleteMany({ where: { productId } });
    if (requestedTags.length) {
      await tx.productTag.createMany({
        data: requestedTags.map(({ id: tagId }) => ({ productId, tagId })),
      });
    }
    await recordChange(tx, {
      actorUserId,
      action: "catalog.product.tags.update",
      resourceType: "product",
      resourceId: input.productPublicId,
      before: { tagPublicIds: before },
      after: { tagPublicIds: after },
      aggregateType: "product",
      eventType: "catalog.product.tags.updated",
      payload: {
        productPublicId: input.productPublicId,
        tagPublicIds: after,
      },
    });
    return {
      ok: true as const,
      duplicate: false,
      productPublicId: input.productPublicId,
      affectedProducts,
    };
  });
}

export async function createAdminPlacement(input: PlacementCreateFormInput) {
  const authorization = await requirePermission(
    "catalog.manage",
    "/admin/catalog/organization",
  );
  const actorUserId = authorization.session.user.id;
  const operation = () =>
    runAuthorizedMutation(actorUserId, async (tx) => {
      const locked = await lockPlacementKey(tx, input.placementKey);
      if (!placementKeyExists(input.placementKey, locked)) {
        return { ok: false as const, reason: "key_not_found" as const };
      }

      const duplicate = await tx.merchandisingPlacement.findUnique({
        where: { publicId: input.submissionId },
        select: { id: true, ...placementAuditSelect },
      });
      const productId = await lockProduct(tx, input.productPublicId);
      if (productId === null) {
        return { ok: false as const, reason: "product_not_found" as const };
      }
      if (duplicate) {
        return duplicate.key === input.placementKey &&
          duplicate.product.publicId === input.productPublicId &&
          duplicate.position === input.position &&
          duplicate.isActive === input.isActive
          ? {
              ok: true as const,
              duplicate: true,
              placementPublicId: duplicate.publicId,
              affectedProducts: await productPaths(tx, [productId]),
            }
          : { ok: false as const, reason: "idempotency_conflict" as const };
      }
      if (
        CORE_PLACEMENT_KEYS.has(input.placementKey) &&
        input.position < CORE_MERCHANDISING_MANUAL_POSITION_START
      ) {
        return {
          ok: false as const,
          reason: "legacy_reserved_position" as const,
        };
      }
      if (locked.length >= MAX_PLACEMENTS_PER_KEY) {
        return { ok: false as const, reason: "placement_limit" as const };
      }
      if (locked.some(({ position }) => position === input.position)) {
        return { ok: false as const, reason: "position_conflict" as const };
      }
      if (locked.some((row) => row.productId === productId)) {
        return { ok: false as const, reason: "product_conflict" as const };
      }

      const after = await tx.merchandisingPlacement.create({
        data: {
          publicId: input.submissionId,
          key: input.placementKey,
          productId,
          position: input.position,
          isActive: input.isActive,
        },
        select: placementAuditSelect,
      });
      await recordChange(tx, {
        actorUserId,
        action: "catalog.merchandising_placement.create",
        resourceType: "merchandising_placement",
        resourceId: after.publicId,
        before: null,
        after,
        aggregateType: "merchandising_placement",
        eventType: "catalog.merchandising_placement.created",
        payload: {
          placementPublicId: after.publicId,
          placementKey: after.key,
          productPublicId: after.product.publicId,
          position: after.position,
          isActive: after.isActive,
        },
      });
      return {
        ok: true as const,
        duplicate: false,
        placementPublicId: after.publicId,
        affectedProducts: await productPaths(tx, [productId]),
      };
    });

  try {
    return await operation();
  } catch (error) {
    if (isUniqueConflict(error)) return operation();
    throw error;
  }
}

export async function updateAdminPlacement(input: PlacementUpdateFormInput) {
  const authorization = await requirePermission(
    "catalog.manage",
    "/admin/catalog/organization",
  );
  const actorUserId = authorization.session.user.id;
  return runAuthorizedMutation(actorUserId, async (tx) => {
    const locked = await lockPlacementKey(tx, input.placementKey);
    if (!placementKeyExists(input.placementKey, locked)) {
      return { ok: false as const, reason: "key_not_found" as const };
    }
    const row = locked.find(
      ({ publicId }) => publicId.toLowerCase() === input.placementPublicId,
    );
    if (!row) return { ok: false as const, reason: "not_found" as const };

    const existing = await placementSnapshot(tx, row.id);
    if (row.isLegacyManaged && existing.position !== input.position) {
      return { ok: false as const, reason: "legacy_managed" as const };
    }
    if (
      !row.isLegacyManaged &&
      CORE_PLACEMENT_KEYS.has(input.placementKey) &&
      input.position < CORE_MERCHANDISING_MANUAL_POSITION_START
    ) {
      return {
        ok: false as const,
        reason: "legacy_reserved_position" as const,
      };
    }
    if (
      existing.position === input.position &&
      existing.isActive === input.isActive
    ) {
      return {
        ok: true as const,
        duplicate: true,
        placementPublicId: existing.publicId,
        affectedProducts: await productPaths(tx, [row.productId]),
      };
    }

    const displacedRow = locked.find(
      ({ id, position }) => id !== row.id && position === input.position,
    );
    if (displacedRow?.isLegacyManaged) {
      return { ok: false as const, reason: "legacy_position_conflict" as const };
    }
    const displacedBefore = displacedRow
      ? await placementSnapshot(tx, displacedRow.id)
      : null;

    if (input.position !== existing.position) {
      await tx.merchandisingPlacement.update({
        where: { id: row.id },
        data: { position: temporaryPosition(locked) },
        select: { id: true },
      });
      if (displacedRow) {
        await tx.merchandisingPlacement.update({
          where: { id: displacedRow.id },
          data: { position: existing.position },
          select: { id: true },
        });
      }
    }
    const after = await tx.merchandisingPlacement.update({
      where: { id: row.id },
      data: { position: input.position, isActive: input.isActive },
      select: placementAuditSelect,
    });
    const displacedAfter = displacedRow
      ? await placementSnapshot(tx, displacedRow.id)
      : null;
    await recordChange(tx, {
      actorUserId,
      action: "catalog.merchandising_placement.update",
      resourceType: "merchandising_placement",
      resourceId: after.publicId,
      before: { placement: existing, displaced: displacedBefore },
      after: { placement: after, displaced: displacedAfter },
      aggregateType: "merchandising_placement",
      eventType: "catalog.merchandising_placement.updated",
      payload: {
        placementPublicId: after.publicId,
        placementKey: after.key,
        productPublicId: after.product.publicId,
        position: after.position,
        isActive: after.isActive,
        displacedPlacementPublicId: displacedAfter?.publicId ?? null,
      },
    });
    return {
      ok: true as const,
      duplicate: false,
      placementPublicId: after.publicId,
      affectedProducts: await productPaths(
        tx,
        displacedRow ? [row.productId, displacedRow.productId] : [row.productId],
      ),
    };
  });
}

export async function deleteAdminPlacement(input: PlacementDeleteFormInput) {
  const authorization = await requirePermission(
    "catalog.manage",
    "/admin/catalog/organization",
  );
  const actorUserId = authorization.session.user.id;
  return runAuthorizedMutation(actorUserId, async (tx) => {
    const locked = await lockPlacementKey(tx, input.placementKey);
    if (!placementKeyExists(input.placementKey, locked)) {
      return { ok: false as const, reason: "key_not_found" as const };
    }
    const row = locked.find(
      ({ publicId }) => publicId.toLowerCase() === input.placementPublicId,
    );
    if (!row) {
      const elsewhere = await tx.merchandisingPlacement.findUnique({
        where: { publicId: input.placementPublicId },
        select: { key: true },
      });
      return elsewhere
        ? { ok: false as const, reason: "not_found" as const }
        : {
            ok: true as const,
            duplicate: true,
            placementPublicId: input.placementPublicId,
            affectedProducts: [] as ProductPath[],
          };
    }
    if (row.isLegacyManaged) {
      return { ok: false as const, reason: "legacy_managed" as const };
    }
    if (locked.length === 1 && !CORE_PLACEMENT_KEYS.has(input.placementKey)) {
      return { ok: false as const, reason: "last_placement" as const };
    }

    const existing = await placementSnapshot(tx, row.id);
    const affectedProducts = await productPaths(tx, [row.productId]);
    await tx.merchandisingPlacement.delete({
      where: { id: row.id },
      select: { id: true },
    });
    await recordChange(tx, {
      actorUserId,
      action: "catalog.merchandising_placement.delete",
      resourceType: "merchandising_placement",
      resourceId: existing.publicId,
      before: existing,
      after: { exists: false },
      aggregateType: "merchandising_placement",
      eventType: "catalog.merchandising_placement.deleted",
      payload: {
        placementPublicId: existing.publicId,
        placementKey: existing.key,
        productPublicId: existing.product.publicId,
      },
    });
    return {
      ok: true as const,
      duplicate: false,
      placementPublicId: existing.publicId,
      affectedProducts,
    };
  });
}
