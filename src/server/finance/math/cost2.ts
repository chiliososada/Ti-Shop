import { divideRoundHalfUp } from "@/server/finance/math/rounding";

/**
 * Partner-inclusive Cost 2 in USD cents:
 *   Cost 2 = Cost 1 + (selling price - Cost 1) / 2
 *
 * The half is rounded away from zero so all results remain exact integer
 * cents and match the database trigger used for persisted values.
 */
export function calculateCost2UsdMinor(
  sellingPriceUsdMinor: bigint,
  cost1UsdMinor: bigint,
): bigint {
  if (sellingPriceUsdMinor < BigInt(0) || cost1UsdMinor < BigInt(0)) {
    throw new RangeError("Cost 2 requires non-negative selling price and Cost 1.");
  }
  return (
    cost1UsdMinor +
    divideRoundHalfUp(sellingPriceUsdMinor - cost1UsdMinor, BigInt(2))
  );
}

export function splitCost2UsdMinor(input: {
  sellingPriceUsdMinor: bigint;
  cost1UsdMinor: bigint;
}) {
  const cost2UsdMinor = calculateCost2UsdMinor(
    input.sellingPriceUsdMinor,
    input.cost1UsdMinor,
  );
  return {
    cost2UsdMinor,
    partnerShareUsdMinor: cost2UsdMinor - input.cost1UsdMinor,
    ownerShareUsdMinor: input.sellingPriceUsdMinor - cost2UsdMinor,
  };
}
