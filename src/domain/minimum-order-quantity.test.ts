import { describe, expect, it } from "vitest";

import {
  clampDirectCheckoutQuantity,
  evaluateMinimumOrderQuantity,
  minimumOrderQuantityFromOptionValues,
} from "@/domain/minimum-order-quantity";

describe("minimum order quantity", () => {
  it("defaults legacy variants with no configured MOQ to one", () => {
    expect(minimumOrderQuantityFromOptionValues(null)).toBe(1);
    expect(minimumOrderQuantityFromOptionValues({ size: "5 mg" })).toBe(1);
  });

  it("fails closed when a present MOQ is malformed or outside direct checkout limits", () => {
    expect(minimumOrderQuantityFromOptionValues("invalid-json-shape")).toBeNull();
    expect(minimumOrderQuantityFromOptionValues({ minimumOrderQuantity: "5" })).toBeNull();
    expect(minimumOrderQuantityFromOptionValues({ minimumOrderQuantity: 0 })).toBeNull();
    expect(minimumOrderQuantityFromOptionValues({ minimumOrderQuantity: 100 })).toBeNull();
  });

  it("rejects a forged client quantity below the trusted DB minimum", () => {
    expect(
      evaluateMinimumOrderQuantity({ minimumOrderQuantity: 6 }, 1),
    ).toEqual({
      ok: false,
      reason: "below_minimum",
      minimumOrderQuantity: 6,
    });
    expect(
      evaluateMinimumOrderQuantity({ minimumOrderQuantity: 6 }, 6),
    ).toEqual({ ok: true, minimumOrderQuantity: 6 });
  });

  it("clamps storefront and cart controls to the configured minimum", () => {
    expect(clampDirectCheckoutQuantity(1, 5)).toBe(5);
    expect(clampDirectCheckoutQuantity(7, 5)).toBe(7);
    expect(clampDirectCheckoutQuantity(500, 5)).toBe(99);
  });
});
