import { describe, expect, it } from "vitest";

import {
  cnyMinorToUsdMinor,
  usdMinorToCnyMinor,
  validateFxRate,
} from "@/server/finance/math/fx";

const b = BigInt;

describe("cnyMinorToUsdMinor", () => {
  it("converts CNY fen to USD cents at a CNY-per-USD rate", () => {
    expect(cnyMinorToUsdMinor(b(72_500), "7.25")).toBe(b(10_000)); // ¥725 -> $100
    expect(cnyMinorToUsdMinor(b(100), "7.25")).toBe(b(14)); // ¥1 -> 13.79¢ -> 14
    expect(cnyMinorToUsdMinor(b(0), "7.25")).toBe(b(0));
  });

  it("is a pure function of the historical rate (snapshot semantics)", () => {
    const cny = b(123_456); // ¥1,234.56
    expect(cnyMinorToUsdMinor(cny, "7.25")).toBe(b(17_028)); // 17027.03 -> ?
    expect(cnyMinorToUsdMinor(cny, "7.30")).toBe(b(16_912));
    // Same inputs always reproduce the same USD result.
    expect(cnyMinorToUsdMinor(cny, "7.25")).toBe(cnyMinorToUsdMinor(cny, "7.25"));
  });

  it("supports high-precision rates without float drift", () => {
    expect(cnyMinorToUsdMinor(b(1_000_000), "7.12345678")).toBe(b(140_381));
  });

  it("rejects negative amounts", () => {
    expect(() => cnyMinorToUsdMinor(b(-1), "7.25")).toThrow(/negative/u);
  });
});

describe("usdMinorToCnyMinor", () => {
  it("round-trips within one minor unit", () => {
    const usd = b(10_000);
    const cny = usdMinorToCnyMinor(usd, "7.25");
    expect(cny).toBe(b(72_500));
    const back = cnyMinorToUsdMinor(cny, "7.25");
    expect(back >= usd - b(1) && back <= usd + b(1)).toBe(true);
  });
});

describe("validateFxRate", () => {
  it("accepts sane positive rates", () => {
    expect(validateFxRate(" 7.25 ")).toBe("7.25");
    expect(validateFxRate("0.00001")).toBe("0.00001");
    expect(validateFxRate("999999")).toBe("999999");
  });

  it("rejects zero, negatives, over-precision, and out-of-range values", () => {
    for (const bad of ["0", "-7.25", "7.123456789", "0.0000001", "10000000", "abc", ""]) {
      expect(() => validateFxRate(bad)).toThrow();
    }
  });
});
