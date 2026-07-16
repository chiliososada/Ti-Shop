import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["owner"],
    permissions: new Set(["users.manage", "roles.manage"]),
  })),
}));

import {
  assignAdminSystemRole,
  removeAdminSystemRole,
  setAdminProfileActive,
} from "@/server/admin/access/mutations";
import { getAdminAuditIndex } from "@/server/admin/access/queries";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("administrator access database invariants", () => {
  const suffix = randomUUID();
  const nonSystemRoleSlug = `integration_only_${suffix.replaceAll("-", "_")}`;
  let actorUserId = "";
  let limitedActorUserId = "";
  let targetUserId = "";
  let nonSystemRoleId: bigint | null = null;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const ownerRole = await db.role.findFirstOrThrow({
      where: { slug: "owner", isSystem: true },
      select: { id: true },
    });
    const [actor, target, nonSystemRole] = await Promise.all([
      db.user.create({
        data: {
          name: "Access integration owner",
          email: `access-owner-${suffix}@example.invalid`,
          emailVerified: true,
        },
        select: { id: true },
      }),
      db.user.create({
        data: {
          name: "Access integration target",
          email: `access-target-${suffix}@example.invalid`,
        },
        select: { id: true },
      }),
      db.role.create({
        data: {
          slug: nonSystemRoleSlug,
          name: "Integration-only non-system role",
          isSystem: false,
        },
        select: { id: true },
      }),
    ]);
    actorUserId = actor.id;
    targetUserId = target.id;
    nonSystemRoleId = nonSystemRole.id;
    authorization.actorUserId = actor.id;

    const [limitedActor, limitedPermissions] = await Promise.all([
      db.user.create({
        data: {
          name: "Access integration limited role manager",
          email: `access-limited-${suffix}@example.invalid`,
          emailVerified: true,
        },
        select: { id: true },
      }),
      db.permission.findMany({
        where: {
          slug: {
            in: [
              "admin.access",
              "roles.read",
              "roles.manage",
              "users.read",
              "users.manage",
            ],
          },
        },
        select: { id: true },
      }),
    ]);
    limitedActorUserId = limitedActor.id;

    await db.adminProfile.create({
      data: { userId: actor.id, isActive: true },
      select: { id: true },
    });
    await db.userRole.create({
      data: {
        userId: actor.id,
        roleId: ownerRole.id,
        assignedByUserId: actor.id,
      },
      select: { userId: true },
    });
    await db.rolePermission.createMany({
      data: limitedPermissions.map(({ id }) => ({
        roleId: nonSystemRole.id,
        permissionId: id,
      })),
    });
    await db.adminProfile.create({
      data: { userId: limitedActor.id, isActive: true },
      select: { id: true },
    });
    await db.userRole.create({
      data: {
        userId: limitedActor.id,
        roleId: nonSystemRole.id,
        assignedByUserId: actor.id,
      },
      select: { userId: true },
    });
  });

  afterAll(async () => {
    if (!actorUserId) return;
    const db = getDb();
    await db.auditLog.deleteMany({
      where: { actorUserId: { in: [actorUserId, limitedActorUserId] } },
    });
    if (targetUserId) {
      await db.outboxEvent.deleteMany({
        where: {
          aggregateType: "admin_user_access",
          aggregateId: targetUserId,
        },
      });
    }
    await db.user.deleteMany({
      where: {
        id: {
          in: [actorUserId, limitedActorUserId, targetUserId].filter(Boolean),
        },
      },
    });
    if (nonSystemRoleId !== null) {
      await db.role.deleteMany({ where: { id: nonSystemRoleId } });
    }
  });

  it("assigns only system roles, preserves owner safeguards, and audits each change", async () => {
    authorization.actorUserId = actorUserId;
    const rejectedUnverifiedRole = await assignAdminSystemRole({
      userPublicId: targetUserId,
      roleSlug: "auditor",
    });
    const rejectedUnverifiedActivation = await setAdminProfileActive({
      userPublicId: targetUserId,
      isActive: true,
    });
    const db = getDb();
    const accessBeforeVerification = await db.user.findUniqueOrThrow({
      where: { id: targetUserId },
      select: {
        adminProfile: { select: { id: true } },
        roleAssignments: { select: { roleId: true } },
      },
    });
    await db.user.update({
      where: { id: targetUserId },
      data: { emailVerified: true },
      select: { id: true },
    });

    const assigned = await assignAdminSystemRole({
      userPublicId: targetUserId,
      roleSlug: "auditor",
    });
    const replay = await assignAdminSystemRole({
      userPublicId: targetUserId,
      roleSlug: "auditor",
    });
    const rejectedNonSystem = await assignAdminSystemRole({
      userPublicId: targetUserId,
      roleSlug: nonSystemRoleSlug,
    });
    const disabled = await setAdminProfileActive({
      userPublicId: targetUserId,
      isActive: false,
    });
    await db.user.update({
      where: { id: targetUserId },
      data: { emailVerified: false },
      select: { id: true },
    });
    const rejectedUnverifiedReactivation = await setAdminProfileActive({
      userPublicId: targetUserId,
      isActive: true,
    });
    await db.user.update({
      where: { id: targetUserId },
      data: { emailVerified: true },
      select: { id: true },
    });
    const enabled = await setAdminProfileActive({
      userPublicId: targetUserId,
      isActive: true,
    });
    const ownerAssigned = await assignAdminSystemRole({
      userPublicId: targetUserId,
      roleSlug: "owner",
    });
    const ownerRemoved = await removeAdminSystemRole({
      userPublicId: targetUserId,
      roleSlug: "owner",
    });
    const selfOwnerRemoval = await removeAdminSystemRole({
      userPublicId: actorUserId,
      roleSlug: "owner",
    });
    const selfDeactivation = await setAdminProfileActive({
      userPublicId: actorUserId,
      isActive: false,
    });
    const auditorRemoved = await removeAdminSystemRole({
      userPublicId: targetUserId,
      roleSlug: "auditor",
    });
    await db.user.update({
      where: { id: actorUserId },
      data: { emailVerified: false },
      select: { id: true },
    });
    const rejectedUnverifiedActor = await assignAdminSystemRole({
      userPublicId: targetUserId,
      roleSlug: "auditor",
    });
    await db.user.update({
      where: { id: actorUserId },
      data: { emailVerified: true },
      select: { id: true },
    });

    expect(rejectedUnverifiedRole).toEqual({
      ok: false,
      reason: "email_unverified",
    });
    expect(rejectedUnverifiedActivation).toEqual({
      ok: false,
      reason: "email_unverified",
    });
    expect(accessBeforeVerification).toEqual({
      adminProfile: null,
      roleAssignments: [],
    });
    expect(assigned).toMatchObject({ ok: true, duplicate: false });
    expect(replay).toMatchObject({ ok: true, duplicate: true });
    expect(rejectedNonSystem).toEqual({
      ok: false,
      reason: "system_role_not_found",
    });
    expect(disabled).toMatchObject({ ok: true, duplicate: false });
    expect(rejectedUnverifiedReactivation).toEqual({
      ok: false,
      reason: "email_unverified",
    });
    expect(enabled).toMatchObject({ ok: true, duplicate: false });
    expect(ownerAssigned).toMatchObject({ ok: true, duplicate: false });
    expect(ownerRemoved).toMatchObject({ ok: true, duplicate: false });
    expect(selfOwnerRemoval).toEqual({
      ok: false,
      reason: "self_owner_removal",
    });
    expect(selfDeactivation).toEqual({
      ok: false,
      reason: "self_deactivation",
    });
    expect(auditorRemoved).toMatchObject({ ok: true, duplicate: false });
    expect(rejectedUnverifiedActor).toEqual({
      ok: false,
      reason: "permission_changed",
    });

    const auditIndex = await getAdminAuditIndex({
      action: "admin.access",
      resourceType: "admin_user_access",
      actorPublicId: actorUserId,
      page: "1",
      pageSize: "25",
    });

    const [target, auditRows, outboxCount] = await Promise.all([
      db.user.findUniqueOrThrow({
        where: { id: targetUserId },
        select: {
          adminProfile: { select: { isActive: true } },
          roleAssignments: { select: { role: { select: { slug: true } } } },
        },
      }),
      db.auditLog.findMany({
        where: { actorUserId },
        orderBy: { id: "asc" },
        select: { before: true, after: true },
      }),
      db.outboxEvent.count({
        where: {
          aggregateType: "admin_user_access",
          aggregateId: targetUserId,
        },
      }),
    ]);

    expect(target.adminProfile).toEqual({ isActive: true });
    expect(target.roleAssignments).toEqual([]);
    expect(auditRows).toHaveLength(6);
    expect(outboxCount).toBe(6);
    expect(auditIndex.pagination).toMatchObject({
      page: 1,
      pageSize: 25,
      total: 6,
    });
    expect(auditIndex.entries).toHaveLength(6);
    expect(auditIndex.entries[0]).not.toHaveProperty("before");
    expect(auditIndex.entries[0]).not.toHaveProperty("after");
    const serializedAudit = JSON.stringify(auditRows);
    expect(serializedAudit).not.toContain("example.invalid");
    expect(serializedAudit).not.toMatch(/password|session|token/iu);
  });

  it("rejects system-role permission escalation for self and another user with zero writes", async () => {
    authorization.actorUserId = limitedActorUserId;
    const db = getDb();
    const operationsRole = await db.role.findFirstOrThrow({
      where: { slug: "operations_manager", isSystem: true },
      select: { id: true },
    });
    const auditWhere = {
      actorUserId: limitedActorUserId,
    };
    const outboxWhere = {
      aggregateType: "admin_user_access",
      aggregateId: { in: [limitedActorUserId, targetUserId] },
    };
    const [auditBefore, outboxBefore] = await Promise.all([
      db.auditLog.count({ where: auditWhere }),
      db.outboxEvent.count({ where: outboxWhere }),
    ]);

    const selfGrant = await assignAdminSystemRole({
      userPublicId: limitedActorUserId,
      roleSlug: "operations_manager",
    });
    const otherGrant = await assignAdminSystemRole({
      userPublicId: targetUserId,
      roleSlug: "operations_manager",
    });

    const [assignments, auditAfter, outboxAfter] = await Promise.all([
      db.userRole.count({
        where: {
          roleId: operationsRole.id,
          userId: { in: [limitedActorUserId, targetUserId] },
        },
      }),
      db.auditLog.count({ where: auditWhere }),
      db.outboxEvent.count({ where: outboxWhere }),
    ]);

    expect(selfGrant).toEqual({
      ok: false,
      reason: "permission_escalation",
    });
    expect(otherGrant).toEqual({
      ok: false,
      reason: "permission_escalation",
    });
    expect(assignments).toBe(0);
    expect(auditAfter).toBe(auditBefore);
    expect(outboxAfter).toBe(outboxBefore);

    authorization.actorUserId = actorUserId;
    const ownerAssignment = await assignAdminSystemRole({
      userPublicId: targetUserId,
      roleSlug: "operations_manager",
    });
    expect(ownerAssignment).toMatchObject({ ok: true, duplicate: false });

    authorization.actorUserId = limitedActorUserId;
    const [revokeAuditBefore, revokeOutboxBefore] = await Promise.all([
      db.auditLog.count({ where: auditWhere }),
      db.outboxEvent.count({ where: outboxWhere }),
    ]);
    const unauthorizedRevoke = await removeAdminSystemRole({
      userPublicId: targetUserId,
      roleSlug: "operations_manager",
    });
    const [assignmentAfterRevoke, revokeAuditAfter, revokeOutboxAfter] =
      await Promise.all([
        db.userRole.count({
          where: { userId: targetUserId, roleId: operationsRole.id },
        }),
        db.auditLog.count({ where: auditWhere }),
        db.outboxEvent.count({ where: outboxWhere }),
      ]);

    expect(unauthorizedRevoke).toEqual({
      ok: false,
      reason: "permission_escalation",
    });
    expect(assignmentAfterRevoke).toBe(1);
    expect(revokeAuditAfter).toBe(revokeAuditBefore);
    expect(revokeOutboxAfter).toBe(revokeOutboxBefore);

    authorization.actorUserId = actorUserId;
    const ownerCleanup = await removeAdminSystemRole({
      userPublicId: targetUserId,
      roleSlug: "operations_manager",
    });
    expect(ownerCleanup).toMatchObject({ ok: true, duplicate: false });
  });

  it("limits administrator status changes by owner and permission hierarchy and revokes sessions", async () => {
    authorization.actorUserId = actorUserId;
    const db = getDb();
    const [ownerRole, operationsRole] = await Promise.all([
      db.role.findFirstOrThrow({
        where: { slug: "owner", isSystem: true },
        select: { id: true },
      }),
      db.role.findFirstOrThrow({
        where: { slug: "operations_manager", isSystem: true },
        select: { id: true },
      }),
    ]);

    await db.user.update({
      where: { id: targetUserId },
      data: { emailVerified: true, disabledAt: null },
      select: { id: true },
    });
    await db.userRole.deleteMany({ where: { userId: targetUserId } });
    await db.adminProfile.upsert({
      where: { userId: targetUserId },
      create: { userId: targetUserId, isActive: true },
      update: { isActive: true },
      select: { id: true },
    });

    const ownerAssigned = await assignAdminSystemRole({
      userPublicId: targetUserId,
      roleSlug: "owner",
    });
    await db.session.create({
      data: {
        userId: targetUserId,
        token: `access-session-${suffix}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
      select: { id: true },
    });
    const disabledOwner = await setAdminProfileActive({
      userPublicId: targetUserId,
      isActive: false,
    });
    const sessionsAfterDisable = await db.session.count({
      where: { userId: targetUserId },
    });

    authorization.actorUserId = limitedActorUserId;
    const lowPrivilegeOwnerReactivation = await setAdminProfileActive({
      userPublicId: targetUserId,
      isActive: true,
    });

    authorization.actorUserId = actorUserId;
    const reenabledOwner = await setAdminProfileActive({
      userPublicId: targetUserId,
      isActive: true,
    });
    const ownerRemoved = await removeAdminSystemRole({
      userPublicId: targetUserId,
      roleSlug: "owner",
    });
    const operationsAssigned = await assignAdminSystemRole({
      userPublicId: targetUserId,
      roleSlug: "operations_manager",
    });

    authorization.actorUserId = limitedActorUserId;
    const limitedAuditBefore = await db.auditLog.count({
      where: { actorUserId: limitedActorUserId },
    });
    const lowPrivilegeDeactivation = await setAdminProfileActive({
      userPublicId: targetUserId,
      isActive: false,
    });
    const [targetAfterRejection, limitedAuditAfter, operationsAssignment] =
      await Promise.all([
        db.adminProfile.findUniqueOrThrow({
          where: { userId: targetUserId },
          select: { isActive: true },
        }),
        db.auditLog.count({ where: { actorUserId: limitedActorUserId } }),
        db.userRole.count({
          where: { userId: targetUserId, roleId: operationsRole.id },
        }),
      ]);

    expect(ownerAssigned).toMatchObject({ ok: true, duplicate: false });
    expect(disabledOwner).toMatchObject({ ok: true, duplicate: false });
    expect(sessionsAfterDisable).toBe(0);
    expect(lowPrivilegeOwnerReactivation).toEqual({
      ok: false,
      reason: "owner_required",
    });
    expect(reenabledOwner).toMatchObject({ ok: true, duplicate: false });
    expect(ownerRemoved).toMatchObject({ ok: true, duplicate: false });
    expect(operationsAssigned).toMatchObject({ ok: true, duplicate: false });
    expect(lowPrivilegeDeactivation).toEqual({
      ok: false,
      reason: "permission_escalation",
    });
    expect(targetAfterRejection).toEqual({ isActive: true });
    expect(limitedAuditAfter).toBe(limitedAuditBefore);
    expect(operationsAssignment).toBe(1);

    authorization.actorUserId = actorUserId;
    const operationsRemoved = await removeAdminSystemRole({
      userPublicId: targetUserId,
      roleSlug: "operations_manager",
    });
    expect(operationsRemoved).toMatchObject({ ok: true, duplicate: false });
    expect(await db.userRole.count({
      where: { userId: targetUserId, roleId: ownerRole.id },
    })).toBe(0);
  });
});
