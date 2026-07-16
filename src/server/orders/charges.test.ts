import { describe, expect, it } from "vitest";

import {
  allocateCheckoutTax,
  calculateConfiguredCheckoutCharges,
  parseConfiguredCheckoutCharges,
} from "./charges";

describe("configured checkout charges", () => {
  it("fails closed until shipping and tax are explicitly configured", () => {
    expect(
      parseConfiguredCheckoutCharges({
        configured: false,
        shippingFlatMinor: null,
        taxRateBps: null,
      }),
    ).toBeNull();
    expect(
      parseConfiguredCheckoutCharges({
        configured: true,
        shippingFlatMinor: null,
        taxRateBps: 0,
      }),
    ).toBeNull();
    expect(
      parseConfiguredCheckoutCharges({
        configured: true,
        shippingFlatMinor: "not-a-number",
        taxRateBps: 0,
      }),
    ).toBeNull();
  });

  it("accepts explicit zero values without assuming them by default", () => {
    expect(
      parseConfiguredCheckoutCharges({
        configured: true,
        shippingFlatMinor: "0",
        taxRateBps: 0,
      }),
    ).toEqual({ shippingFlatMinor: "0", taxRateBps: 0 });
  });

  it("uses bigint cents and half-up basis-point rounding", () => {
    expect(
      calculateConfiguredCheckoutCharges(BigInt(4_601), {
        shippingFlatMinor: "500",
        taxRateBps: 825,
      }),
    ).toEqual({
      shippingMinor: BigInt(500),
      taxMinor: BigInt(380),
      totalMinor: BigInt(5_481),
    });
  });

  it("allocates rounded order tax deterministically across item snapshots", () => {
    expect(
      allocateCheckoutTax([BigInt(1_001), BigInt(4_004)], BigInt(413)),
    ).toEqual([BigInt(83), BigInt(330)]);
    expect(
      allocateCheckoutTax(
        [BigInt(101), BigInt(101), BigInt(101)],
        BigInt(25),
      ),
    ).toEqual([BigInt(9), BigInt(8), BigInt(8)]);
    expect(allocateCheckoutTax([BigInt(0)], BigInt(0))).toEqual([BigInt(0)]);
  });
});
