import { describe, expect, it } from "vitest";

import {
  computeOrderProfit,
  PROFIT_CALC_VERSION,
  type OrderProfitInput,
} from "@/server/finance/math/profit";

const b = BigInt;

function baseOrder(): OrderProfitInput {
  return {
    // $200 goods + $15 shipping charged + $10 tax collected.
    order: {
      subtotalMinor: b(20_000),
      discountMinor: b(0),
      shippingMinor: b(1_500),
      taxMinor: b(1_000),
    },
    items: [
      {
        quantity: 2,
        totalCogsUsdMinor: b(6_000), // $60 COGS
        isCompensation: false,
      },
    ],
    shipments: [
      { status: "DELIVERED", shippingCostMinor: b(900), packagingCostMinor: b(100) },
    ],
    conversionEntries: [],
    adjustments: [],
  };
}

describe("computeOrderProfit", () => {
  it("computes the plain waterfall and excludes collected tax from revenue", () => {
    const result = computeOrderProfit(baseOrder());
    expect(result.calcVersion).toBe(PROFIT_CALC_VERSION);
    expect(result.merchandiseRevenueUsdMinor).toBe(b(20_000));
    expect(result.shippingRevenueUsdMinor).toBe(b(1_500));
    expect(result.taxCollectedUsdMinor).toBe(b(1_000));
    expect(result.operatingRevenueUsdMinor).toBe(b(21_500));
    // 21500 - 6000 (COGS) - 900 (shipping cost) - 100 (packaging) = 14500
    expect(result.finalProfitUsdMinor).toBe(b(14_500));
    // Shipping spread: charged $15, paid $9.
    expect(result.shippingRevenueUsdMinor - result.shippingCostUsdMinor).toBe(b(600));
    expect(result.isEstimated).toBe(false);
    // margin = 14500 / 21500 = 67.44% -> 6744 bps (truncated integer bps)
    expect(result.marginBps).toBe(6744);
  });

  it("flags estimation when actual shipping cost is missing", () => {
    const input = baseOrder();
    input.shipments = [
      { status: "IN_TRANSIT", shippingCostMinor: null, packagingCostMinor: null },
    ];
    const result = computeOrderProfit(input);
    expect(result.isEstimated).toBe(true);
    expect(result.estimationReasons).toContain("missing_shipping_cost");
    expect(result.shippingCostUsdMinor).toBe(b(0));
  });

  it("sums multiple shipments and skips costless canceled shipments", () => {
    const input = baseOrder();
    input.shipments = [
      { status: "DELIVERED", shippingCostMinor: b(500), packagingCostMinor: b(50) },
      { status: "DELIVERED", shippingCostMinor: b(400), packagingCostMinor: b(50) },
      { status: "CANCELED", shippingCostMinor: null, packagingCostMinor: null },
      { status: "CANCELED", shippingCostMinor: b(200), packagingCostMinor: null },
    ];
    const result = computeOrderProfit(input);
    // Canceled-without-cost adds nothing and does not flag estimation;
    // canceled-with-cost still counts as real spend.
    expect(result.shippingCostUsdMinor).toBe(b(1_100));
    expect(result.isEstimated).toBe(false);
  });

  it("flags unshipped orders — the shipping charge is not finalized margin", () => {
    const input = baseOrder();
    input.shipments = [];
    const result = computeOrderProfit(input);
    expect(result.isEstimated).toBe(true);
    expect(result.estimationReasons).toContain("not_yet_shipped");

    // Only canceled shipments = still nothing dispatched.
    const canceledOnly = baseOrder();
    canceledOnly.shipments = [
      { status: "CANCELED", shippingCostMinor: b(200), packagingCostMinor: null },
    ];
    expect(computeOrderProfit(canceledOnly).estimationReasons).toContain(
      "not_yet_shipped",
    );
  });

  it("flags any non-compensation line with a missing cost snapshot", () => {
    const input = baseOrder();
    input.items = [
      { quantity: 1, totalCogsUsdMinor: null, isCompensation: false },
      { quantity: 1, totalCogsUsdMinor: null, isCompensation: false },
      { quantity: 1, totalCogsUsdMinor: null, isCompensation: true },
    ];
    const result = computeOrderProfit(input);
    expect(result.estimationReasons).toEqual(["missing_cost_snapshot"]);
    expect(result.cogsUsdMinor).toBe(b(0));
  });

  it("full refund with resalable return reverses revenue and restores COGS", () => {
    const input = baseOrder();
    input.adjustments = [
      { type: "REFUND", signedUsdMinor: b(-20_000), isEstimated: false },
      { type: "SHIPPING_REFUND", signedUsdMinor: b(-1_500), isEstimated: false },
      // Restocked goods reverse the recognized COGS.
      { type: "COST_CORRECTION", signedUsdMinor: b(6_000), isEstimated: false },
      // Return label paid by the merchant.
      { type: "RETURN_SHIPPING", signedUsdMinor: b(-800), isEstimated: false },
    ];
    const result = computeOrderProfit(input);
    expect(result.refundsUsdMinor).toBe(b(20_000));
    expect(result.shippingRefundsUsdMinor).toBe(b(1_500));
    expect(result.netOperatingRevenueUsdMinor).toBe(b(0));
    // 0 - 6000 COGS - 900 - 100 + 6000 correction - 800 return shipping = -1800
    expect(result.finalProfitUsdMinor).toBe(b(-1_800));
  });

  it("non-resalable return keeps the goods loss", () => {
    const input = baseOrder();
    input.adjustments = [
      { type: "REFUND", signedUsdMinor: b(-20_000), isEstimated: false },
      { type: "DAMAGED_RETURN", signedUsdMinor: b(0), isEstimated: false },
      { type: "RETURN_SHIPPING", signedUsdMinor: b(-800), isEstimated: false },
    ];
    const result = computeOrderProfit(input);
    // COGS stays: goods cannot be resold. Loss = 1500 shipping revenue
    // - 6000 - 900 - 100 - 800 = -6300
    expect(result.finalProfitUsdMinor).toBe(b(-6_300));
  });

  it("refund without return keeps the original COGS in place", () => {
    const input = baseOrder();
    input.adjustments = [
      { type: "REFUND", signedUsdMinor: b(-20_000), isEstimated: false },
    ];
    const result = computeOrderProfit(input);
    // 1500 - 6000 - 900 - 100 = -5500
    expect(result.finalProfitUsdMinor).toBe(b(-5_500));
  });

  it("counts compensation goods cost via adjustments, not via the gift line", () => {
    const input = baseOrder();
    // A $35-cost replacement was shipped for free with $6 extra postage.
    input.adjustments = [
      { type: "COMPENSATION_PRODUCT", signedUsdMinor: b(-3_500), isEstimated: false },
      { type: "COMPENSATION_SHIPPING", signedUsdMinor: b(-600), isEstimated: false },
    ];
    const result = computeOrderProfit(input);
    expect(result.afterSalesCostUsdMinor).toBe(b(4_100));
    expect(result.finalProfitUsdMinor).toBe(b(14_500) - b(4_100));
  });

  it("gift lines in a later order add no revenue and no COGS there", () => {
    const giftOrder = computeOrderProfit({
      order: {
        subtotalMinor: b(5_000), // paid goods on the new order only
        discountMinor: b(0),
        shippingMinor: b(700),
        taxMinor: b(0),
      },
      items: [
        { quantity: 1, totalCogsUsdMinor: b(1_500), isCompensation: false },
        // The compensation line: price 0 on this order, cost attributed to
        // the original after-sales event.
        { quantity: 1, totalCogsUsdMinor: null, isCompensation: true },
      ],
      shipments: [
        { status: "DELIVERED", shippingCostMinor: b(650), packagingCostMinor: b(0) },
      ],
      conversionEntries: [],
      adjustments: [],
    });
    expect(giftOrder.cogsUsdMinor).toBe(b(1_500));
    expect(giftOrder.isEstimated).toBe(false);
    expect(giftOrder.finalProfitUsdMinor).toBe(b(5_000) + b(700) - b(1_500) - b(650));
  });

  it("uses actual conversion fees when completed and flags drafts as estimated", () => {
    const estimated = baseOrder();
    estimated.conversionEntries = [
      {
        allocatedFeeUsdMinor: b(108), // estimated 0.5% of $215
        allocatedChainFeeUsdMinor: b(0),
        batchStatus: "DRAFT",
        feeIsEstimated: true,
      },
    ];
    const draft = computeOrderProfit(estimated);
    expect(draft.conversionFeesUsdMinor).toBe(b(108));
    expect(draft.isEstimated).toBe(true);
    expect(draft.estimationReasons).toContain("conversion_fee_estimated");

    const finalized = baseOrder();
    finalized.conversionEntries = [
      {
        allocatedFeeUsdMinor: b(110),
        allocatedChainFeeUsdMinor: b(25),
        batchStatus: "COMPLETED",
        feeIsEstimated: false,
      },
    ];
    const done = computeOrderProfit(finalized);
    expect(done.conversionFeesUsdMinor).toBe(b(135));
    expect(done.isEstimated).toBe(false);

    const voided = baseOrder();
    voided.conversionEntries = [
      {
        allocatedFeeUsdMinor: b(999),
        allocatedChainFeeUsdMinor: b(999),
        batchStatus: "VOIDED",
        feeIsEstimated: false,
      },
    ];
    expect(computeOrderProfit(voided).conversionFeesUsdMinor).toBe(b(0));
  });

  it("handles payment fees, exchange results, and manual costs", () => {
    const input = baseOrder();
    input.adjustments = [
      { type: "PAYMENT_FEE", signedUsdMinor: b(-350), isEstimated: false },
      { type: "EXCHANGE_GAIN", signedUsdMinor: b(120), isEstimated: false },
      { type: "EXCHANGE_LOSS", signedUsdMinor: b(-80), isEstimated: false },
      { type: "MANUAL_DIRECT_COST", signedUsdMinor: b(-500), isEstimated: true },
    ];
    const result = computeOrderProfit(input);
    expect(result.paymentFeesUsdMinor).toBe(b(350));
    expect(result.exchangeNetUsdMinor).toBe(b(40));
    expect(result.otherDirectCostUsdMinor).toBe(b(500));
    expect(result.finalProfitUsdMinor).toBe(b(14_500) - b(350) + b(40) - b(500));
    expect(result.isEstimated).toBe(true);
    expect(result.estimationReasons).toContain(
      "estimated_adjustment_manual_direct_cost",
    );
  });

  it("reports null margin when net revenue is zero", () => {
    const input = baseOrder();
    input.order = {
      subtotalMinor: b(0),
      discountMinor: b(0),
      shippingMinor: b(0),
      taxMinor: b(0),
    };
    input.items = [];
    input.shipments = [];
    expect(computeOrderProfit(input).marginBps).toBeNull();
  });
});
