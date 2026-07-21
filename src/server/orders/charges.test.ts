import { describe, expect, it } from "vitest";

import {
  allocateCheckoutTax,
  calculateConfiguredCheckoutCharges,
  calculateTieredShippingMinor,
  parseConfiguredCheckoutCharges,
} from "./charges";

// The merchant's live configuration: first 4 boxes $90, each further 4 +$15.
const TIER = {
  shippingFirstBlockMinor: "9000",
  shippingBlockUnits: 4,
  shippingAdditionalBlockMinor: "1500",
  taxRateBps: 0,
};

describe("configured checkout charges", () => {
  it("fails closed until every field is explicitly configured", () => {
    expect(
      parseConfiguredCheckoutCharges({
        configured: false,
        shippingFirstBlockMinor: null,
        shippingBlockUnits: null,
        shippingAdditionalBlockMinor: null,
        taxRateBps: null,
      }),
    ).toBeNull();
    // Missing any single required field fails closed.
    expect(
      parseConfiguredCheckoutCharges({
        configured: true,
        shippingFirstBlockMinor: "9000",
        shippingBlockUnits: null,
        shippingAdditionalBlockMinor: "1500",
        taxRateBps: 0,
      }),
    ).toBeNull();
    expect(
      parseConfiguredCheckoutCharges({
        configured: true,
        shippingFirstBlockMinor: "not-a-number",
        shippingBlockUnits: 4,
        shippingAdditionalBlockMinor: "1500",
        taxRateBps: 0,
      }),
    ).toBeNull();
  });

  it("accepts explicit zero values without assuming them by default", () => {
    expect(
      parseConfiguredCheckoutCharges({
        configured: true,
        shippingFirstBlockMinor: "0",
        shippingBlockUnits: 1,
        shippingAdditionalBlockMinor: "0",
        taxRateBps: 0,
      }),
    ).toEqual({
      shippingFirstBlockMinor: "0",
      shippingBlockUnits: 1,
      shippingAdditionalBlockMinor: "0",
      taxRateBps: 0,
    });
  });

  it.each([
    [1, 9000],
    [4, 9000], // first block
    [5, 10500], // +1 block
    [8, 10500],
    [9, 12000], // +2 blocks
    [12, 12000],
    [13, 13500], // +3 blocks
  ])("weight-tiers shipping: %i boxes → %i cents", (boxes, expected) => {
    expect(calculateTieredShippingMinor(boxes, TIER)).toBe(BigInt(expected));
  });

  it("charges nothing for a non-positive box count", () => {
    expect(calculateTieredShippingMinor(0, TIER)).toBe(BigInt(0));
    expect(calculateTieredShippingMinor(-3, TIER)).toBe(BigInt(0));
  });

  it("combines tiered shipping with half-up basis-point tax", () => {
    // 6 boxes → 2 blocks → $105 shipping; subtotal 4601 @ 8.25% → 380 tax.
    expect(
      calculateConfiguredCheckoutCharges(BigInt(4_601), 6, {
        ...TIER,
        taxRateBps: 825,
      }),
    ).toEqual({
      shippingMinor: BigInt(10_500),
      taxMinor: BigInt(380),
      totalMinor: BigInt(15_481),
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
