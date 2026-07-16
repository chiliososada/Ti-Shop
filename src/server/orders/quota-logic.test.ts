import { describe, expect, it } from "vitest";

import {
  CHECKOUT_QUOTA,
  checkoutQuotaViolation,
} from "@/server/orders/quota-logic";

const base = {
  recentOrders: 0,
  pendingOrders: 0,
  activeReservedQuantity: 0,
  requestedReservedQuantity: 1,
};

describe("checkout abuse quota", () => {
  it("allows a bounded customer checkout", () => {
    expect(checkoutQuotaViolation(base)).toBeNull();
  });

  it("blocks rapid different-key order creation", () => {
    expect(
      checkoutQuotaViolation({
        ...base,
        recentOrders: CHECKOUT_QUOTA.maximumRecentOrders,
      }),
    ).toBe("RECENT");
  });

  it("blocks excessive pending orders and active inventory reservations", () => {
    expect(
      checkoutQuotaViolation({
        ...base,
        pendingOrders: CHECKOUT_QUOTA.maximumPendingOrders,
      }),
    ).toBe("PENDING");
    expect(
      checkoutQuotaViolation({
        ...base,
        activeReservedQuantity:
          CHECKOUT_QUOTA.maximumActiveReservedQuantity,
      }),
    ).toBe("INVENTORY");
  });
});

