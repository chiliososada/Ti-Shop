import {
  allocateProportionally,
  applyBps,
  sumSignedMinor,
} from "@/server/finance/math/rounding";

export const DEFAULT_CRYPTO_CONVERSION_FEE_BPS = 50; // 0.5%

/**
 * Estimated USD→crypto conversion fee. Direct crypto receipts must pass
 * bps = 0 (enforced again by a database check constraint).
 */
export function estimateConversionFeeUsdMinor(
  convertedUsdMinor: bigint,
  feeRateBps: number,
): bigint {
  if (convertedUsdMinor < BigInt(0)) {
    throw new RangeError("Converted amount must not be negative.");
  }
  return applyBps(convertedUsdMinor, feeRateBps);
}

export type BatchFeeAllocation = {
  feeUsdMinor: bigint;
  chainFeeUsdMinor: bigint;
};

/**
 * Allocates a batch's conversion fee and chain fee across the participating
 * entries in proportion to each entry's USD amount. The allocations sum to
 * exactly the given fees; the largest-remainder rule places the final cent.
 */
export function allocateBatchFees(
  entryUsdMinorAmounts: readonly bigint[],
  feeUsdMinor: bigint,
  chainFeeUsdMinor: bigint,
): BatchFeeAllocation[] {
  if (feeUsdMinor < BigInt(0) || chainFeeUsdMinor < BigInt(0)) {
    throw new RangeError("Batch fees must not be negative.");
  }
  const feeParts = allocateProportionally(feeUsdMinor, entryUsdMinorAmounts);
  const chainParts = allocateProportionally(chainFeeUsdMinor, entryUsdMinorAmounts);

  const allocations = entryUsdMinorAmounts.map((_, index) => ({
    feeUsdMinor: feeParts[index],
    chainFeeUsdMinor: chainParts[index],
  }));

  // Invariant: allocations reconcile exactly with the input fees.
  if (
    sumSignedMinor(allocations.map((entry) => entry.feeUsdMinor)) !== feeUsdMinor ||
    sumSignedMinor(allocations.map((entry) => entry.chainFeeUsdMinor)) !== chainFeeUsdMinor
  ) {
    throw new Error("Fee allocation failed to reconcile with the batch totals.");
  }
  return allocations;
}
