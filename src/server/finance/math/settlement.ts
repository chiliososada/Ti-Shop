import { applyBps, assertBps } from "@/server/finance/math/rounding";

export type PartnerShareResult = {
  /** profit + carried-over balance from earlier periods (signed). */
  distributableUsdMinor: bigint;
  /** Never negative: losses produce no positive share. */
  partnerShareUsdMinor: bigint;
  /** distributable − partner share when positive; otherwise 0. */
  ownerShareUsdMinor: bigint;
  /** Negative balance carried into the next period; 0 when profitable. */
  carryoverOutUsdMinor: bigint;
};

/**
 * Default settlement rule:
 *   adjustedProfit = periodProfit + carryoverIn
 *   adjustedProfit >  0 → partner = adjustedProfit × shareBps / 10000 (half-up)
 *   adjustedProfit <= 0 → partner = 0 and the whole negative balance carries
 *                          forward, preventing double-paid shares after
 *                          later refunds or compensation.
 */
export function computePartnerShare(input: {
  periodProfitUsdMinor: bigint;
  carryoverInUsdMinor: bigint;
  shareBps: number;
}): PartnerShareResult {
  assertBps(input.shareBps, "partner share");
  if (input.carryoverInUsdMinor > BigInt(0)) {
    throw new RangeError("Carryover balances are never positive.");
  }

  const distributableUsdMinor =
    input.periodProfitUsdMinor + input.carryoverInUsdMinor;

  if (distributableUsdMinor <= BigInt(0)) {
    return {
      distributableUsdMinor,
      partnerShareUsdMinor: BigInt(0),
      ownerShareUsdMinor: BigInt(0),
      carryoverOutUsdMinor: distributableUsdMinor,
    };
  }

  const partnerShareUsdMinor = applyBps(distributableUsdMinor, input.shareBps);
  return {
    distributableUsdMinor,
    partnerShareUsdMinor,
    ownerShareUsdMinor: distributableUsdMinor - partnerShareUsdMinor,
    carryoverOutUsdMinor: BigInt(0),
  };
}
