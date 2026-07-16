import { describe, expect, it } from "vitest";

import {
  allocateInventory,
  hasCompleteTrackedInventoryReservations,
  type LockedInventoryLevel,
} from "@/server/orders/inventory-logic";

function level(
  id: number,
  overrides: Partial<LockedInventoryLevel> = {},
): LockedInventoryLevel {
  return {
    id: BigInt(id),
    onHandQuantity: 10,
    reservedQuantity: 0,
    safetyStockQuantity: 0,
    allowBackorder: false,
    ...overrides,
  };
}

describe("inventory allocation", () => {
  it("respects existing reservations and safety stock across locked levels", () => {
    expect(
      allocateInventory(
        [
          level(1, {
            onHandQuantity: 10,
            reservedQuantity: 4,
            safetyStockQuantity: 2,
          }),
          level(2, { onHandQuantity: 5 }),
        ],
        7,
      ),
    ).toEqual({
      allocations: [
        { levelId: BigInt(1), quantity: 4 },
        { levelId: BigInt(2), quantity: 3 },
      ],
      remaining: 0,
    });
  });

  it("reports a shortfall when no backorder level can cover it", () => {
    expect(
      allocateInventory([level(1, { onHandQuantity: 2 })], 3),
    ).toEqual({
      allocations: [{ levelId: BigInt(1), quantity: 2 }],
      remaining: 1,
    });
  });

  it("places only the shortfall on an explicitly backorderable level", () => {
    expect(
      allocateInventory(
        [
          level(1, { onHandQuantity: 2 }),
          level(2, { onHandQuantity: 0, allowBackorder: true }),
        ],
        5,
      ),
    ).toEqual({
      allocations: [
        { levelId: BigInt(1), quantity: 2 },
        { levelId: BigInt(2), quantity: 3 },
      ],
      remaining: 0,
    });
  });
});

describe("paid-order reservation coverage", () => {
  const trackedItem = {
    id: BigInt(11),
    quantity: 3,
    trackInventory: true,
  };

  it("requires the full quantity for every tracked order item", () => {
    expect(
      hasCompleteTrackedInventoryReservations(
        [trackedItem],
        [{ orderItemId: trackedItem.id, quantity: 2 }],
      ),
    ).toBe(false);
    expect(
      hasCompleteTrackedInventoryReservations(
        [trackedItem],
        [
          { orderItemId: trackedItem.id, quantity: 1 },
          { orderItemId: trackedItem.id, quantity: 2 },
        ],
      ),
    ).toBe(true);
  });

  it("does not require reservations for explicitly untracked items", () => {
    expect(
      hasCompleteTrackedInventoryReservations(
        [{ ...trackedItem, trackInventory: false }],
        [],
      ),
    ).toBe(true);
  });
});
