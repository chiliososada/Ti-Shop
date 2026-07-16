import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  orderCount: vi.fn(),
  orderFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: "44c1a488-9922-4308-940b-f115cfd236e4" } },
    roles: ["integration-test"],
    permissions: new Set(["orders.read", "payments.read"]),
  })),
}));
vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    order: {
      count: database.orderCount,
      findMany: database.orderFindMany,
    },
  }),
}));

import { normalizeAdminFulfillmentIndexFilters } from "@/server/admin/fulfillment/queries";
import { normalizeAdminInventoryIndexFilters } from "@/server/admin/inventory/queries";
import {
  getAdminOrderIndex,
  normalizeAdminOrderIndexFilters,
} from "@/server/admin/orders/queries";

describe("administration index pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strictly normalizes scalar filters and rejects repeated or unknown values", () => {
    expect(
      normalizeAdminOrderIndexFilters({
        q: "  ORDER-42\n customer@example.com ",
        page: "02",
        orderStatus: "CONFIRMED",
        paymentStatus: ["PAID", "REFUNDED"],
        fulfillmentStatus: "NOT_A_STATUS",
        review: "NOT_A_REVIEW_FILTER",
      }),
    ).toEqual({
      q: "ORDER-42 customer@example.com",
      page: 1,
      orderStatus: "CONFIRMED",
      paymentStatus: "",
      fulfillmentStatus: "",
      review: "",
    });

    // The overview card links here with review=required; the value must survive
    // normalization or the metric and the list would disagree.
    expect(normalizeAdminOrderIndexFilters({ review: "required" }).review).toBe(
      "required",
    );

    expect(
      normalizeAdminFulfillmentIndexFilters({
        pendingPage: ["1", "2"],
        shipmentPage: "3",
        shipmentQ: "  track-1 ",
        shipmentStatus: "IN_TRANSIT",
      }),
    ).toEqual({
      pendingPage: 1,
      shipmentPage: 3,
      shipmentQ: "track-1",
      shipmentStatus: "IN_TRANSIT",
    });

    expect(
      normalizeAdminInventoryIndexFilters({ q: ["SKU-1", "SKU-2"], page: "0" }),
    ).toEqual({ q: "", page: 1 });
  });

  it("queries the stable second page instead of hiding rows after the first page", async () => {
    database.orderCount.mockResolvedValue(31);
    database.orderFindMany.mockResolvedValue([
      {
        publicId: "547d301d-4773-4a54-895f-39fa435785ef",
        orderNumber: "ORDER-0001",
        customerEmail: "later-page@example.com",
        currency: "USD",
        status: "CONFIRMED",
        paymentStatus: "PAID",
        fulfillmentStatus: "UNFULFILLED",
        totalMinor: BigInt(1_000),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        items: [{ quantity: 1 }],
        payments: [{ method: "WIRE_TRANSFER", status: "CONFIRMED" }],
        _count: { shipments: 0 },
      },
    ]);

    const result = await getAdminOrderIndex({ page: "2" });

    expect(database.orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: 30,
        take: 30,
      }),
    );
    expect(result.pagination).toMatchObject({
      page: 2,
      pageCount: 2,
      total: 31,
    });
    expect(result.orders[0]?.customerEmail).toBe("later-page@example.com");
  });
});
