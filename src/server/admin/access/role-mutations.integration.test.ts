import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: [],
    permissions: new Set<string>(),
  })),
}));

import {
  assignAdminCustomRole,
  createCustomRole,
  deleteCustomRole,
  removeAdminCustomRole,
  updateCustomRole,
} from "@/server/admin/access/role-mutations";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("custom administrator role database invariants", () => {
  const suffix = randomUUID();
  let ownerUserId = "";
  let limitedUserId = "";
  let targetUserId = "";
  let limitedRoleId: bigint | null = null;
  const createdRoleIds = new Set<string>();

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const [ownerRole, adminAccess, rolesRead, rolesManage] = await Promise.all([
      db.role.findFirstOrThrow({
        where: { slug: "owner", isSystem: true },
        select: { id: true },
      }),
      db.permission.findUniqueOrThrow({
        where: { slug: "admin.access" },
        select: { id: true },
      }),
      db.permission.findUniqueOrThrow({
        where: { slug: "roles.read" },
        select: { id: true },
      }),
      db.permission.findUniqueOrThrow({
        where: { slug: "roles.manage" },
        select: { id: true },
      }),
    ]);
    const [owner, limited, target] = await Promise.all([
      db.user.create({
        data: {
          name: "Custom role integration owner",
          email: `custom-role-owner-${suffix}@example.invalid`,
          emailVerified: true,
          adminProfile: { create: { isActive: true } },
        },
        select: { id: true },
      }),
      db.user.create({
        data: {
          name: "Limited role integration manager",
          email: `custom-role-limited-${suffix}@example.invalid`,
          emailVerified: true,
          adminProfile: { create: { isActive: true } },
        },
        select: { id: true },
      }),
      db.user.create({
        data: {
          name: "Custom role integration target",
          email: `custom-role-target-${suffix}@example.invalid`,
          emailVerified: true,
        },
        select: { id: true },
      }),
    ]);
    ownerUserId = owner.id;
    limitedUserId = limited.id;
    targetUserId = target.id;
    authorization.actorUserId = owner.id;

    const limitedRole = await db.role.create({
      data: {
        slug: `integration_limited_${suffix.replaceAll("-", "_")}`,
        name: "Integration limited role manager",
        isSystem: false,
        permissions: {
          createMany: {
            data: [adminAccess, rolesRead, rolesManage].map(({ id }) => ({
              permissionId: id,
            })),
          },
        },
      },
      select: { id: true },
    });
    limitedRoleId = limitedRole.id;

    await db.userRole.createMany({
      data: [
        {
          userId: owner.id,
          roleId: ownerRole.id,
          assignedByUserId: owner.id,
        },
        {
          userId: limited.id,
          roleId: limitedRole.id,
          assignedByUserId: owner.id,
        },
      ],
    });
  });

  afterAll(async () => {
    if (!ownerUserId) return;
    const db = getDb();
    const actorIds = [ownerUserId, limitedUserId].filter(Boolean);
    await db.auditLog.deleteMany({
      where: { actorUserId: { in: actorIds } },
    });
    await db.outboxEvent.deleteMany({
      where: {
        OR: [
          { aggregateId: { in: [...createdRoleIds] } },
          { aggregateId: targetUserId },
        ],
      },
    });
    await db.user.deleteMany({
      where: {
        id: { in: [ownerUserId, limitedUserId, targetUserId].filter(Boolean) },
      },
    });
    await db.role.deleteMany({
      where: {
        OR: [
          ...(limitedRoleId === null ? [] : [{ id: limitedRoleId }]),
          { publicId: { in: [...createdRoleIds] } },
        ],
      },
    });
  });

  it("blocks permission escalation and system-role mutation", async () => {
    const db = getDb();
    const systemRole = await db.role.findFirstOrThrow({
      where: { slug: "auditor", isSystem: true },
      select: {
        publicId: true,
        name: true,
        description: true,
        permissions: { select: { permissionId: true } },
      },
    });

    authorization.actorUserId = limitedUserId;
    const escalatedPublicId = randomUUID();
    const escalation = await createCustomRole({
      submissionId: escalatedPublicId,
      name: "Escalated payments role",
      description: null,
      permissionSlugs: ["admin.access", "payments.manage"],
    });
    const protectedUpdate = await updateCustomRole({
      publicId: systemRole.publicId,
      name: "Renamed auditor",
      description: "Attempted downgrade",
      permissionSlugs: ["admin.access"],
    });
    const protectedDelete = await deleteCustomRole({
      publicId: systemRole.publicId,
    });

    const [escalatedRole, systemRoleAfter] = await Promise.all([
      db.role.findUnique({ where: { publicId: escalatedPublicId } }),
      db.role.findUniqueOrThrow({
        where: { publicId: systemRole.publicId },
        select: {
          name: true,
          description: true,
          permissions: { select: { permissionId: true } },
        },
      }),
    ]);

    expect(escalation).toEqual({
      ok: false,
      reason: "permission_escalation",
    });
    expect(protectedUpdate).toEqual({
      ok: false,
      reason: "system_role_protected",
    });
    expect(protectedDelete).toEqual({
      ok: false,
      reason: "system_role_protected",
    });
    expect(escalatedRole).toBeNull();
    expect(systemRoleAfter).toEqual({
      name: systemRole.name,
      description: systemRole.description,
      permissions: systemRole.permissions,
    });
  });

  it("creates, updates, assigns, protects in-use deletion, removes, deletes, and audits", async () => {
    authorization.actorUserId = ownerUserId;
    const publicId = randomUUID();
    createdRoleIds.add(publicId);
    const created = await createCustomRole({
      submissionId: publicId,
      name: "Research support",
      description: "Handles customer research questions.",
      permissionSlugs: [
        "admin.access",
        "communications.read",
        "customers.read",
      ],
    });
    const replay = await createCustomRole({
      submissionId: publicId,
      name: "Research support",
      description: "Handles customer research questions.",
      permissionSlugs: [
        "admin.access",
        "communications.read",
        "customers.read",
      ],
    });
    const updated = await updateCustomRole({
      publicId,
      name: "Research customer support",
      description: "Handles customer and research questions.",
      permissionSlugs: [
        "admin.access",
        "communications.read",
        "customers.read",
        "orders.read",
      ],
    });

    authorization.actorUserId = limitedUserId;
    const unauthorizedDowngrade = await updateCustomRole({
      publicId,
      name: "Downgraded by limited manager",
      description: null,
      permissionSlugs: ["admin.access", "roles.read"],
    });
    const unauthorizedDelete = await deleteCustomRole({ publicId });

    authorization.actorUserId = ownerUserId;
    const assigned = await assignAdminCustomRole({
      userPublicId: targetUserId,
      rolePublicId: publicId,
    });
    const inUseDelete = await deleteCustomRole({ publicId });

    authorization.actorUserId = limitedUserId;
    const db = getDb();
    const limitedAuditWhere = { actorUserId: limitedUserId };
    const targetOutboxWhere = {
      aggregateType: "admin_user_access",
      aggregateId: targetUserId,
    };
    const [limitedAuditBefore, targetOutboxBefore] = await Promise.all([
      db.auditLog.count({ where: limitedAuditWhere }),
      db.outboxEvent.count({ where: targetOutboxWhere }),
    ]);
    const escalation = await assignAdminCustomRole({
      userPublicId: limitedUserId,
      rolePublicId: publicId,
    });
    const unauthorizedRemoval = await removeAdminCustomRole({
      userPublicId: targetUserId,
      rolePublicId: publicId,
    });
    const [assignmentAfterRemoval, limitedAuditAfter, targetOutboxAfter] =
      await Promise.all([
        db.userRole.count({
          where: {
            userId: targetUserId,
            role: { publicId },
          },
        }),
        db.auditLog.count({ where: limitedAuditWhere }),
        db.outboxEvent.count({ where: targetOutboxWhere }),
      ]);

    authorization.actorUserId = ownerUserId;
    const removed = await removeAdminCustomRole({
      userPublicId: targetUserId,
      rolePublicId: publicId,
    });
    const deleted = await deleteCustomRole({ publicId });

    expect(created).toMatchObject({ ok: true, duplicate: false, rolePublicId: publicId });
    expect(replay).toMatchObject({ ok: true, duplicate: true, rolePublicId: publicId });
    expect(updated).toMatchObject({ ok: true, duplicate: false });
    expect(unauthorizedDowngrade).toEqual({
      ok: false,
      reason: "permission_escalation",
    });
    expect(unauthorizedDelete).toEqual({
      ok: false,
      reason: "permission_escalation",
    });
    expect(assigned).toMatchObject({ ok: true, duplicate: false });
    expect(inUseDelete).toEqual({ ok: false, reason: "role_in_use" });
    expect(escalation).toEqual({
      ok: false,
      reason: "permission_escalation",
    });
    expect(unauthorizedRemoval).toEqual({
      ok: false,
      reason: "permission_escalation",
    });
    expect(assignmentAfterRemoval).toBe(1);
    expect(limitedAuditAfter).toBe(limitedAuditBefore);
    expect(targetOutboxAfter).toBe(targetOutboxBefore);
    expect(removed).toMatchObject({ ok: true, duplicate: false });
    expect(deleted).toMatchObject({ ok: true, duplicate: false });

    const [roleAfter, target, auditRows, outboxRows] = await Promise.all([
      db.role.findUnique({ where: { publicId } }),
      db.user.findUniqueOrThrow({
        where: { id: targetUserId },
        select: {
          adminProfile: { select: { isActive: true } },
          roleAssignments: { select: { roleId: true } },
        },
      }),
      db.auditLog.findMany({
        where: {
          actorUserId: ownerUserId,
          action: {
            in: [
              "admin.role.create",
              "admin.role.update",
              "admin.access.custom_role.assign",
              "admin.access.custom_role.remove",
              "admin.role.delete",
            ],
          },
        },
        orderBy: { id: "asc" },
        select: { action: true, resourceId: true, before: true, after: true },
      }),
      db.outboxEvent.findMany({
        where: {
          eventType: {
            in: [
              "admin.role.created",
              "admin.role.updated",
              "admin.user.custom_role.assigned",
              "admin.user.custom_role.removed",
              "admin.role.deleted",
            ],
          },
          OR: [{ aggregateId: publicId }, { aggregateId: targetUserId }],
        },
        select: { eventType: true, payload: true },
      }),
    ]);

    expect(roleAfter).toBeNull();
    expect(target).toEqual({
      adminProfile: { isActive: true },
      roleAssignments: [],
    });
    expect(auditRows.map(({ action }) => action)).toEqual([
      "admin.role.create",
      "admin.role.update",
      "admin.access.custom_role.assign",
      "admin.access.custom_role.remove",
      "admin.role.delete",
    ]);
    expect(outboxRows).toHaveLength(5);
    const serialized = JSON.stringify({ auditRows, outboxRows });
    expect(serialized).not.toContain("example.invalid");
    expect(serialized).not.toMatch(/password|session|token/iu);
  });
});
