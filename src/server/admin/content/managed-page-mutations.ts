import "server-only";

import { createHash } from "node:crypto";

import {
  ManagedPageRoute,
  Prisma,
} from "@/generated/prisma/client";
import { getManagedPageDefinition } from "@/lib/managed-page-routes";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import type { ManagedPageFormInput } from "@/server/admin/content/validators";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { withSerializableRetry } from "@/server/orders/retry";

type Transaction = Prisma.TransactionClient;

const SERIALIZABLE = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 10_000,
} as const;

const managedPageSelect = {
  id: true,
  publicId: true,
  slug: true,
  managedRoute: true,
  title: true,
  body: true,
  format: true,
  status: true,
  publishedAt: true,
  deletedAt: true,
  updatedAt: true,
} as const;

async function actorStillCanManageContent(
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
        AND permission."slug" = 'content.manage'
    ) AS "allowed"
  `;
  return rows[0]?.allowed === true;
}

function sameInstant(left: Date | null, right: Date | null) {
  return left?.getTime() === right?.getTime();
}

function sameManagedPage(
  existing: {
    slug: string;
    title: string;
    body: string;
    format: string;
    status: string;
    publishedAt: Date | null;
    deletedAt: Date | null;
  },
  input: ManagedPageFormInput,
  internalSlug: string,
) {
  return (
    existing.slug === internalSlug &&
    existing.title === input.title &&
    existing.body === input.body &&
    existing.format === "MARKDOWN" &&
    existing.status === input.status &&
    sameInstant(existing.publishedAt, input.publishedAt) &&
    existing.deletedAt === null
  );
}

function contentSnapshot(record: {
  publicId: string;
  managedRoute: ManagedPageRoute | null;
  title: string;
  body: string;
  status: string;
  publishedAt: Date | null;
  updatedAt: Date;
}) {
  return {
    publicId: record.publicId,
    managedRoute: record.managedRoute,
    title: record.title,
    bodyLength: record.body.length,
    bodySha256: createHash("sha256").update(record.body).digest("hex"),
    status: record.status,
    publishedAt: record.publishedAt,
    updatedAt: record.updatedAt,
  };
}

export async function upsertAdminManagedPage(input: ManagedPageFormInput) {
  const definition = getManagedPageDefinition(input.routeKey);
  if (!definition) {
    return { ok: false as const, reason: "not_found" as const };
  }

  const returnTo = `/admin/content/managed-pages/${definition.adminSlug}`;
  const authorization = await requirePermission("content.manage", returnTo);
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      if (!(await actorStillCanManageContent(tx, actorUserId))) {
        return { ok: false as const, reason: "permission_changed" as const };
      }

      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`managed-page:${input.routeKey}`}, 0)
        )
      `;

      const route = input.routeKey as ManagedPageRoute;
      const existing = await tx.page.findUnique({
        where: { managedRoute: route },
        select: managedPageSelect,
      });
      const slugOwner = await tx.page.findUnique({
        where: { slug: definition.internalSlug },
        select: { id: true, managedRoute: true },
      });
      if (slugOwner && slugOwner.id !== existing?.id) {
        return { ok: false as const, reason: "slug_conflict" as const };
      }

      if (
        existing &&
        sameManagedPage(existing, input, definition.internalSlug)
      ) {
        return {
          ok: true as const,
          duplicate: true,
          publicId: existing.publicId,
          publicPath: definition.path,
          adminSlug: definition.adminSlug,
        };
      }

      const after = existing
        ? await tx.page.update({
            where: { id: existing.id },
            data: {
              slug: definition.internalSlug,
              title: input.title,
              body: input.body,
              format: "MARKDOWN",
              status: input.status,
              publishedAt: input.publishedAt,
              deletedAt: null,
            },
            select: managedPageSelect,
          })
        : await tx.page.create({
            data: {
              slug: definition.internalSlug,
              managedRoute: route,
              title: input.title,
              body: input.body,
              format: "MARKDOWN",
              status: input.status,
              publishedAt: input.publishedAt,
              authorUserId: actorUserId,
            },
            select: managedPageSelect,
          });

      await writeAdminAuditLog(tx, {
        actorUserId,
        action: existing
          ? "content.managed_page.update"
          : "content.managed_page.create",
        resourceType: "managed_page",
        resourceId: after.publicId,
        before: existing ? contentSnapshot(existing) : null,
        after: contentSnapshot(after),
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "managed_page",
          aggregateId: after.publicId,
          eventType: existing
            ? "content.managed_page.updated"
            : "content.managed_page.created",
          payload: {
            publicId: after.publicId,
            routeKey: input.routeKey,
            publicPath: definition.path,
            status: after.status,
          },
        },
        select: { id: true },
      });

      return {
        ok: true as const,
        duplicate: false,
        publicId: after.publicId,
        publicPath: definition.path,
        adminSlug: definition.adminSlug,
      };
    }, SERIALIZABLE),
  );
}
