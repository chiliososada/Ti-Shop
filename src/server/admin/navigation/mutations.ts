import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import type {
  NavigationCreateFormInput,
  NavigationItemCreateFormInput,
  NavigationItemUpdateFormInput,
  NavigationUpdateFormInput,
} from "@/server/admin/navigation/validators";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { withSerializableRetry } from "@/server/orders/retry";

const MAX_TOP_LEVEL_ITEMS = 100;
const SERIALIZABLE = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const;

const navigationAuditSelect = {
  publicId: true,
  key: true,
  name: true,
  status: true,
  updatedAt: true,
} as const;

const navigationItemAuditSelect = {
  publicId: true,
  label: true,
  url: true,
  position: true,
  isVisible: true,
  openInNewTab: true,
  updatedAt: true,
} as const;

type Transaction = Prisma.TransactionClient;

async function actorStillCanManageContent(
  tx: Transaction,
  actorUserId: string,
) {
  // Access-management mutations lock the affected user and administrator rows
  // too, so a permission/profile revocation cannot race a content write after
  // its initial Server Action authorization check.
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

async function runAuthorizedMutation<T>(
  actorUserId: string,
  operation: (tx: Transaction) => Promise<T>,
) {
  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      if (!(await actorStillCanManageContent(tx, actorUserId))) {
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

function sameNavigation(
  record: { key: string; name: string; status: string },
  input: Pick<NavigationCreateFormInput, "key" | "name" | "status">,
) {
  return (
    record.key === input.key &&
    record.name === input.name &&
    record.status === input.status
  );
}

function sameNavigationItem(
  record: {
    label: string;
    url: string;
    position: number;
    isVisible: boolean;
    openInNewTab: boolean;
  },
  input: Pick<
    NavigationItemCreateFormInput,
    "label" | "url" | "position" | "isVisible" | "openInNewTab"
  >,
) {
  return (
    record.label === input.label &&
    record.url === input.url &&
    record.position === input.position &&
    record.isVisible === input.isVisible &&
    record.openInNewTab === input.openInNewTab
  );
}

async function recordNavigationChange(
  tx: Transaction,
  input: {
    actorUserId: string;
    action: string;
    eventType: string;
    publicId: string;
    before: unknown;
    after: unknown;
    payload: Prisma.InputJsonObject;
  },
) {
  await writeAdminAuditLog(tx, {
    actorUserId: input.actorUserId,
    action: input.action,
    resourceType: "navigation",
    resourceId: input.publicId,
    before: input.before,
    after: input.after,
  });
  await tx.outboxEvent.create({
    data: {
      aggregateType: "navigation",
      aggregateId: input.publicId,
      eventType: input.eventType,
      payload: input.payload,
    },
    select: { id: true },
  });
}

async function recordNavigationItemChange(
  tx: Transaction,
  input: {
    actorUserId: string;
    action: string;
    eventType: string;
    navigationPublicId: string;
    itemPublicId: string;
    before: unknown;
    after: unknown;
    payload: Prisma.InputJsonObject;
  },
) {
  await writeAdminAuditLog(tx, {
    actorUserId: input.actorUserId,
    action: input.action,
    resourceType: "navigation_item",
    resourceId: input.itemPublicId,
    before: input.before,
    after: input.after,
  });
  await tx.outboxEvent.create({
    data: {
      aggregateType: "navigation",
      aggregateId: input.navigationPublicId,
      eventType: input.eventType,
      payload: input.payload,
    },
    select: { id: true },
  });
}

export async function createAdminNavigation(input: NavigationCreateFormInput) {
  const authorization = await requirePermission(
    "content.manage",
    "/admin/content/navigation/new",
  );
  const actorUserId = authorization.session.user.id;

  const operation = () =>
    runAuthorizedMutation(actorUserId, async (tx) => {
      const bySubmission = await tx.navigation.findUnique({
        where: { publicId: input.submissionId },
        select: { id: true, ...navigationAuditSelect },
      });
      if (bySubmission) {
        return sameNavigation(bySubmission, input)
          ? {
              ok: true as const,
              duplicate: true,
              publicId: bySubmission.publicId,
            }
          : { ok: false as const, reason: "idempotency_conflict" as const };
      }

      const byKey = await tx.navigation.findUnique({
        where: { key: input.key },
        select: { publicId: true },
      });
      if (byKey) {
        return { ok: false as const, reason: "key_conflict" as const };
      }

      const after = await tx.navigation.create({
        data: {
          publicId: input.submissionId,
          key: input.key,
          name: input.name,
          status: input.status,
        },
        select: navigationAuditSelect,
      });
      await recordNavigationChange(tx, {
        actorUserId,
        action: "content.navigation.create",
        eventType: "content.navigation.created",
        publicId: after.publicId,
        before: null,
        after,
        payload: {
          publicId: after.publicId,
          key: after.key,
          status: after.status,
        },
      });
      return { ok: true as const, duplicate: false, publicId: after.publicId };
    });

  try {
    return await operation();
  } catch (error) {
    // Resolve a concurrent unique insert in a fresh transaction. An exact
    // submission becomes a successful duplicate; a reused key/UUID is still a
    // conflict and never creates a second audit/outbox record.
    if (isUniqueConflict(error)) return operation();
    throw error;
  }
}

export async function updateAdminNavigation(input: NavigationUpdateFormInput) {
  const returnTo = `/admin/content/navigation/${input.publicId}`;
  const authorization = await requirePermission("content.manage", returnTo);
  const actorUserId = authorization.session.user.id;

  return runAuthorizedMutation(actorUserId, async (tx) => {
    const existing = await tx.navigation.findUnique({
      where: { publicId: input.publicId },
      select: { id: true, ...navigationAuditSelect },
    });
    if (!existing) return { ok: false as const, reason: "not_found" as const };

    const byKey = await tx.navigation.findUnique({
      where: { key: input.key },
      select: { id: true },
    });
    if (byKey && byKey.id !== existing.id) {
      return { ok: false as const, reason: "key_conflict" as const };
    }
    if (sameNavigation(existing, input)) {
      return { ok: true as const, duplicate: true, publicId: existing.publicId };
    }

    const after = await tx.navigation.update({
      where: { id: existing.id },
      data: { key: input.key, name: input.name, status: input.status },
      select: navigationAuditSelect,
    });
    await recordNavigationChange(tx, {
      actorUserId,
      action: "content.navigation.update",
      eventType: "content.navigation.updated",
      publicId: after.publicId,
      before: existing,
      after,
      payload: {
        publicId: after.publicId,
        previousKey: existing.key,
        key: after.key,
        status: after.status,
      },
    });
    return { ok: true as const, duplicate: false, publicId: after.publicId };
  });
}

export async function createAdminNavigationItem(
  input: NavigationItemCreateFormInput,
) {
  const returnTo = `/admin/content/navigation/${input.navigationPublicId}`;
  const authorization = await requirePermission("content.manage", returnTo);
  const actorUserId = authorization.session.user.id;

  const operation = () =>
    runAuthorizedMutation(actorUserId, async (tx) => {
      const navigation = await tx.navigation.findUnique({
        where: { publicId: input.navigationPublicId },
        select: { id: true, publicId: true },
      });
      if (!navigation) {
        return { ok: false as const, reason: "not_found" as const };
      }

      const duplicate = await tx.navigationItem.findUnique({
        where: { publicId: input.submissionId },
        select: {
          navigationId: true,
          parentId: true,
          ...navigationItemAuditSelect,
        },
      });
      if (duplicate) {
        return duplicate.navigationId === navigation.id &&
          duplicate.parentId === null &&
          sameNavigationItem(duplicate, input)
          ? {
              ok: true as const,
              duplicate: true,
              publicId: duplicate.publicId,
              navigationPublicId: navigation.publicId,
            }
          : { ok: false as const, reason: "idempotency_conflict" as const };
      }

      const itemCount = await tx.navigationItem.count({
        where: { navigationId: navigation.id, parentId: null },
      });
      if (itemCount >= MAX_TOP_LEVEL_ITEMS) {
        return { ok: false as const, reason: "item_limit" as const };
      }

      const after = await tx.navigationItem.create({
        data: {
          publicId: input.submissionId,
          navigationId: navigation.id,
          parentId: null,
          label: input.label,
          url: input.url,
          position: input.position,
          isVisible: input.isVisible,
          openInNewTab: input.openInNewTab,
        },
        select: navigationItemAuditSelect,
      });
      await recordNavigationItemChange(tx, {
        actorUserId,
        action: "content.navigation_item.create",
        eventType: "content.navigation.item.created",
        navigationPublicId: navigation.publicId,
        itemPublicId: after.publicId,
        before: null,
        after,
        payload: {
          navigationPublicId: navigation.publicId,
          itemPublicId: after.publicId,
          position: after.position,
          isVisible: after.isVisible,
        },
      });
      return {
        ok: true as const,
        duplicate: false,
        publicId: after.publicId,
        navigationPublicId: navigation.publicId,
      };
    });

  try {
    return await operation();
  } catch (error) {
    if (isUniqueConflict(error)) return operation();
    throw error;
  }
}

export async function updateAdminNavigationItem(
  input: NavigationItemUpdateFormInput,
) {
  const returnTo = `/admin/content/navigation/${input.navigationPublicId}`;
  const authorization = await requirePermission("content.manage", returnTo);
  const actorUserId = authorization.session.user.id;

  return runAuthorizedMutation(actorUserId, async (tx) => {
    const navigation = await tx.navigation.findUnique({
      where: { publicId: input.navigationPublicId },
      select: { id: true, publicId: true },
    });
    if (!navigation) return { ok: false as const, reason: "not_found" as const };

    const existing = await tx.navigationItem.findFirst({
      where: {
        publicId: input.publicId,
        navigationId: navigation.id,
        parentId: null,
      },
      select: { id: true, ...navigationItemAuditSelect },
    });
    if (!existing) return { ok: false as const, reason: "not_found" as const };
    if (sameNavigationItem(existing, input)) {
      return {
        ok: true as const,
        duplicate: true,
        publicId: existing.publicId,
        navigationPublicId: navigation.publicId,
      };
    }

    const after = await tx.navigationItem.update({
      where: { id: existing.id },
      data: {
        label: input.label,
        url: input.url,
        position: input.position,
        isVisible: input.isVisible,
        openInNewTab: input.openInNewTab,
      },
      select: navigationItemAuditSelect,
    });
    await recordNavigationItemChange(tx, {
      actorUserId,
      action: "content.navigation_item.update",
      eventType: "content.navigation.item.updated",
      navigationPublicId: navigation.publicId,
      itemPublicId: after.publicId,
      before: existing,
      after,
      payload: {
        navigationPublicId: navigation.publicId,
        itemPublicId: after.publicId,
        position: after.position,
        isVisible: after.isVisible,
      },
    });
    return {
      ok: true as const,
      duplicate: false,
      publicId: after.publicId,
      navigationPublicId: navigation.publicId,
    };
  });
}
