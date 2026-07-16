import { describe, expect, it } from "vitest";

import {
  compareDecimal,
  parseDecimal,
  positiveDecimalOrNull,
  usdDecimalToMinor,
  usdMinorToDecimalString,
  usdMinorToNumber,
} from "@/server/payments/nowpayments/decimal";

describe("NOWPayments decimal helpers", () => {
  it("compares decimal and exponent forms without floating-point math", () => {
    expect(compareDecimal("1.2300", "1.23")).toBe(0);
    expect(compareDecimal("1.230000000000000001", "1.23")).toBe(1);
    expect(compareDecimal("1e-8", "0.00000002")).toBe(-1);
    expect(parseDecimal("-0.00").coefficient).toBe(BigInt(0));
  });

  it("converts exact USD values to and from cents", () => {
    expect(usdDecimalToMinor("46")).toBe(BigInt(4_600));
    expect(usdDecimalToMinor("75.00")).toBe(BigInt(7_500));
    expect(usdMinorToNumber(BigInt(4_601))).toBe(46.01);
    expect(usdMinorToDecimalString(BigInt(4_601))).toBe("46.01");
    expect(() => usdDecimalToMinor("1.001")).toThrow(/two decimal/u);
  });

  it("stores event crypto amounts only when they are positive", () => {
    expect(positiveDecimalOrNull(null)).toBeNull();
    expect(positiveDecimalOrNull("0.000000000000000000")).toBeNull();
    expect(positiveDecimalOrNull("1e-18")).toBe("1e-18");
  });
});
