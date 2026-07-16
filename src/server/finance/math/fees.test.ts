import { describe, expect, it } from "vitest";

import {
  allocateBatchFees,
  DEFAULT_CRYPTO_CONVERSION_FEE_BPS,
  estimateConversionFeeUsdMinor,
} from "@/server/finance/math/fees";
import { sumSignedMinor } from "@/server/finance/math/rounding";

const b = BigInt;

describe("estimateConversionFeeUsdMinor", () => {
  it("charges the default 0.5% on USD-to-crypto conversions", () => {
    expect(DEFAULT_CRYPTO_CONVERSION_FEE_BPS).toBe(50);
    expect(estimateConversionFeeUsdMinor(b(200_000), 50)).toBe(b(1_000)); // $2000 -> $10
    expect(estimateConversionFeeUsdMinor(b(2_400), 50)).toBe(b(12)); // $24.00 -> $0.12
    expect(estimateConversionFeeUsdMinor(b(1), 50)).toBe(b(0));
  });

  it("charges nothing for direct crypto receipts (0 bps)", () => {
    expect(estimateConversionFeeUsdMinor(b(200_000), 0)).toBe(b(0));
    expect(estimateConversionFeeUsdMinor(b(999_999_999), 0)).toBe(b(0));
  });

  it("rejects negative amounts and bad rates", () => {
    expect(() => estimateConversionFeeUsdMinor(b(-1), 50)).toThrow(/negative/u);
    expect(() => estimateConversionFeeUsdMinor(b(1), -1)).toThrow(/basis points/u);
  });
});

describe("allocateBatchFees", () => {
  it("splits actual fees across orders by USD share and reconciles exactly", () => {
    // Three orders: $100, $50, $25 sharing a $1.00 fee and $0.10 chain fee.
    const amounts = [b(10_000), b(5_000), b(2_500)];
    const parts = allocateBatchFees(amounts, b(100), b(10));
    expect(parts.map((p) => p.feeUsdMinor)).toEqual([b(57), b(29), b(14)]);
    expect(sumSignedMinor(parts.map((p) => p.feeUsdMinor))).toBe(b(100));
    expect(sumSignedMinor(parts.map((p) => p.chainFeeUsdMinor))).toBe(b(10));
  });

  it("handles indivisible cents without losing or inventing money", () => {
    const amounts = [b(1), b(1), b(1)];
    const parts = allocateBatchFees(amounts, b(1), b(2));
    expect(sumSignedMinor(parts.map((p) => p.feeUsdMinor))).toBe(b(1));
    expect(sumSignedMinor(parts.map((p) => p.chainFeeUsdMinor))).toBe(b(2));
    // No entry receives a negative allocation.
    for (const part of parts) {
      expect(part.feeUsdMinor >= b(0)).toBe(true);
      expect(part.chainFeeUsdMinor >= b(0)).toBe(true);
    }
  });

  it("single-order batches take the whole fee", () => {
    const parts = allocateBatchFees([b(12_345)], b(63), b(7));
    expect(parts).toEqual([{ feeUsdMinor: b(63), chainFeeUsdMinor: b(7) }]);
  });

  it("rejects negative fees", () => {
    expect(() => allocateBatchFees([b(1)], b(-1), b(0))).toThrow(/negative/u);
  });
});
