import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  evaluateAccessGuard,
  type AccessGuardReason,
} from "@/server/admin/access/policy";
import type {
  AdminStatusInput,
  RoleAssignmentInput,
} from "@/server/admin/access/validators";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import type { PermissionSlug } from "@/server/auth/permissions";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { withSerializableRetry } from "@/server/orders/retry";

type AccessMutationReason =
  | AccessGuardReason
  | "email_unverified"
  | "account_disabled"
  | "not_found"
  | "system_role_not_found"
  | "permission_changed"
  | "permission_escalation";

type AccessMutationResult =
  | {
      ok: true;
      duplicate: boolean;
      userPublicId: string;
    }
  | { ok: false; reason: AccessMutationReason };

type AccessSnapshot = {
  emailVerified: boolean;
  accountDisabled: boolean;
  administratorProfileExists: boolean;
  administratorActive: boolean;
  systemRoles: string[];
};

async function acquireAccessMutationLocks(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  targetUserId: string,
) {
  // All role/status mutations share a transaction-scoped lock. Together with
  // SERIALIZABLE isolation this protects the global "last active owner" count
  // even when two different owner rows are edited concurrently.
  await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT TRUE AS "locked"
    FROM (SELECT pg_advisory_xact_lock(817237, 41009)) AS owner_guard
  `;

  const users = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT account."id"
    FROM "app"."users" AS account
    WHERE account."id" = ${actorUserId}::uuid
       OR account."id" = ${targetUserId}::uuid
    ORDER BY account."id"
    FOR UPDATE OF account
  `;

  await tx.$queryRaw<Array<{ userId: string }>>`
    SELECT profile."user_id" AS "userId"
    FROM "app"."admin_profiles" AS profile
    WHERE profile."user_id" = ${actorUserId}::uuid
       OR profile."user_id" = ${targetUserId}::uuid
    ORDER BY profile."user_id"
    FOR UPDATE OF profile
  `;

  return {
    actorExists: users.some(({ id }) => id === actorUserId),
    targetExists: users.some(({ id }) => id === targetUserId),
  };
}

async function readUsableActorPermissions(
  tx: Prisma.TransactionClient,
  actorUserId: string,
) {
  const rows = await tx.$queryRaw<Array<{ slug: string }>>`
    SELECT DISTINCT permission."slug"
    FROM "app"."admin_profiles" AS profile
    INNER JOIN "app"."users" AS account
      ON account."id" = profile."user_id"
    INNER JOIN "app"."user_roles" AS assignment
      ON assignment."user_id" = profile."user_id"
    INNER JOIN "app"."role_permissions" AS role_permission
      ON role_permission."role_id" = assignment."role_id"
    INNER JOIN "app"."permissions" AS permission
      ON permission."id" = role_permission."permission_id"
    WHERE profile."user_id" = ${actorUserId}::uuid
      AND profile."is_active" = TRUE
      AND account."email_verified" = TRUE
      AND account."disabled_at" IS NULL
    ORDER BY permission."slug"
  `;
  return new Set(rows.map(({ slug }) => slug));
}

async function readAssignedPermissionSlugs(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  // The shared advisory lock serializes this read with every system/custom
  // role definition and assignment mutation. Read assigned permissions even
  // for an inactive target: status changes must never let a lower-privilege
  // administrator control an account that would outrank them when enabled.
  const rows = await tx.$queryRaw<Array<{ slug: string }>>`
    SELECT DISTINCT permission."slug"
    FROM "app"."user_roles" AS assignment
    INNER JOIN "app"."role_permissions" AS role_permission
      ON role_permission."role_id" = assignment."role_id"
    INNER JOIN "app"."permissions" AS permission
      ON permission."id" = role_permission."permission_id"
    WHERE assignment."user_id" = ${userId}::uuid
    ORDER BY permission."slug"
  `;
  return rows.map(({ slug }) => slug);
}

async function readAccessSnapshot(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<AccessSnapshot> {
  const row = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      emailVerified: true,
      disabledAt: true,
      adminProfile: { select: { isActive: true } },
      roleAssignments: {
        where: { role: { isSystem: true } },
        orderBy: { role: { slug: "asc" } },
        select: { role: { select: { slug: true } } },
      },
    },
  });

  return {
    emailVerified: row.emailVerified,
    accountDisabled: row.disabledAt !== null,
    administratorProfileExists: row.adminProfile !== null,
    administratorActive: row.adminProfile?.isActive === true,
    systemRoles: row.roleAssignments.map(({ role }) => role.slug),
  };
}

async function actorIsUsableOwner(
  tx: Prisma.TransactionClient,
  actorUserId: string,
) {
  const rows = await tx.$queryRaw<Array<{ allowed: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM "app"."admin_profiles" AS profile
      INNER JOIN "app"."users" AS account
        ON account."id" = profile."user_id"
      INNER JOIN "app"."user_roles" AS assignment
        ON assignment."user_id" = profile."user_id"
      INNER JOIN "app"."roles" AS role
        ON role."id" = assignment."role_id"
      WHERE profile."user_id" = ${actorUserId}::uuid
        AND profile."is_active" = TRUE
        AND account."email_verified" = TRUE
        AND account."disabled_at" IS NULL
        AND role."slug" = 'owner'
        AND role."is_system" = TRUE
    ) AS "allowed"
  `;
  return rows[0]?.allowed === true;
}

async function countUsableOwners(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::integer AS "count"
    FROM "app"."admin_profiles" AS profile
    INNER JOIN "app"."users" AS account
      ON account."id" = profile."user_id"
    WHERE profile."is_active" = TRUE
      AND account."email_verified" = TRUE
      AND account."disabled_at" IS NULL
      AND EXISTS (
        SELECT 1
        FROM "app"."user_roles" AS assignment
        INNER JOIN "app"."roles" AS role
          ON role."id" = assignment."role_id"
        WHERE assignment."user_id" = profile."user_id"
          AND role."slug" = 'owner'
          AND role."is_system" = TRUE
      )
  `;
  return rows[0]?.count ?? 0;
}

async function lockSystemRole(
  tx: Prisma.TransactionClient,
  roleSlug: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: bigint; slug: string }>>`
    SELECT role."id", role."slug"
    FROM "app"."roles" AS role
    WHERE role."slug" = ${roleSlug}
      AND role."is_system" = TRUE
    FOR UPDATE OF role
  `;
  return rows[0] ?? null;
}

async function lockSystemRolePermissions(
  tx: Prisma.TransactionClient,
  roleId: bigint,
) {
  const rows = await tx.$queryRaw<Array<{ slug: string }>>`
    SELECT permission."slug"
    FROM "app"."role_permissions" AS role_permission
    INNER JOIN "app"."permissions" AS permission
      ON permission."id" = role_permission."permission_id"
    WHERE role_permission."role_id" = ${roleId}
    ORDER BY permission."slug"
    FOR UPDATE OF role_permission
  `;
  return rows.map(({ slug }) => slug);
}

async function lockRoleAssignment(
  tx: Prisma.TransactionClient,
  userId: string,
  roleId: bigint,
) {
  const rows = await tx.$queryRaw<Array<{ userId: string }>>`
    SELECT assignment."user_id" AS "userId"
    FROM "app"."user_roles" AS assignment
    WHERE assignment."user_id" = ${userId}::uuid
      AND assignment."role_id" = ${roleId}
    FOR UPDATE OF assignment
  `;
  return rows[0] !== undefined;
}

async function recordAccessChange(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    targetUserId: string;
    action: string;
    eventType: string;
    before: AccessSnapshot;
    after: AccessSnapshot;
    payload: Prisma.InputJsonObject;
  },
) {
  await writeAdminAuditLog(tx, {
    actorUserId: input.actorUserId,
    action: input.action,
    resourceType: "admin_user_access",
    resourceId: input.targetUserId,
    before: input.before,
    after: input.after,
  });
  await tx.outboxEvent.create({
    data: {
      aggregateType: "admin_user_access",
      aggregateId: input.targetUserId,
      eventType: input.eventType,
      payload: input.payload,
    },
    select: { id: true },
  });
}

async function prepareMutation(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  targetUserId: string,
  permission: PermissionSlug,
) {
  const locks = await acquireAccessMutationLocks(tx, actorUserId, targetUserId);
  if (!locks.targetExists) {
    return { ok: false as const, reason: "not_found" as const };
  }
  if (!locks.actorExists) {
    return { ok: false as const, reason: "permission_changed" as const };
  }
  const actorPermissions = await readUsableActorPermissions(tx, actorUserId);
  if (!actorPermissions.has(permission)) {
    return { ok: false as const, reason: "permission_changed" as const };
  }
  return { ok: true as const, actorPermissions };
}

export async function assignAdminSystemRole(
  input: RoleAssignmentInput,
): Promise<AccessMutationResult> {
  const returnTo = `/admin/users/${input.userPublicId}`;
  const authorization = await requirePermission("roles.manage", returnTo);
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const prepared = await prepareMutation(
          tx,
          actorUserId,
          input.userPublicId,
          "roles.manage",
        );
        if (!prepared.ok) return prepared;

        const before = await readAccessSnapshot(tx, input.userPublicId);
        if (before.accountDisabled) {
          return { ok: false as const, reason: "account_disabled" as const };
        }
        if (!before.emailVerified) {
          return { ok: false as const, reason: "email_unverified" as const };
        }

        const role = await lockSystemRole(tx, input.roleSlug);
        if (!role) {
          return { ok: false as const, reason: "system_role_not_found" as const };
        }
        const rolePermissions = await lockSystemRolePermissions(tx, role.id);
        if (
          !rolePermissions.every((permission) =>
            prepared.actorPermissions.has(permission),
          )
        ) {
          return { ok: false as const, reason: "permission_escalation" as const };
        }
        const assignmentExists = await lockRoleAssignment(
          tx,
          input.userPublicId,
          role.id,
        );
        const guard = evaluateAccessGuard({
          operation: "assign_role",
          actorUserId,
          targetUserId: input.userPublicId,
          roleSlug: role.slug,
          actorIsOwner: await actorIsUsableOwner(tx, actorUserId),
          targetIsOwner: before.systemRoles.includes("owner"),
          targetIsActive:
            !before.accountDisabled &&
            before.emailVerified &&
            before.administratorActive,
          activeOwnerCount: await countUsableOwners(tx),
        });
        if (guard) return { ok: false as const, reason: guard };

        if (assignmentExists && before.administratorProfileExists) {
          return {
            ok: true as const,
            duplicate: true,
            userPublicId: input.userPublicId,
          };
        }

        let profileCreated = false;
        if (!before.administratorProfileExists) {
          await tx.adminProfile.create({
            data: { userId: input.userPublicId, isActive: true },
            select: { id: true },
          });
          profileCreated = true;
        }
        if (!assignmentExists) {
          await tx.userRole.create({
            data: {
              userId: input.userPublicId,
              roleId: role.id,
              assignedByUserId: actorUserId,
            },
            select: { userId: true },
          });
        }

        const after = await readAccessSnapshot(tx, input.userPublicId);
        await recordAccessChange(tx, {
          actorUserId,
          targetUserId: input.userPublicId,
          action: assignmentExists
            ? "admin.access.profile.provision"
            : "admin.access.role.assign",
          eventType: assignmentExists
            ? "admin.user.profile.provisioned"
            : "admin.user.role.assigned",
          before,
          after,
          payload: {
            userPublicId: input.userPublicId,
            roleSlug: role.slug,
            administratorProfileCreated: profileCreated,
          },
        });

        return {
          ok: true as const,
          duplicate: false,
          userPublicId: input.userPublicId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function removeAdminSystemRole(
  input: RoleAssignmentInput,
): Promise<AccessMutationResult> {
  const returnTo = `/admin/users/${input.userPublicId}`;
  const authorization = await requirePermission("roles.manage", returnTo);
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const prepared = await prepareMutation(
          tx,
          actorUserId,
          input.userPublicId,
          "roles.manage",
        );
        if (!prepared.ok) return prepared;

        const role = await lockSystemRole(tx, input.roleSlug);
        if (!role) {
          return { ok: false as const, reason: "system_role_not_found" as const };
        }
        const rolePermissions = await lockSystemRolePermissions(tx, role.id);
        if (
          !rolePermissions.every((permission) =>
            prepared.actorPermissions.has(permission),
          )
        ) {
          return { ok: false as const, reason: "permission_escalation" as const };
        }
        const assignmentExists = await lockRoleAssignment(
          tx,
          input.userPublicId,
          role.id,
        );
        const before = await readAccessSnapshot(tx, input.userPublicId);
        const guard = evaluateAccessGuard({
          operation: "remove_role",
          actorUserId,
          targetUserId: input.userPublicId,
          roleSlug: role.slug,
          actorIsOwner: await actorIsUsableOwner(tx, actorUserId),
          targetIsOwner: before.systemRoles.includes("owner"),
          targetIsActive:
            !before.accountDisabled &&
            before.emailVerified &&
            before.administratorActive,
          activeOwnerCount: await countUsableOwners(tx),
        });
        if (guard) return { ok: false as const, reason: guard };

        if (!assignmentExists) {
          return {
            ok: true as const,
            duplicate: true,
            userPublicId: input.userPublicId,
          };
        }

        await tx.userRole.delete({
          where: {
            userId_roleId: { userId: input.userPublicId, roleId: role.id },
          },
          select: { userId: true },
        });
        const after = await readAccessSnapshot(tx, input.userPublicId);
        await recordAccessChange(tx, {
          actorUserId,
          targetUserId: input.userPublicId,
          action: "admin.access.role.remove",
          eventType: "admin.user.role.removed",
          before,
          after,
          payload: {
            userPublicId: input.userPublicId,
            roleSlug: role.slug,
          },
        });

        return {
          ok: true as const,
          duplicate: false,
          userPublicId: input.userPublicId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function setAdminProfileActive(
  input: AdminStatusInput,
): Promise<AccessMutationResult> {
  const returnTo = `/admin/users/${input.userPublicId}`;
  const authorization = await requirePermission("users.manage", returnTo);
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const prepared = await prepareMutation(
          tx,
          actorUserId,
          input.userPublicId,
          "users.manage",
        );
        if (!prepared.ok) return prepared;

        const before = await readAccessSnapshot(tx, input.userPublicId);
        if (input.isActive && before.accountDisabled) {
          return { ok: false as const, reason: "account_disabled" as const };
        }
        if (input.isActive && !before.emailVerified) {
          return { ok: false as const, reason: "email_unverified" as const };
        }
        const guard = evaluateAccessGuard({
          operation: "set_admin_active",
          actorUserId,
          targetUserId: input.userPublicId,
          nextIsActive: input.isActive,
          actorIsOwner: await actorIsUsableOwner(tx, actorUserId),
          targetIsOwner: before.systemRoles.includes("owner"),
          targetIsActive:
            !before.accountDisabled &&
            before.emailVerified &&
            before.administratorActive,
          activeOwnerCount: await countUsableOwners(tx),
        });
        if (guard) return { ok: false as const, reason: guard };

        const targetPermissions = await readAssignedPermissionSlugs(
          tx,
          input.userPublicId,
        );
        if (
          !targetPermissions.every((permission) =>
            prepared.actorPermissions.has(permission),
          )
        ) {
          return {
            ok: false as const,
            reason: "permission_escalation" as const,
          };
        }

        if (!before.administratorProfileExists && !input.isActive) {
          return {
            ok: true as const,
            duplicate: true,
            userPublicId: input.userPublicId,
          };
        }

        const profileStateUnchanged =
          before.administratorProfileExists &&
          before.administratorActive === input.isActive;
        if (profileStateUnchanged && input.isActive) {
          return {
            ok: true as const,
            duplicate: true,
            userPublicId: input.userPublicId,
          };
        }

        let revokedSessionCount = 0;
        if (!input.isActive && before.administratorProfileExists) {
          const revoked = await tx.session.deleteMany({
            where: { userId: input.userPublicId },
          });
          revokedSessionCount = revoked.count;
          if (profileStateUnchanged && revoked.count === 0) {
            return {
              ok: true as const,
              duplicate: true,
              userPublicId: input.userPublicId,
            };
          }
        }

        if (before.administratorProfileExists && !profileStateUnchanged) {
          await tx.adminProfile.update({
            where: { userId: input.userPublicId },
            data: { isActive: input.isActive },
            select: { id: true },
          });
        } else if (!before.administratorProfileExists) {
          await tx.adminProfile.create({
            data: { userId: input.userPublicId, isActive: true },
            select: { id: true },
          });
        }

        const after = await readAccessSnapshot(tx, input.userPublicId);
        await recordAccessChange(tx, {
          actorUserId,
          targetUserId: input.userPublicId,
          action: input.isActive
            ? "admin.access.profile.enable"
            : "admin.access.profile.disable",
          eventType: input.isActive
            ? "admin.user.enabled"
            : profileStateUnchanged
              ? "admin.user.sessions.revoked"
              : "admin.user.disabled",
          before,
          after,
          payload: {
            userPublicId: input.userPublicId,
            isActive: input.isActive,
            revokedSessionCount,
          },
        });

        return {
          ok: true as const,
          duplicate: false,
          userPublicId: input.userPublicId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}
