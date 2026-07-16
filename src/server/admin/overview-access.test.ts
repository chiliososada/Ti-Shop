import { describe, expect, it } from "vitest";

import { getAdminOverviewAccess } from "@/server/admin/overview-access";

describe("admin overview access", () => {
  it("does not infer sensitive read access from admin.access", () => {
    const access = getAdminOverviewAccess(new Set(["admin.access"]));

    expect(access.metrics.canReadCustomerCount).toBe(false);
    expect(access.metrics.canReadAdministratorCount).toBe(false);
    expect(access.canReadAuditLog).toBe(false);
    expect(Object.values(access.metrics).every((allowed) => !allowed)).toBe(
      true,
    );
    expect(Object.values(access.modules).every((module) => !module.canRead)).toBe(
      true,
    );
  });

  it("grants each overview section only for its own read permission", () => {
    const access = getAdminOverviewAccess(
      new Set(["customers.read", "users.read", "audit.read"]),
    );

    expect(access).toMatchObject({
      metrics: {
        canReadCustomerCount: true,
        canReadAdministratorCount: true,
      },
      canReadAuditLog: true,
      modules: {
        customers: { canRead: true, canManage: false },
        users: { canRead: true, canManage: false },
        audit: { canRead: true, canManage: false },
      },
    });
    expect(access.modules.catalog.canRead).toBe(false);
  });

  it("grants each operational metric only from its corresponding read scope", () => {
    const orders = getAdminOverviewAccess(new Set(["orders.read"]));
    expect(orders.metrics).toMatchObject({
      canReadRecentOrders: true,
      canReadAwaitingPayment: true,
      canReadPaymentReview: false,
      canReadPendingFulfillment: false,
      canReadShipmentHealth: false,
      canReadLowInventory: false,
    });

    const payments = getAdminOverviewAccess(new Set(["payments.read"]));
    expect(payments.metrics.canReadPaymentReview).toBe(false);

    const review = getAdminOverviewAccess(
      new Set(["orders.read", "payments.read"]),
    );
    expect(review.metrics.canReadPaymentReview).toBe(true);

    const operations = getAdminOverviewAccess(
      new Set(["fulfillment.read", "inventory.read"]),
    );
    expect(operations.metrics).toMatchObject({
      canReadPendingFulfillment: true,
      canReadShipmentHealth: true,
      canReadLowInventory: true,
    });
  });

  it("keeps module visibility and mutation capability permission-specific", () => {
    const access = getAdminOverviewAccess(
      new Set([
        "admin.access",
        "orders.read",
        "communications.read",
        "communications.manage",
        "roles.manage",
      ]),
    );

    expect(access.modules.orders).toEqual({
      canRead: true,
      canManage: false,
    });
    expect(access.modules.communications).toEqual({
      canRead: true,
      canManage: true,
    });
    expect(access.modules.users).toEqual({
      canRead: false,
      canManage: true,
    });
  });
});
