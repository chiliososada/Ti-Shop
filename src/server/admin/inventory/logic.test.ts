import { describe, expect, it } from "vitest";

import {
  calculateInventoryAdjustment,
  inventoryAdjustmentIdempotencyKey,
} from "@/server/admin/inventory/logic";

describe("inventory adjustment rules", () => {
  it("calculates the resulting on-hand quantity on the server", () => {
    expect(
      calculateInventoryAdjustment({
        onHandQuantity: 12,
        reservedQuantity: 4,
        allowBackorder: false,
        quantityDelta: -5,
      }),
    ).toEqual({ ok: true, onHandAfter: 7 });
  });

  it("rejects a negative result", () => {
    expect(
      calculateInventoryAdjustment({
        onHandQuantity: 2,
        reservedQuantity: 0,
        allowBackorder: true,
        quantityDelta: -3,
      }),
    ).toEqual({ ok: false, reason: "negative_on_hand" });
  });

  it("protects reserved stock when backorders are disabled", () => {
    expect(
      calculateInventoryAdjustment({
        onHandQuantity: 10,
        reservedQuantity: 8,
        allowBackorder: false,
        quantityDelta: -3,
      }),
    ).toEqual({ ok: false, reason: "below_reserved" });
  });

  it("rejects a result that would overflow the PostgreSQL integer column", () => {
    expect(
      calculateInventoryAdjustment({
        onHandQuantity: 2_147_483_640,
        reservedQuantity: 0,
        allowBackorder: false,
        quantityDelta: 8,
      }),
    ).toEqual({ ok: false, reason: "invalid_quantity" });
  });

  it("scopes a submission identifier to the authenticated administrator", () => {
    expect(
      inventoryAdjustmentIdempotencyKey(
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ),
    ).toBe(
      "admin-inventory-adjustment:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002",
    );
  });
});
