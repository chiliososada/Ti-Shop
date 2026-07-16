import { describe, expect, it } from "vitest";

import {
  allocateProportionally,
  applyBps,
  divideRoundHalfUp,
  sumSignedMinor,
} from "@/server/finance/math/rounding";

const b = BigInt;

describe("divideRoundHalfUp", () => {
  it("rounds half away from zero in both directions", () => {
    expect(divideRoundHalfUp(b(5), b(2))).toBe(b(3)); // 2.5 -> 3
    expect(divideRoundHalfUp(b(-5), b(2))).toBe(b(-3)); // -2.5 -> -3
    expect(divideRoundHalfUp(b(7), b(2))).toBe(b(4));
    expect(divideRoundHalfUp(b(1), b(3))).toBe(b(0));
    expect(divideRoundHalfUp(b(2), b(3))).toBe(b(1));
    expect(divideRoundHalfUp(b(-1), b(3))).toBe(b(0));
    expect(divideRoundHalfUp(b(-2), b(3))).toBe(b(-1));
    expect(divideRoundHalfUp(b(100), b(-8))).toBe(b(-13)); // -12.5 -> -13
  });

  it("rejects division by zero", () => {
    expect(() => divideRoundHalfUp(b(1), b(0))).toThrow(/zero/u);
  });
});

describe("applyBps", () => {
  it("computes 0.5% (50 bps) exactly with cent rounding", () => {
    expect(applyBps(b(10_000), 50)).toBe(b(50)); // $100.00 -> $0.50
    expect(applyBps(b(199), 50)).toBe(b(1)); // $1.99 -> 0.995 cents -> 1
    expect(applyBps(b(99), 50)).toBe(b(0)); // 0.495 -> 0
    expect(applyBps(b(100), 50)).toBe(b(1)); // 0.5 -> 1 (half up)
  });

  it("computes 50% (5000 bps) and boundary rates", () => {
    expect(applyBps(b(101), 5_000)).toBe(b(51)); // 50.5 -> 51
    expect(applyBps(b(100), 0)).toBe(b(0));
    expect(applyBps(b(100), 10_000)).toBe(b(100));
  });

  it("rejects out-of-range bps", () => {
    for (const bps of [-1, 10_001, 0.5, Number.NaN]) {
      expect(() => applyBps(b(100), bps)).toThrow(/basis points/u);
    }
  });
});

describe("allocateProportionally", () => {
  it("splits exactly and gives the final cent to the largest remainder", () => {
    // 100 cents across weights 1,1,1 -> 34,33,33 (first gets the extra cent).
    expect(allocateProportionally(b(100), [b(1), b(1), b(1)])).toEqual([
      b(34),
      b(33),
      b(33),
    ]);
    // 10 cents across 999/1 -> floors 9.99/0.01 -> 9+1, 0.
    expect(allocateProportionally(b(10), [b(999), b(1)])).toEqual([b(10), b(0)]);
  });

  it("always reconciles with the total across random-like cases", () => {
    const cases: [bigint, bigint[]][] = [
      [b(1), [b(3), b(3), b(3)]],
      [b(101), [b(7), b(13), b(29)]],
      [b(9_999), [b(1), b(2), b(3), b(4), b(5)]],
      [b(1_000_003), [b(333), b(333), b(334)]],
    ];
    for (const [total, weights] of cases) {
      const parts = allocateProportionally(total, weights);
      expect(sumSignedMinor(parts)).toBe(total);
      expect(parts.every((part) => part >= b(0))).toBe(true);
    }
  });

  it("handles negative totals symmetrically", () => {
    const parts = allocateProportionally(b(-100), [b(1), b(1), b(1)]);
    expect(parts).toEqual([b(-34), b(-33), b(-33)]);
    expect(sumSignedMinor(parts)).toBe(b(-100));
  });

  it("rejects impossible allocations", () => {
    expect(() => allocateProportionally(b(1), [])).toThrow(/weight/u);
    expect(() => allocateProportionally(b(1), [b(0), b(0)])).toThrow(/zero weights/u);
    expect(() => allocateProportionally(b(1), [b(-1), b(2)])).toThrow(/negative/u);
    expect(allocateProportionally(b(0), [b(0), b(0)])).toEqual([b(0), b(0)]);
  });
});
