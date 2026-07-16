import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { inspectManagedPageBody } from "@/lib/managed-page-content";
import { sanitizePublicAssetUrl } from "@/lib/public-asset-url";
import { managedPagePublicPath } from "@/lib/managed-page-routes";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import type {
  RedirectCreateFormInput,
  RedirectUpdateFormInput,
  SeoFormInput,
} from "@/server/admin/seo/validators";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { withSerializableRetry } from "@/server/orders/retry";
import { createsRedirectCycle } from "@/server/seo/redirect-policy";

const seoAuditSelect = {
  publicId: true,
  title: true,
  description: true,
  canonicalUrl: true,
  noIndex: true,
  noFollow: true,
  updatedAt: true,
  openGraphMedia: { select: { publicId: true } },
} as const;

const redirectAuditSelect = {
  publicId: true,
  sourcePath: true,
  destinationPath: true,
  statusCode: true,
  preserveQuery: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
  updatedAt: true,
} as const;

type ResolvedTarget = {
  id: bigint;
  publicId: string;
  slug: string;
  managedRoute?: string | null;
};

type Transaction = Prisma.TransactionClient;
type SeoAuditRecord = {
  publicId: string;
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  noFollow: boolean;
  updatedAt: Date;
  openGraphMedia: { publicId: string } | null;
};

const SERIALIZABLE = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 10_000,
} as const;

async function actorStillCanManageSeo(
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
        AND permission."slug" = 'seo.manage'
    ) AS "allowed"
  `;
  return rows[0]?.allowed === true;
}

async function lockSeoTarget(
  tx: Transaction,
  entityType: SeoFormInput["entityType"],
  targetPublicId: string,
) {
  if (entityType === "product") {
    const rows = await tx.$queryRaw<ResolvedTarget[]>`
      SELECT target."id", target."public_id" AS "publicId", target."slug"
      FROM "app"."products" AS target
      WHERE target."public_id" = ${targetPublicId}::uuid
        AND target."deleted_at" IS NULL
      FOR UPDATE OF target
    `;
    return rows[0] ? { ...rows[0], managedRoute: null } : null;
  }
  if (entityType === "category") {
    const rows = await tx.$queryRaw<ResolvedTarget[]>`
      SELECT target."id", target."public_id" AS "publicId", target."slug"
      FROM "app"."categories" AS target
      WHERE target."public_id" = ${targetPublicId}::uuid
        AND target."deleted_at" IS NULL
      FOR UPDATE OF target
    `;
    return rows[0] ? { ...rows[0], managedRoute: null } : null;
  }
  if (entityType === "blog") {
    const rows = await tx.$queryRaw<ResolvedTarget[]>`
      SELECT target."id", target."public_id" AS "publicId", target."slug"
      FROM "app"."blog_posts" AS target
      WHERE target."public_id" = ${targetPublicId}::uuid
        AND target."deleted_at" IS NULL
      FOR UPDATE OF target
    `;
    return rows[0] ? { ...rows[0], managedRoute: null } : null;
  }

  const rows = await tx.$queryRaw<ResolvedTarget[]>`
    SELECT target."id", target."public_id" AS "publicId", target."slug"
    FROM "app"."pages" AS target
    WHERE target."public_id" = ${targetPublicId}::uuid
      AND target."deleted_at" IS NULL
    FOR UPDATE OF target
  `;
  const target = rows[0];
  if (!target) return null;
  const page = await tx.page.findUnique({
    where: { id: target.id },
    select: { managedRoute: true },
  });
  return { ...target, managedRoute: page?.managedRoute ?? null };
}

async function lockExistingSeoMetadata(
  tx: Transaction,
  entityType: SeoFormInput["entityType"],
  targetId: bigint,
) {
  if (entityType === "product") {
    await tx.$queryRaw`
      SELECT metadata."id"
      FROM "app"."seo_metadata" AS metadata
      WHERE metadata."product_id" = ${targetId}
      FOR UPDATE OF metadata
    `;
  } else if (entityType === "category") {
    await tx.$queryRaw`
      SELECT metadata."id"
      FROM "app"."seo_metadata" AS metadata
      WHERE metadata."category_id" = ${targetId}
      FOR UPDATE OF metadata
    `;
  } else if (entityType === "blog") {
    await tx.$queryRaw`
      SELECT metadata."id"
      FROM "app"."seo_metadata" AS metadata
      WHERE metadata."blog_post_id" = ${targetId}
      FOR UPDATE OF metadata
    `;
  } else {
    await tx.$queryRaw`
      SELECT metadata."id"
      FROM "app"."seo_metadata" AS metadata
      WHERE metadata."page_id" = ${targetId}
      FOR UPDATE OF metadata
    `;
  }
}

async function lockEligibleOpenGraphMedia(
  tx: Transaction,
  mediaPublicId: string,
) {
  const rows = await tx.$queryRaw<
    Array<{
      id: bigint;
      publicId: string;
      kind: string;
      publicUrl: string | null;
      isPrivate: boolean;
      deletedAt: Date | null;
    }>
  >`
    SELECT
      media."id",
      media."public_id" AS "publicId",
      media."kind"::text AS "kind",
      media."public_url" AS "publicUrl",
      media."is_private" AS "isPrivate",
      media."deleted_at" AS "deletedAt"
    FROM "app"."media" AS media
    WHERE media."public_id" = ${mediaPublicId}::uuid
    FOR UPDATE OF media
  `;
  const media = rows[0];
  if (
    !media ||
    media.kind !== "image" ||
    media.isPrivate ||
    media.deletedAt !== null ||
    sanitizePublicAssetUrl(media.publicUrl) === null
  ) {
    return null;
  }
  return { id: media.id, publicId: media.publicId };
}

function seoAuditSnapshot(record: SeoAuditRecord) {
  return {
    publicId: record.publicId,
    title: record.title,
    description: record.description,
    canonicalUrl: record.canonicalUrl,
    noIndex: record.noIndex,
    noFollow: record.noFollow,
    openGraphMediaPublicId: record.openGraphMedia?.publicId ?? null,
    updatedAt: record.updatedAt,
  };
}

function sameSeoMetadata(record: SeoAuditRecord, input: SeoFormInput) {
  return (
    record.title === input.title &&
    record.description === input.description &&
    record.canonicalUrl === input.canonicalUrl &&
    record.noIndex === input.noIndex &&
    (record.openGraphMedia?.publicId ?? null) ===
      input.openGraphMediaPublicId
  );
}

function publicSeoPath(
  entityType: SeoFormInput["entityType"],
  slug: string,
  managedRoute?: string | null,
) {
  if (entityType === "page") {
    return managedPagePublicPath(managedRoute, slug);
  }
  const prefix =
    entityType === "product"
      ? "/products"
      : entityType === "category"
        ? "/categories"
        : entityType === "blog"
          ? "/blog"
          : "/pages";
  return `${prefix}/${slug}`;
}

export async function updateAdminSeo(input: SeoFormInput) {
  const authorization = await requirePermission(
    "seo.manage",
    `/admin/seo/${input.entityType}/${input.targetPublicId}`,
  );
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      if (!(await actorStillCanManageSeo(tx, actorUserId))) {
        return { ok: false as const, reason: "permission_changed" as const };
      }

      const target = await lockSeoTarget(
        tx,
        input.entityType,
        input.targetPublicId,
      );
      if (!target) return { ok: false as const, reason: "not_found" as const };

      if (
        target.managedRoute &&
        [input.title, input.description].some(
          (value) => value !== null && inspectManagedPageBody(value) !== null,
        )
      ) {
        return {
          ok: false as const,
          reason: "sensitive_content" as const,
        };
      }

      const selectedMedia = input.openGraphMediaPublicId
        ? await lockEligibleOpenGraphMedia(tx, input.openGraphMediaPublicId)
        : null;
      if (input.openGraphMediaPublicId && !selectedMedia) {
        return {
          ok: false as const,
          reason: "media_not_eligible" as const,
        };
      }

      await lockExistingSeoMetadata(tx, input.entityType, target.id);
      const relationWhere =
        input.entityType === "product"
          ? { productId: target.id }
          : input.entityType === "category"
            ? { categoryId: target.id }
            : input.entityType === "blog"
              ? { blogPostId: target.id }
              : { pageId: target.id };
      const existing = await tx.seoMetadata.findFirst({
        where: relationWhere,
        select: { id: true, ...seoAuditSelect },
      });
      const publicPath = publicSeoPath(
        input.entityType,
        target.slug,
        target.managedRoute,
      );
      if (
        target.managedRoute &&
        input.canonicalUrl !== null &&
        input.canonicalUrl !== publicPath
      ) {
        return {
          ok: false as const,
          reason: "canonical_mismatch" as const,
        };
      }

      if (existing && sameSeoMetadata(existing, input)) {
        return {
          ok: true as const,
          duplicate: true,
          entityType: input.entityType,
          publicId: input.targetPublicId,
          slug: target.slug,
          publicPath,
          isManagedPage: Boolean(target.managedRoute),
        };
      }

      const values = {
        title: input.title,
        description: input.description,
        canonicalUrl: input.canonicalUrl,
        openGraphMediaId: selectedMedia?.id ?? null,
        noIndex: input.noIndex,
      };

      let after: SeoAuditRecord;
      if (existing) {
        after = await tx.seoMetadata.update({
          where: { id: existing.id },
          data: values,
          select: seoAuditSelect,
        });
      } else if (input.entityType === "product") {
        after = await tx.seoMetadata.create({
          data: { ...values, productId: target.id },
          select: seoAuditSelect,
        });
      } else if (input.entityType === "category") {
        after = await tx.seoMetadata.create({
          data: { ...values, categoryId: target.id },
          select: seoAuditSelect,
        });
      } else if (input.entityType === "blog") {
        after = await tx.seoMetadata.create({
          data: { ...values, blogPostId: target.id },
          select: seoAuditSelect,
        });
      } else {
        after = await tx.seoMetadata.create({
          data: { ...values, pageId: target.id },
          select: seoAuditSelect,
        });
      }

      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "seo.metadata.update",
        resourceType: `${input.entityType}_seo`,
        resourceId: input.targetPublicId,
        before: existing ? { seo: seoAuditSnapshot(existing) } : null,
        after: { seo: seoAuditSnapshot(after) },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "seo_metadata",
          aggregateId: input.targetPublicId,
          eventType: "seo.metadata.updated",
          payload: {
            entityType: input.entityType,
            targetPublicId: input.targetPublicId,
            openGraphMediaPublicId: selectedMedia?.publicId ?? null,
            noIndex: after.noIndex,
            canonicalConfigured: after.canonicalUrl !== null,
          },
        },
        select: { id: true },
      });

      return {
        ok: true as const,
        duplicate: false,
        entityType: input.entityType,
        publicId: input.targetPublicId,
        slug: target.slug,
        publicPath,
        isManagedPage: Boolean(target.managedRoute),
      };
    }, SERIALIZABLE),
  );
}

export async function createAdminRedirect(input: RedirectCreateFormInput) {
  const authorization = await requirePermission(
    "seo.manage",
    "/admin/seo/redirects/new",
  );

  return withSerializableRetry(() => getDb().$transaction(async (tx) => {
    const conflict = await tx.redirect.findUnique({
      where: { sourcePath: input.sourcePath },
      select: { publicId: true },
    });
    if (conflict) return { ok: false as const, reason: "source_conflict" as const };

    const graph = await tx.redirect.findMany({
      select: { publicId: true, sourcePath: true, destinationPath: true },
    });
    if (createsRedirectCycle(input.sourcePath, input.destinationPath, graph)) {
      return { ok: false as const, reason: "cycle" as const };
    }

    const after = await tx.redirect.create({
      data: input,
      select: redirectAuditSelect,
    });
    await writeAdminAuditLog(tx, {
      actorUserId: authorization.session.user.id,
      action: "seo.redirect.create",
      resourceType: "redirect",
      resourceId: after.publicId,
      before: null,
      after,
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: "redirect",
        aggregateId: after.publicId,
        eventType: "seo.redirect.created",
        payload: {
          publicId: after.publicId,
          sourcePath: after.sourcePath,
          destinationPath: after.destinationPath,
          statusCode: after.statusCode,
          isActive: after.isActive,
        },
      },
      select: { id: true },
    });

    return { ok: true as const, publicId: after.publicId, sourcePath: after.sourcePath };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 10_000,
  }));
}

export async function updateAdminRedirect(input: RedirectUpdateFormInput) {
  const authorization = await requirePermission(
    "seo.manage",
    `/admin/seo/redirects/${input.publicId}`,
  );

  return withSerializableRetry(() => getDb().$transaction(async (tx) => {
    const existing = await tx.redirect.findUnique({
      where: { publicId: input.publicId },
      select: { id: true, ...redirectAuditSelect },
    });
    if (!existing) return { ok: false as const, reason: "not_found" as const };

    const conflict = await tx.redirect.findUnique({
      where: { sourcePath: input.sourcePath },
      select: { id: true },
    });
    if (conflict && conflict.id !== existing.id) {
      return { ok: false as const, reason: "source_conflict" as const };
    }

    const graph = await tx.redirect.findMany({
      select: { publicId: true, sourcePath: true, destinationPath: true },
    });
    if (
      createsRedirectCycle(
        input.sourcePath,
        input.destinationPath,
        graph,
        input.publicId,
      )
    ) {
      return { ok: false as const, reason: "cycle" as const };
    }

    const after = await tx.redirect.update({
      where: { id: existing.id },
      data: {
        sourcePath: input.sourcePath,
        destinationPath: input.destinationPath,
        statusCode: input.statusCode,
        preserveQuery: input.preserveQuery,
        isActive: input.isActive,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      },
      select: redirectAuditSelect,
    });
    await writeAdminAuditLog(tx, {
      actorUserId: authorization.session.user.id,
      action: "seo.redirect.update",
      resourceType: "redirect",
      resourceId: input.publicId,
      before: existing,
      after,
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: "redirect",
        aggregateId: input.publicId,
        eventType: "seo.redirect.updated",
        payload: {
          publicId: input.publicId,
          previousSourcePath: existing.sourcePath,
          sourcePath: after.sourcePath,
          destinationPath: after.destinationPath,
          statusCode: after.statusCode,
          isActive: after.isActive,
        },
      },
      select: { id: true },
    });

    return {
      ok: true as const,
      publicId: input.publicId,
      sourcePath: after.sourcePath,
      previousSourcePath: existing.sourcePath,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 10_000,
  }));
}
