import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type {
  CustomRoleAssignmentInput,
  CustomRoleCreateInput,
  CustomRoleDeleteInput,
  CustomRoleUpdateInput,
} from "@/server/admin/access/role-validators";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import type { PermissionSlug } from "@/server/auth/permissions";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { withSerializableRetry } from "@/server/orders/retry";

export type CustomRoleMutationReason =
  | "account_disabled"
  | "custom_role_not_found"
  | "email_unverified"
  | "not_found"
  | "permission_changed"
  | "permission_escalation"
  | "permission_not_found"
  | "role_in_use"
  | "submission_conflict"
  | "system_role_protected";

export type CustomRoleMutationResult =
  | {
      ok: true;
      duplicate: boolean;
      rolePublicId: string;
      userPublicId?: string;
    }
  | { ok: false; reason: CustomRoleMutationReason };

type LockedRole = {
  id: bigint;
  publicId: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
};

type RoleSnapshot = {
  publicId: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionSlugs: string[];
  assignmentCount: number;
};

type UserAccessSnapshot = {
  emailVerified: boolean;
  accountDisabled: boolean;
  administratorProfileExists: boolean;
  administratorActive: boolean;
  roles: Array<{
    publicId: string;
    slug: string;
    isSystem: boolean;
  }>;
};

async function acquireRoleMutationGuard(tx: Prisma.TransactionClient) {
  // This is intentionally the same lock used by administrator access
  // mutations. Role definitions and role assignments therefore serialize
  // before either transaction re-checks the actor's current permissions.
  await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT TRUE AS "locked"
    FROM (SELECT pg_advisory_xact_lock(817237, 41009)) AS access_guard
  `;
}

async function lockUsers(
  tx: Prisma.TransactionClient,
  userIds: readonly string[],
) {
  const uniqueIds = [...new Set(userIds)].sort();
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT account."id"
    FROM "app"."users" AS account
    WHERE account."id" IN (${Prisma.join(
      uniqueIds.map((userId) => Prisma.sql`${userId}::uuid`),
    )})
    ORDER BY account."id"
    FOR UPDATE OF account
  `;

  await tx.$queryRaw<Array<{ userId: string }>>`
    SELECT profile."user_id" AS "userId"
    FROM "app"."admin_profiles" AS profile
    WHERE profile."user_id" IN (${Prisma.join(
      uniqueIds.map((userId) => Prisma.sql`${userId}::uuid`),
    )})
    ORDER BY profile."user_id"
    FOR UPDATE OF profile
  `;

  return new Set(locked.map(({ id }) => id));
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

async function prepareRoleMutation(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  additionalUserIds: readonly string[] = [],
) {
  await acquireRoleMutationGuard(tx);
  const lockedUsers = await lockUsers(tx, [actorUserId, ...additionalUserIds]);
  if (!lockedUsers.has(actorUserId)) {
    return { ok: false as const, reason: "permission_changed" as const };
  }

  const actorPermissions = await readUsableActorPermissions(tx, actorUserId);
  if (!actorPermissions.has("roles.manage")) {
    return { ok: false as const, reason: "permission_changed" as const };
  }

  return { ok: true as const, actorPermissions, lockedUsers };
}

function actorCanGrant(
  actorPermissions: ReadonlySet<string>,
  permissionSlugs: readonly string[],
) {
  return permissionSlugs.every((slug) => actorPermissions.has(slug));
}

async function lockRoleByPublicId(
  tx: Prisma.TransactionClient,
  publicId: string,
) {
  const rows = await tx.$queryRaw<LockedRole[]>`
    SELECT
      role."id",
      role."public_id" AS "publicId",
      role."slug",
      role."name",
      role."description",
      role."is_system" AS "isSystem"
    FROM "app"."roles" AS role
    WHERE role."public_id" = ${publicId}::uuid
    FOR UPDATE OF role
  `;
  return rows[0] ?? null;
}

async function lockRolePermissionSlugs(
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

async function lockRoleAssignments(
  tx: Prisma.TransactionClient,
  roleId: bigint,
) {
  return tx.$queryRaw<Array<{ userId: string }>>`
    SELECT assignment."user_id" AS "userId"
    FROM "app"."user_roles" AS assignment
    WHERE assignment."role_id" = ${roleId}
    ORDER BY assignment."user_id"
    FOR UPDATE OF assignment
  `;
}

async function resolvePermissions(
  tx: Prisma.TransactionClient,
  permissionSlugs: readonly PermissionSlug[],
) {
  const rows = await tx.permission.findMany({
    where: { slug: { in: [...permissionSlugs] } },
    orderBy: { slug: "asc" },
    select: { id: true, slug: true },
  });
  return rows.length === permissionSlugs.length ? rows : null;
}

async function roleSnapshot(
  tx: Prisma.TransactionClient,
  role: LockedRole,
  permissionSlugs?: string[],
  assignmentCount?: number,
): Promise<RoleSnapshot> {
  const [permissions, assignments] = await Promise.all([
    permissionSlugs ?? lockRolePermissionSlugs(tx, role.id),
    assignmentCount ??
      tx.userRole.count({
        where: { roleId: role.id },
      }),
  ]);

  return {
    publicId: role.publicId,
    slug: role.slug,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissionSlugs: permissions,
    assignmentCount: assignments,
  };
}

async function userAccessSnapshot(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<UserAccessSnapshot> {
  const account = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      emailVerified: true,
      disabledAt: true,
      adminProfile: { select: { isActive: true } },
      roleAssignments: {
        orderBy: { role: { slug: "asc" } },
        select: {
          role: {
            select: {
              publicId: true,
              slug: true,
              isSystem: true,
            },
          },
        },
      },
    },
  });

  return {
    emailVerified: account.emailVerified,
    accountDisabled: account.disabledAt !== null,
    administratorProfileExists: account.adminProfile !== null,
    administratorActive: account.adminProfile?.isActive === true,
    roles: account.roleAssignments.map(({ role }) => role),
  };
}

async function recordRoleChange(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    rolePublicId: string;
    action: string;
    eventType: string;
    before: RoleSnapshot | null;
    after: RoleSnapshot | null;
  },
) {
  await writeAdminAuditLog(tx, {
    actorUserId: input.actorUserId,
    action: input.action,
    resourceType: "admin_role",
    resourceId: input.rolePublicId,
    before: input.before,
    after: input.after,
  });
  await tx.outboxEvent.create({
    data: {
      aggregateType: "admin_role",
      aggregateId: input.rolePublicId,
      eventType: input.eventType,
      payload: {
        rolePublicId: input.rolePublicId,
        permissionSlugs: input.after?.permissionSlugs ?? [],
      },
    },
    select: { id: true },
  });
}

async function recordRoleAssignmentChange(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    targetUserId: string;
    rolePublicId: string;
    action: string;
    eventType: string;
    before: UserAccessSnapshot;
    after: UserAccessSnapshot;
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
      payload: {
        userPublicId: input.targetUserId,
        rolePublicId: input.rolePublicId,
      },
    },
    select: { id: true },
  });
}

function roleIsUnchanged(
  before: RoleSnapshot,
  input: CustomRoleUpdateInput,
) {
  return (
    before.name === input.name &&
    before.description === input.description &&
    before.permissionSlugs.length === input.permissionSlugs.length &&
    before.permissionSlugs.every(
      (permission, index) => permission === input.permissionSlugs[index],
    )
  );
}

export async function createCustomRole(
  input: CustomRoleCreateInput,
): Promise<CustomRoleMutationResult> {
  const authorization = await requirePermission(
    "roles.manage",
    "/admin/users/roles/new",
  );
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const prepared = await prepareRoleMutation(tx, actorUserId);
        if (!prepared.ok) return prepared;
        if (!actorCanGrant(prepared.actorPermissions, input.permissionSlugs)) {
          return { ok: false as const, reason: "permission_escalation" as const };
        }

        const existing = await lockRoleByPublicId(tx, input.submissionId);
        if (existing) {
          if (existing.isSystem) {
            return {
              ok: false as const,
              reason: "submission_conflict" as const,
            };
          }
          const snapshot = await roleSnapshot(tx, existing);
          const duplicate = roleIsUnchanged(snapshot, {
            publicId: input.submissionId,
            name: input.name,
            description: input.description,
            permissionSlugs: input.permissionSlugs,
          });
          return duplicate
            ? {
                ok: true as const,
                duplicate: true,
                rolePublicId: existing.publicId,
              }
            : {
                ok: false as const,
                reason: "submission_conflict" as const,
              };
        }

        const permissions = await resolvePermissions(tx, input.permissionSlugs);
        if (!permissions) {
          return { ok: false as const, reason: "permission_not_found" as const };
        }

        const role = await tx.role.create({
          data: {
            publicId: input.submissionId,
            slug: `custom_${input.submissionId.replaceAll("-", "")}`,
            name: input.name,
            description: input.description,
            isSystem: false,
            permissions: {
              createMany: {
                data: permissions.map(({ id }) => ({ permissionId: id })),
              },
            },
          },
          select: {
            id: true,
            publicId: true,
            slug: true,
            name: true,
            description: true,
            isSystem: true,
          },
        });
        const after = await roleSnapshot(tx, role, input.permissionSlugs, 0);
        await recordRoleChange(tx, {
          actorUserId,
          rolePublicId: role.publicId,
          action: "admin.role.create",
          eventType: "admin.role.created",
          before: null,
          after,
        });

        return {
          ok: true as const,
          duplicate: false,
          rolePublicId: role.publicId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function updateCustomRole(
  input: CustomRoleUpdateInput,
): Promise<CustomRoleMutationResult> {
  const returnTo = `/admin/users/roles/${input.publicId}`;
  const authorization = await requirePermission("roles.manage", returnTo);
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const prepared = await prepareRoleMutation(tx, actorUserId);
        if (!prepared.ok) return prepared;
        if (!actorCanGrant(prepared.actorPermissions, input.permissionSlugs)) {
          return { ok: false as const, reason: "permission_escalation" as const };
        }

        const role = await lockRoleByPublicId(tx, input.publicId);
        if (!role) {
          return { ok: false as const, reason: "custom_role_not_found" as const };
        }
        if (role.isSystem) {
          return { ok: false as const, reason: "system_role_protected" as const };
        }

        const currentPermissions = await lockRolePermissionSlugs(tx, role.id);
        if (!actorCanGrant(prepared.actorPermissions, currentPermissions)) {
          return { ok: false as const, reason: "permission_escalation" as const };
        }
        const before = await roleSnapshot(tx, role, currentPermissions);
        if (roleIsUnchanged(before, input)) {
          return {
            ok: true as const,
            duplicate: true,
            rolePublicId: role.publicId,
          };
        }

        const permissions = await resolvePermissions(tx, input.permissionSlugs);
        if (!permissions) {
          return { ok: false as const, reason: "permission_not_found" as const };
        }

        const updated = await tx.role.update({
          where: { id: role.id },
          data: {
            name: input.name,
            description: input.description,
            permissions: {
              deleteMany: {},
              createMany: {
                data: permissions.map(({ id }) => ({ permissionId: id })),
              },
            },
          },
          select: {
            id: true,
            publicId: true,
            slug: true,
            name: true,
            description: true,
            isSystem: true,
          },
        });
        const after = await roleSnapshot(
          tx,
          updated,
          input.permissionSlugs,
          before.assignmentCount,
        );
        await recordRoleChange(tx, {
          actorUserId,
          rolePublicId: updated.publicId,
          action: "admin.role.update",
          eventType: "admin.role.updated",
          before,
          after,
        });

        return {
          ok: true as const,
          duplicate: false,
          rolePublicId: updated.publicId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function deleteCustomRole(
  input: CustomRoleDeleteInput,
): Promise<CustomRoleMutationResult> {
  const returnTo = `/admin/users/roles/${input.publicId}`;
  const authorization = await requirePermission("roles.manage", returnTo);
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const prepared = await prepareRoleMutation(tx, actorUserId);
        if (!prepared.ok) return prepared;
        const role = await lockRoleByPublicId(tx, input.publicId);
        if (!role) {
          return { ok: false as const, reason: "custom_role_not_found" as const };
        }
        if (role.isSystem) {
          return { ok: false as const, reason: "system_role_protected" as const };
        }

        const permissionSlugs = await lockRolePermissionSlugs(tx, role.id);
        if (!actorCanGrant(prepared.actorPermissions, permissionSlugs)) {
          return { ok: false as const, reason: "permission_escalation" as const };
        }
        const assignments = await lockRoleAssignments(tx, role.id);
        if (assignments.length > 0) {
          return { ok: false as const, reason: "role_in_use" as const };
        }
        const before = await roleSnapshot(tx, role, permissionSlugs, 0);

        await tx.role.delete({ where: { id: role.id }, select: { id: true } });
        await recordRoleChange(tx, {
          actorUserId,
          rolePublicId: role.publicId,
          action: "admin.role.delete",
          eventType: "admin.role.deleted",
          before,
          after: null,
        });

        return {
          ok: true as const,
          duplicate: false,
          rolePublicId: role.publicId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

async function mutateCustomRoleAssignment(
  input: CustomRoleAssignmentInput,
  operation: "assign" | "remove",
): Promise<CustomRoleMutationResult> {
  const returnTo = `/admin/users/${input.userPublicId}`;
  const authorization = await requirePermission("roles.manage", returnTo);
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const prepared = await prepareRoleMutation(tx, actorUserId, [
          input.userPublicId,
        ]);
        if (!prepared.ok) return prepared;
        if (!prepared.lockedUsers.has(input.userPublicId)) {
          return { ok: false as const, reason: "not_found" as const };
        }

        const role = await lockRoleByPublicId(tx, input.rolePublicId);
        if (!role) {
          return { ok: false as const, reason: "custom_role_not_found" as const };
        }
        if (role.isSystem) {
          return { ok: false as const, reason: "system_role_protected" as const };
        }
        const permissionSlugs = await lockRolePermissionSlugs(tx, role.id);
        if (!actorCanGrant(prepared.actorPermissions, permissionSlugs)) {
          return { ok: false as const, reason: "permission_escalation" as const };
        }

        const before = await userAccessSnapshot(tx, input.userPublicId);
        if (operation === "assign" && before.accountDisabled) {
          return { ok: false as const, reason: "account_disabled" as const };
        }
        if (operation === "assign" && !before.emailVerified) {
          return { ok: false as const, reason: "email_unverified" as const };
        }

        const assignmentRows = await tx.$queryRaw<Array<{ userId: string }>>`
          SELECT assignment."user_id" AS "userId"
          FROM "app"."user_roles" AS assignment
          WHERE assignment."user_id" = ${input.userPublicId}::uuid
            AND assignment."role_id" = ${role.id}
          FOR UPDATE OF assignment
        `;
        const assignmentExists = assignmentRows.length > 0;

        if (operation === "assign") {
          if (assignmentExists && before.administratorProfileExists) {
            return {
              ok: true as const,
              duplicate: true,
              rolePublicId: role.publicId,
              userPublicId: input.userPublicId,
            };
          }
          if (!before.administratorProfileExists) {
            await tx.adminProfile.create({
              data: { userId: input.userPublicId, isActive: true },
              select: { id: true },
            });
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
        } else {
          if (!assignmentExists) {
            return {
              ok: true as const,
              duplicate: true,
              rolePublicId: role.publicId,
              userPublicId: input.userPublicId,
            };
          }
          await tx.userRole.delete({
            where: {
              userId_roleId: {
                userId: input.userPublicId,
                roleId: role.id,
              },
            },
            select: { userId: true },
          });
        }

        const after = await userAccessSnapshot(tx, input.userPublicId);
        await recordRoleAssignmentChange(tx, {
          actorUserId,
          targetUserId: input.userPublicId,
          rolePublicId: role.publicId,
          action:
            operation === "assign"
              ? "admin.access.custom_role.assign"
              : "admin.access.custom_role.remove",
          eventType:
            operation === "assign"
              ? "admin.user.custom_role.assigned"
              : "admin.user.custom_role.removed",
          before,
          after,
        });

        return {
          ok: true as const,
          duplicate: false,
          rolePublicId: role.publicId,
          userPublicId: input.userPublicId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function assignAdminCustomRole(
  input: CustomRoleAssignmentInput,
) {
  return mutateCustomRoleAssignment(input, "assign");
}

export async function removeAdminCustomRole(
  input: CustomRoleAssignmentInput,
) {
  return mutateCustomRoleAssignment(input, "remove");
}
