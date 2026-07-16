import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  orderCount: vi.fn(),
  shipmentCount: vi.fn(),
  userCount: vi.fn(),
  adminProfileCount: vi.fn(),
  auditFindMany: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: {
      user: {
        id: "491f1d6d-4fee-478f-af30-ccf39b1b6a41",
        name: "Dashboard operator",
        email: "operator@example.test",
      },
    },
    roles: ["integration-test"],
    permissions: state.permissions,
  })),
}));
vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    order: { count: state.orderCount },
    shipment: { count: state.shipmentCount },
    user: { count: state.userCount },
    adminProfile: { count: state.adminProfileCount },
    auditLog: { findMany: state.auditFindMany },
    $queryRaw: state.queryRaw,
  }),
}));

import {
  ADMIN_OVERVIEW_LOW_STOCK_THRESHOLD,
  loadAdminOverview,
} from "@/server/admin/overview";

describe("admin overview queries", () => {
  beforeEach(() => {
    state.permissions.clear();
    vi.clearAllMocks();
  });

  it("does not issue business-data queries for admin.access alone", async () => {
    state.permissions.add("admin.access");

    const result = await loadAdminOverview(
      new Date("2026-07-13T12:00:00.000Z"),
    );

    expect(Object.values(result.metrics).every((value) => value === null)).toBe(
      true,
    );
    expect(result.recentAuditLogs).toBeNull();
    expect(state.orderCount).not.toHaveBeenCalled();
    expect(state.shipmentCount).not.toHaveBeenCalled();
    expect(state.userCount).not.toHaveBeenCalled();
    expect(state.adminProfileCount).not.toHaveBeenCalled();
    expect(state.auditFindMany).not.toHaveBeenCalled();
    expect(state.queryRaw).not.toHaveBeenCalled();
  });

  it("runs only the two non-PII order counts for orders.read", async () => {
    state.permissions.add("orders.read");
    state.orderCount.mockResolvedValueOnce(13).mockResolvedValueOnce(4);

    const result = await loadAdminOverview(
      new Date("2026-07-13T12:00:00.000Z"),
    );

    expect(result.metrics).toMatchObject({
      recentOrderCount: 13,
      awaitingPaymentOrderCount: 4,
      paymentReviewOrderCount: null,
      pendingFulfillmentOrderCount: null,
    });
    expect(state.orderCount).toHaveBeenCalledTimes(2);
    expect(state.orderCount).toHaveBeenNthCalledWith(1, {
      where: {
        createdAt: { gte: new Date("2026-06-13T12:00:00.000Z") },
        status: { not: "DRAFT" },
      },
    });
    expect(state.orderCount).toHaveBeenNthCalledWith(2, {
      where: {
        status: "PENDING_PAYMENT",
        paymentStatus: { in: ["UNPAID", "PENDING", "PARTIALLY_PAID"] },
      },
    });
    expect(state.shipmentCount).not.toHaveBeenCalled();
    expect(state.queryRaw).not.toHaveBeenCalled();
  });

  it("returns bounded operational counts for the complete read scope", async () => {
    for (const permission of [
      "orders.read",
      "payments.read",
      "fulfillment.read",
      "inventory.read",
      "customers.read",
      "users.read",
      "audit.read",
    ]) {
      state.permissions.add(permission);
    }
    state.orderCount
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(5);
    state.shipmentCount.mockResolvedValueOnce(7).mockResolvedValueOnce(1);
    state.queryRaw.mockResolvedValue([{ count: BigInt(6) }]);
    state.userCount.mockResolvedValue(101);
    state.adminProfileCount.mockResolvedValue(4);
    state.auditFindMany.mockResolvedValue([
      {
        id: BigInt(9),
        action: "order.updated",
        resourceType: "order",
        createdAt: new Date("2026-07-13T11:00:00.000Z"),
      },
    ]);

    const result = await loadAdminOverview(
      new Date("2026-07-13T12:00:00.000Z"),
    );

    expect(result.metrics).toEqual({
      recentOrderCount: 20,
      awaitingPaymentOrderCount: 3,
      paymentReviewOrderCount: 2,
      pendingFulfillmentOrderCount: 5,
      inTransitShipmentCount: 7,
      exceptionShipmentCount: 1,
      lowStockVariantCount: 6,
      customerCount: 101,
      activeAdminCount: 4,
    });
    expect(state.orderCount).toHaveBeenCalledTimes(4);
    expect(state.shipmentCount).toHaveBeenCalledTimes(2);
    expect(state.userCount).toHaveBeenCalledWith({
      where: {
        customerProfile: { isNot: null },
        adminProfile: null,
        roleAssignments: { none: {} },
      },
    });
    expect(state.adminProfileCount).toHaveBeenCalledWith({
      where: {
        isActive: true,
        user: {
          emailVerified: true,
          disabledAt: null,
          roleAssignments: {
            some: {
              role: {
                permissions: {
                  some: { permission: { slug: "admin.access" } },
                },
              },
            },
          },
        },
      },
    });
    expect(state.auditFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );

    const [queryParts, threshold] = state.queryRaw.mock.calls[0] ?? [];
    expect(threshold).toBe(ADMIN_OVERVIEW_LOW_STOCK_THRESHOLD);
    expect(Array.from(queryParts as readonly string[]).join(" ")).toMatch(
      /track_inventory[\s\S]*reserved_quantity[\s\S]*safety_stock_quantity/u,
    );
  });
});
