// Centralized integer rounding rules for every finance calculation. All
// amounts are USD cents (bigint); rates are basis points or decimal strings.
// JavaScript floating point is never used for money.

/**
 * Signed integer division rounding half away from zero ("commercial"
 * rounding). This is THE rounding rule for finance; nothing else may divide
 * monetary amounts.
 */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === BigInt(0)) {
    throw new RangeError("Division by zero in a finance calculation.");
  }
  const negative = numerator < BigInt(0) !== denominator < BigInt(0);
  const absNumerator = numerator < BigInt(0) ? -numerator : numerator;
  const absDenominator = denominator < BigInt(0) ? -denominator : denominator;
  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  const roundedUp =
    remainder * BigInt(2) >= absDenominator ? quotient + BigInt(1) : quotient;
  return negative ? -roundedUp : roundedUp;
}

export const BPS_DENOMINATOR = BigInt(10_000);

export function assertBps(bps: number, label = "basis points"): void {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10_000) {
    throw new RangeError(`${label} must be an integer between 0 and 10000.`);
  }
}

/** amount × bps / 10000, rounded half away from zero. */
export function applyBps(amountMinor: bigint, bps: number): bigint {
  assertBps(bps);
  return divideRoundHalfUp(amountMinor * BigInt(bps), BPS_DENOMINATOR);
}

/**
 * Allocates an exact total across weights using the largest-remainder method.
 * The returned parts always sum to exactly `total`; the final cent goes to
 * the entry with the largest truncated remainder (ties: earliest entry).
 * Negative totals allocate symmetrically. Weights must be non-negative and
 * cannot all be zero unless the total is zero.
 */
export function allocateProportionally(
  total: bigint,
  weights: readonly bigint[],
): bigint[] {
  if (weights.length === 0) {
    throw new RangeError("At least one allocation weight is required.");
  }
  for (const weight of weights) {
    if (weight < BigInt(0)) {
      throw new RangeError("Allocation weights cannot be negative.");
    }
  }
  const weightSum = weights.reduce((sum, weight) => sum + weight, BigInt(0));
  if (weightSum === BigInt(0)) {
    if (total !== BigInt(0)) {
      throw new RangeError("Cannot allocate a non-zero total across zero weights.");
    }
    return weights.map(() => BigInt(0));
  }

  const negative = total < BigInt(0);
  const absTotal = negative ? -total : total;

  const floors = weights.map((weight) => (absTotal * weight) / weightSum);
  const remainders = weights.map(
    (weight, index) => absTotal * weight - floors[index] * weightSum,
  );
  let remaining = absTotal - floors.reduce((sum, part) => sum + part, BigInt(0));

  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.index - b.index
        : a.remainder > b.remainder
          ? -1
          : 1,
    );

  const parts = [...floors];
  for (const { index } of order) {
    if (remaining === BigInt(0)) break;
    parts[index] += BigInt(1);
    remaining -= BigInt(1);
  }

  return negative ? parts.map((part) => -part) : parts;
}

/** Sum helper for signed minor amounts (bigint-safe, no float). */
export function sumSignedMinor(values: readonly bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, BigInt(0));
}
