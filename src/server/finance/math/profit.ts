import { sumSignedMinor } from "@/server/finance/math/rounding";

/**
 * Order-profit formula version. Persisted on locked settlements and included
 * in exports so historical results remain attributable to the formula that
 * produced them. Recomputing history under a newer version is an explicit
 * administrative action, never an automatic side effect of deployment.
 */
export const PROFIT_CALC_VERSION = 2;

export type ProfitAdjustmentInput = {
  type:
    | "REFUND"
    | "SHIPPING_REFUND"
    | "RETURN_SHIPPING"
    | "DAMAGED_RETURN"
    | "COMPENSATION_PRODUCT"
    | "COMPENSATION_SHIPPING"
    | "PAYMENT_FEE"
    | "CRYPTO_CONVERSION_FEE"
    | "EXCHANGE_GAIN"
    | "EXCHANGE_LOSS"
    | "MANUAL_DIRECT_COST"
    | "COST_CORRECTION"
    | "ROUNDING_ADJUSTMENT"
    | "PARTNER_SETTLEMENT_CORRECTION";
  /** Positive increases distributable profit; negative decreases it. */
  signedUsdMinor: bigint;
  isEstimated: boolean;
};

export type OrderProfitInput = {
  order: {
    subtotalMinor: bigint;
    discountMinor: bigint;
    shippingMinor: bigint;
    taxMinor: bigint;
  };
  items: {
    quantity: number;
    totalCogsUsdMinor: bigint | null;
    /** Partner-inclusive Cost 2 snapshot; supplemental to official COGS. */
    totalCost2UsdMinor?: bigint | null;
    /** True when COGS came from a supplier-list reference instead of a receipt. */
    costIsEstimated?: boolean;
    /** Zero-priced compensation lines: excluded from revenue and COGS here. */
    isCompensation: boolean;
  }[];
  shipments: {
    status: string;
    shippingCostMinor: bigint | null;
    packagingCostMinor: bigint | null;
  }[];
  conversionEntries: {
    allocatedFeeUsdMinor: bigint;
    allocatedChainFeeUsdMinor: bigint;
    batchStatus: "DRAFT" | "COMPLETED" | "VOIDED";
    feeIsEstimated: boolean;
  }[];
  adjustments: ProfitAdjustmentInput[];
};

export type OrderProfitBreakdown = {
  calcVersion: number;
  /** Revenue */
  merchandiseRevenueUsdMinor: bigint;
  shippingRevenueUsdMinor: bigint;
  taxCollectedUsdMinor: bigint;
  operatingRevenueUsdMinor: bigint;
  refundsUsdMinor: bigint;
  shippingRefundsUsdMinor: bigint;
  netOperatingRevenueUsdMinor: bigint;
  /** Direct costs (positive figures) */
  cogsUsdMinor: bigint;
  /** Cost 2 reporting (does not replace official COGS or settlement logic). */
  cost2UsdMinor: bigint;
  partnerMerchandiseShareUsdMinor: bigint;
  shippingCostUsdMinor: bigint;
  packagingCostUsdMinor: bigint;
  paymentFeesUsdMinor: bigint;
  conversionFeesUsdMinor: bigint;
  afterSalesCostUsdMinor: bigint;
  otherDirectCostUsdMinor: bigint;
  exchangeNetUsdMinor: bigint;
  costCorrectionsUsdMinor: bigint;
  /** Results (signed) */
  finalProfitUsdMinor: bigint;
  profitAfterCost2UsdMinor: bigint;
  /** True when one or more merchandise lines lack a complete Cost 2 snapshot. */
  cost2HasMissingSnapshots: boolean;
  cost2IsEstimated: boolean;
  /** Basis points; null when net revenue is zero. */
  marginBps: number | null;
  /** Estimation state */
  isEstimated: boolean;
  estimationReasons: string[];
};

const REFUND_TYPES = new Set(["REFUND"]);
const SHIPPING_REFUND_TYPES = new Set(["SHIPPING_REFUND"]);
const AFTER_SALES_TYPES = new Set([
  "RETURN_SHIPPING",
  "DAMAGED_RETURN",
  "COMPENSATION_PRODUCT",
  "COMPENSATION_SHIPPING",
]);
const PAYMENT_FEE_TYPES = new Set(["PAYMENT_FEE"]);
const CONVERSION_FEE_TYPES = new Set(["CRYPTO_CONVERSION_FEE"]);
const EXCHANGE_TYPES = new Set(["EXCHANGE_GAIN", "EXCHANGE_LOSS"]);
const OTHER_COST_TYPES = new Set([
  "MANUAL_DIRECT_COST",
  "ROUNDING_ADJUSTMENT",
  "PARTNER_SETTLEMENT_CORRECTION",
]);
const COST_CORRECTION_TYPES = new Set(["COST_CORRECTION"]);

function negatedSum(values: readonly bigint[]): bigint {
  return -sumSignedMinor(values);
}

/**
 * The single order-profit waterfall (version PROFIT_CALC_VERSION).
 *
 *   merchandise revenue = subtotal − discount
 *   operating revenue   = merchandise revenue + shipping charged
 *   net revenue         = operating revenue − refunds − shipping refunds
 *   final profit        = net revenue
 *                         − COGS − actual shipping − packaging
 *                         − payment fees − conversion fees
 *                         − after-sales costs − other direct costs
 *                         + cost corrections + exchange net
 * Collected tax is tracked separately and is not revenue or profit.
 */
export function computeOrderProfit(input: OrderProfitInput): OrderProfitBreakdown {
  const estimationReasons: string[] = [];

  const merchandiseRevenueUsdMinor =
    input.order.subtotalMinor - input.order.discountMinor;
  const shippingRevenueUsdMinor = input.order.shippingMinor;
  const operatingRevenueUsdMinor =
    merchandiseRevenueUsdMinor + shippingRevenueUsdMinor;

  // COGS from immutable snapshots. Compensation lines carry no revenue and no
  // COGS on this order (their cost lives on the originating after-sales
  // event). Any other line without a snapshot means the goods cost is
  // unknown (never procured, or valuation shortfall), so the whole result is
  // estimated — cost knowledge, not the trackInventory flag, decides this.
  let cogsUsdMinor = BigInt(0);
  let cost2UsdMinor = BigInt(0);
  let cost2HasMissingSnapshots = false;
  let cost2IsEstimated = false;
  for (const item of input.items) {
    if (item.isCompensation) continue;
    if (item.totalCogsUsdMinor !== null) {
      cogsUsdMinor += item.totalCogsUsdMinor;
      if (item.totalCost2UsdMinor == null) {
        cost2HasMissingSnapshots = true;
        cost2IsEstimated = true;
      } else {
        cost2UsdMinor += item.totalCost2UsdMinor;
      }
      if (item.costIsEstimated) {
        estimationReasons.push("reference_cost_snapshot");
        cost2IsEstimated = true;
      }
    } else {
      estimationReasons.push("missing_cost_snapshot");
      cost2HasMissingSnapshots = true;
      cost2IsEstimated = true;
    }
  }

  let shippingCostUsdMinor = BigInt(0);
  let packagingCostUsdMinor = BigInt(0);
  let hasActiveShipment = false;
  for (const shipment of input.shipments) {
    if (shipment.status === "CANCELED") {
      // Canceled shipments count only when a cost was actually incurred.
      shippingCostUsdMinor += shipment.shippingCostMinor ?? BigInt(0);
      packagingCostUsdMinor += shipment.packagingCostMinor ?? BigInt(0);
      continue;
    }
    hasActiveShipment = true;
    if (shipment.shippingCostMinor === null) {
      estimationReasons.push("missing_shipping_cost");
    } else {
      shippingCostUsdMinor += shipment.shippingCostMinor;
    }
    packagingCostUsdMinor += shipment.packagingCostMinor ?? BigInt(0);
  }
  // Every order here ships physical goods, so an order with no active
  // shipment has an UNKNOWN logistics cost, not a zero one. Without this
  // flag the customer's shipping charge would read as pure, finalized
  // margin until dispatch.
  if (!hasActiveShipment) {
    estimationReasons.push("not_yet_shipped");
  }

  let conversionFeesUsdMinor = BigInt(0);
  for (const entry of input.conversionEntries) {
    if (entry.batchStatus === "VOIDED") continue;
    conversionFeesUsdMinor +=
      entry.allocatedFeeUsdMinor + entry.allocatedChainFeeUsdMinor;
    if (entry.batchStatus !== "COMPLETED" || entry.feeIsEstimated) {
      estimationReasons.push("conversion_fee_estimated");
    }
  }

  const byType = (types: ReadonlySet<string>) =>
    input.adjustments.filter((adjustment) => types.has(adjustment.type));
  for (const adjustment of input.adjustments) {
    if (adjustment.isEstimated) {
      estimationReasons.push(`estimated_adjustment_${adjustment.type.toLowerCase()}`);
    }
  }

  const refundsUsdMinor = negatedSum(byType(REFUND_TYPES).map((a) => a.signedUsdMinor));
  const shippingRefundsUsdMinor = negatedSum(
    byType(SHIPPING_REFUND_TYPES).map((a) => a.signedUsdMinor),
  );
  const afterSalesCostUsdMinor = negatedSum(
    byType(AFTER_SALES_TYPES).map((a) => a.signedUsdMinor),
  );
  const paymentFeesUsdMinor = negatedSum(
    byType(PAYMENT_FEE_TYPES).map((a) => a.signedUsdMinor),
  );
  const adjustmentConversionFees = negatedSum(
    byType(CONVERSION_FEE_TYPES).map((a) => a.signedUsdMinor),
  );
  const otherDirectCostUsdMinor = negatedSum(
    byType(OTHER_COST_TYPES).map((a) => a.signedUsdMinor),
  );
  const exchangeNetUsdMinor = sumSignedMinor(
    byType(EXCHANGE_TYPES).map((a) => a.signedUsdMinor),
  );
  const costCorrectionsUsdMinor = sumSignedMinor(
    byType(COST_CORRECTION_TYPES).map((a) => a.signedUsdMinor),
  );

  const netOperatingRevenueUsdMinor =
    operatingRevenueUsdMinor - refundsUsdMinor - shippingRefundsUsdMinor;

  const totalConversionFees = conversionFeesUsdMinor + adjustmentConversionFees;

  const finalProfitUsdMinor =
    netOperatingRevenueUsdMinor -
    cogsUsdMinor -
    shippingCostUsdMinor -
    packagingCostUsdMinor -
    paymentFeesUsdMinor -
    totalConversionFees -
    afterSalesCostUsdMinor -
    otherDirectCostUsdMinor +
    costCorrectionsUsdMinor +
    exchangeNetUsdMinor;

  const partnerMerchandiseShareUsdMinor = cost2UsdMinor - cogsUsdMinor;
  const profitAfterCost2UsdMinor =
    finalProfitUsdMinor - partnerMerchandiseShareUsdMinor;

  // Margin in basis points against tax-exclusive net operating revenue.
  const marginBps =
    netOperatingRevenueUsdMinor === BigInt(0)
      ? null
      : Number(
          (finalProfitUsdMinor * BigInt(10_000)) / netOperatingRevenueUsdMinor,
        );

  return {
    calcVersion: PROFIT_CALC_VERSION,
    merchandiseRevenueUsdMinor,
    shippingRevenueUsdMinor,
    taxCollectedUsdMinor: input.order.taxMinor,
    operatingRevenueUsdMinor,
    refundsUsdMinor,
    shippingRefundsUsdMinor,
    netOperatingRevenueUsdMinor,
    cogsUsdMinor,
    cost2UsdMinor,
    partnerMerchandiseShareUsdMinor,
    shippingCostUsdMinor,
    packagingCostUsdMinor,
    paymentFeesUsdMinor,
    conversionFeesUsdMinor: totalConversionFees,
    afterSalesCostUsdMinor,
    otherDirectCostUsdMinor,
    exchangeNetUsdMinor,
    costCorrectionsUsdMinor,
    finalProfitUsdMinor,
    profitAfterCost2UsdMinor,
    cost2HasMissingSnapshots,
    cost2IsEstimated,
    marginBps,
    isEstimated: estimationReasons.length > 0,
    estimationReasons: [...new Set(estimationReasons)],
  };
}
