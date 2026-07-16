import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["owner"],
    permissions: new Set([
      "users.manage",
      "customers.read",
      "customers.manage",
      "orders.read",
    ]),
  })),
}));

import {
  disableAdminCustomerAccount,
  restoreAdminCustomerAccount,
  updateAdminCustomerProfile,
} from "@/server/admin/customers/mutations";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("customer admin database invariants", () => {
  const suffix = randomUUID();
  let actorUserId = "";
  let customerUserId = "";
  let roleOnlyUserId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const [ownerRole, auditorRole] = await Promise.all([
      db.role.findFirstOrThrow({
        where: { slug: "owner", isSystem: true },
        select: { id: true },
      }),
      db.role.findFirstOrThrow({
        where: { slug: "auditor", isSystem: true },
        select: { id: true },
      }),
    ]);
    const [actor, customer, roleOnlyUser] = await Promise.all([
      db.user.create({
        data: {
          name: "Customer integration admin",
          email: `customer-admin-${suffix}@example.invalid`,
          emailVerified: true,
        },
        select: { id: true },
      }),
      db.user.create({
        data: {
          name: "Original customer",
          email: `customer-${suffix}@example.invalid`,
        },
        select: { id: true },
      }),
      db.user.create({
        data: {
          name: "Role-only administrator",
          email: `customer-role-only-${suffix}@example.invalid`,
          emailVerified: true,
        },
        select: { id: true },
      }),
    ]);
    await db.adminProfile.create({
      data: { userId: actor.id, jobTitle: "Integration test", isActive: true },
      select: { id: true },
    });
    actorUserId = actor.id;
    customerUserId = customer.id;
    roleOnlyUserId = roleOnlyUser.id;
    authorization.actorUserId = actor.id;
    await db.userRole.createMany({
      data: [
        {
          userId: actor.id,
          roleId: ownerRole.id,
          assignedByUserId: actor.id,
        },
        {
          userId: roleOnlyUser.id,
          roleId: auditorRole.id,
          assignedByUserId: actor.id,
        },
      ],
    });
  });

  afterAll(async () => {
    if (!actorUserId) return;
    const db = getDb();
    await db.auditLog.deleteMany({ where: { actorUserId } });
    if (customerUserId) {
      await db.outboxEvent.deleteMany({
        where: { aggregateType: "customer", aggregateId: customerUserId },
      });
    }
    await db.user.deleteMany({
      where: {
        id: {
          in: [actorUserId, customerUserId, roleOnlyUserId].filter(Boolean),
        },
      },
    });
  });

  it("updates a customer profile with audit/outbox and refuses admin identity edits", async () => {
    const updated = await updateAdminCustomerProfile({
      publicId: customerUserId,
      name: "Updated customer",
      firstName: "Updated",
      lastName: "Customer",
      phone: "+1 415 555 0100",
      countryCode: "US",
    });
    const blockedAdminUpdate = await updateAdminCustomerProfile({
      publicId: actorUserId,
      name: "Renamed administrator",
      firstName: "Renamed",
      lastName: "Administrator",
      phone: null,
      countryCode: "US",
    });

    expect(updated).toEqual({ ok: true, publicId: customerUserId });
    expect(blockedAdminUpdate).toEqual({ ok: false, reason: "not_found" });

    const db = getDb();
    const [customer, actor, auditCount, outboxCount] = await Promise.all([
      db.user.findUniqueOrThrow({
        where: { id: customerUserId },
        select: {
          name: true,
          customerProfile: {
            select: {
              firstName: true,
              lastName: true,
              phone: true,
              countryCode: true,
              preferredCurrency: true,
              locale: true,
            },
          },
        },
      }),
      db.user.findUniqueOrThrow({
        where: { id: actorUserId },
        select: { name: true },
      }),
      db.auditLog.count({
        where: { actorUserId, action: "customers.profile.update" },
      }),
      db.outboxEvent.count({
        where: {
          aggregateType: "customer",
          aggregateId: customerUserId,
          eventType: "customer.profile.updated",
        },
      }),
    ]);
    expect(customer).toMatchObject({
      name: "Updated customer",
      customerProfile: {
        firstName: "Updated",
        lastName: "Customer",
        phone: "+1 415 555 0100",
        countryCode: "US",
        preferredCurrency: "USD",
        locale: "en-US",
      },
    });
    expect(actor.name).toBe("Customer integration admin");
    expect(auditCount).toBe(1);
    expect(outboxCount).toBe(1);
  });

  it("durably disables/restores a pure customer, revokes sessions, and isolates administrators", async () => {
    const db = getDb();
    const oldTokens = [`old-a-${suffix}`, `old-b-${suffix}`];
    await db.session.createMany({
      data: oldTokens.map((token) => ({
        userId: customerUserId,
        token,
        expiresAt: new Date(Date.now() + 60_000),
      })),
    });

    const disabled = await disableAdminCustomerAccount({
      publicId: customerUserId,
      reason: "Customer confirmed an account takeover by phone.",
      confirmationEmail: `customer-${suffix}@example.invalid`,
      confirmation: "DISABLE_CUSTOMER_ACCOUNT",
    });
    const blockedEnabledAdministrator = await disableAdminCustomerAccount({
      publicId: actorUserId,
      reason: "This administrator must not be reachable from customer controls.",
      confirmationEmail: `customer-admin-${suffix}@example.invalid`,
      confirmation: "DISABLE_CUSTOMER_ACCOUNT",
    });
    const blockedRoleOnlyAdministrator = await disableAdminCustomerAccount({
      publicId: roleOnlyUserId,
      reason: "Role assignment alone must isolate this identity.",
      confirmationEmail: `customer-role-only-${suffix}@example.invalid`,
      confirmation: "DISABLE_CUSTOMER_ACCOUNT",
    });

    expect(disabled).toMatchObject({
      ok: true,
      duplicate: false,
      revokedSessionCount: 2,
    });
    expect(blockedEnabledAdministrator).toEqual({
      ok: false,
      reason: "not_eligible",
    });
    expect(blockedRoleOnlyAdministrator).toEqual({
      ok: false,
      reason: "not_eligible",
    });
    expect(
      await db.session.count({ where: { userId: customerUserId } }),
    ).toBe(0);
    await expect(
      db.session.create({
        data: {
          userId: customerUserId,
          token: `blocked-${suffix}`,
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow(/session creation rejected/iu);

    const restored = await restoreAdminCustomerAccount({
      publicId: customerUserId,
      confirmationEmail: `customer-${suffix}@example.invalid`,
      confirmation: "RESTORE_CUSTOMER_ACCOUNT",
    });
    expect(restored).toMatchObject({ ok: true, duplicate: false });
    expect(
      await db.session.count({
        where: { userId: customerUserId, token: { in: oldTokens } },
      }),
    ).toBe(0);
    await db.session.create({
      data: {
        userId: customerUserId,
        token: `new-after-restore-${suffix}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
      select: { id: true },
    });

    const [account, audits, events] = await Promise.all([
      db.user.findUniqueOrThrow({
        where: { id: customerUserId },
        select: {
          disabledAt: true,
          disabledReason: true,
          disabledByUserId: true,
          _count: { select: { orders: true, addresses: true } },
        },
      }),
      db.auditLog.findMany({
        where: {
          actorUserId,
          resourceType: "customer_account_access",
          resourceId: customerUserId,
        },
        orderBy: { id: "asc" },
        select: { action: true, before: true, after: true },
      }),
      db.outboxEvent.findMany({
        where: {
          aggregateType: "customer",
          aggregateId: customerUserId,
          eventType: {
            in: ["customer.account.disabled", "customer.account.restored"],
          },
        },
        orderBy: { id: "asc" },
        select: { eventType: true },
      }),
    ]);
    expect(account).toMatchObject({
      disabledAt: null,
      disabledReason: null,
      disabledByUserId: null,
    });
    expect(audits.map(({ action }) => action)).toEqual([
      "customers.account.disable",
      "customers.account.restore",
    ]);
    expect(events.map(({ eventType }) => eventType)).toEqual([
      "customer.account.disabled",
      "customer.account.restored",
    ]);
  });

  it("serializes concurrent disable/restore attempts into a coherent state", async () => {
    const email = `customer-${suffix}@example.invalid`;
    const [disableResult, restoreResult] = await Promise.all([
      disableAdminCustomerAccount({
        publicId: customerUserId,
        reason: "Concurrent security review requires temporary deactivation.",
        confirmationEmail: email,
        confirmation: "DISABLE_CUSTOMER_ACCOUNT",
      }),
      restoreAdminCustomerAccount({
        publicId: customerUserId,
        confirmationEmail: email,
        confirmation: "RESTORE_CUSTOMER_ACCOUNT",
      }),
    ]);
    expect(disableResult.ok).toBe(true);
    expect(restoreResult.ok).toBe(true);

    const account = await getDb().user.findUniqueOrThrow({
      where: { id: customerUserId },
      select: {
        disabledAt: true,
        disabledReason: true,
        disabledByUserId: true,
      },
    });
    expect(
      account.disabledAt === null
        ? account.disabledReason === null && account.disabledByUserId === null
        : account.disabledReason !== null && account.disabledByUserId === actorUserId,
    ).toBe(true);

    if (account.disabledAt !== null) {
      await restoreAdminCustomerAccount({
        publicId: customerUserId,
        confirmationEmail: email,
        confirmation: "RESTORE_CUSTOMER_ACCOUNT",
      });
    }
  });

  it("serializes concurrent session inserts against deactivation", async () => {
    const db = getDb();
    const email = `customer-${suffix}@example.invalid`;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await restoreAdminCustomerAccount({
        publicId: customerUserId,
        confirmationEmail: email,
        confirmation: "RESTORE_CUSTOMER_ACCOUNT",
      });

      const [sessionInsert, disableResult] = await Promise.allSettled([
        db.session.create({
          data: {
            userId: customerUserId,
            token: `concurrent-${attempt}-${suffix}`,
            expiresAt: new Date(Date.now() + 60_000),
          },
          select: { id: true },
        }),
        disableAdminCustomerAccount({
          publicId: customerUserId,
          reason: `Concurrent sign-in safety check number ${attempt + 1}.`,
          confirmationEmail: email,
          confirmation: "DISABLE_CUSTOMER_ACCOUNT",
        }),
      ]);

      expect(disableResult.status).toBe("fulfilled");
      if (disableResult.status === "fulfilled") {
        expect(disableResult.value).toMatchObject({ ok: true });
      }
      expect(["fulfilled", "rejected"]).toContain(sessionInsert.status);
      const [account, sessions] = await Promise.all([
        db.user.findUniqueOrThrow({
          where: { id: customerUserId },
          select: { disabledAt: true, disabledReason: true },
        }),
        db.session.findMany({
          where: { userId: customerUserId },
          select: { token: true, createdAt: true },
        }),
      ]);
      expect(account.disabledAt).not.toBeNull();
      expect(account.disabledReason).toContain("Concurrent sign-in safety check");
      expect(sessions).toEqual([]);
    }

    await restoreAdminCustomerAccount({
      publicId: customerUserId,
      confirmationEmail: email,
      confirmation: "RESTORE_CUSTOMER_ACCOUNT",
    });
  });
});
