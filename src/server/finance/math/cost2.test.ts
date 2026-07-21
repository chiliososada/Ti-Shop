import { describe, expect, it } from "vitest";

import {
  calculateCost2UsdMinor,
  splitCost2UsdMinor,
} from "@/server/finance/math/cost2";

const b = BigInt;

describe("Cost 2", () => {
  it("adds half of the Cost 1 gross margin to Cost 1", () => {
    expect(calculateCost2UsdMinor(b(10_000), b(4_000))).toBe(b(7_000));
    expect(splitCost2UsdMinor({ sellingPriceUsdMinor: b(10_000), cost1UsdMinor: b(4_000) })).toEqual({
      cost2UsdMinor: b(7_000),
      partnerShareUsdMinor: b(3_000),
      ownerShareUsdMinor: b(3_000),
    });
  });

  it("rounds an odd cent commercially without losing reconciliation", () => {
    expect(splitCost2UsdMinor({ sellingPriceUsdMinor: b(100), cost1UsdMinor: b(1) })).toEqual({
      cost2UsdMinor: b(51),
      partnerShareUsdMinor: b(50),
      ownerShareUsdMinor: b(49),
    });
  });

  it("shares a below-cost loss symmetrically", () => {
    expect(splitCost2UsdMinor({ sellingPriceUsdMinor: b(1), cost1UsdMinor: b(100) })).toEqual({
      cost2UsdMinor: b(50),
      partnerShareUsdMinor: b(-50),
      ownerShareUsdMinor: b(-49),
    });
  });

  it("rejects negative source amounts", () => {
    expect(() => calculateCost2UsdMinor(b(-1), b(0))).toThrow(RangeError);
    expect(() => calculateCost2UsdMinor(b(1), b(-1))).toThrow(RangeError);
  });
});
