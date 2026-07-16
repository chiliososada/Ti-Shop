import { parseDecimal } from "@/server/payments/nowpayments/decimal";

import { divideRoundHalfUp } from "@/server/finance/math/rounding";

const MAX_RATE_SCALE = 8;

/**
 * Validates a CNY-per-USD (or comparable) exchange-rate string: positive,
 * finite, at most eight decimal places, within sane bounds. Returns the
 * trimmed input string (consumers re-parse it fixed-point; the digits are
 * not normalized).
 */
export function validateFxRate(value: string): string {
  const trimmed = value.trim();
  const parsed = parseDecimal(trimmed);
  if (parsed.coefficient <= BigInt(0)) {
    throw new RangeError("The exchange rate must be a positive number.");
  }
  if (parsed.scale > MAX_RATE_SCALE) {
    throw new RangeError(
      `The exchange rate supports at most ${MAX_RATE_SCALE} decimal places.`,
    );
  }
  // Bound check: 0.000001 <= rate <= 1,000,000 (scaled comparison, no float).
  const scaled = parsed.coefficient * BigInt(10) ** BigInt(MAX_RATE_SCALE - parsed.scale);
  const lower = BigInt(10) ** BigInt(2); // 0.000001 * 10^8
  const upper = BigInt(10) ** BigInt(14); // 1,000,000 * 10^8
  if (scaled < lower || scaled > upper) {
    throw new RangeError("The exchange rate is outside the supported range.");
  }
  return trimmed;
}

/**
 * Converts CNY minor units (fen) to USD minor units (cents) using a
 * CNY-per-USD rate string, e.g. 72500 fen at rate "7.25" -> 10000 cents.
 * usd = cny / rate, computed as an exact scaled integer division with the
 * central half-up rounding rule.
 */
export function cnyMinorToUsdMinor(cnyMinor: bigint, rateCnyPerUsd: string): bigint {
  if (cnyMinor < BigInt(0)) {
    throw new RangeError("CNY amounts must not be negative here; use signed adjustments instead.");
  }
  const rate = parseDecimal(validateFxRate(rateCnyPerUsd));
  // usdMinor = cnyMinor / (coefficient / 10^scale) = cnyMinor * 10^scale / coefficient
  return divideRoundHalfUp(cnyMinor * BigInt(10) ** BigInt(rate.scale), rate.coefficient);
}

/**
 * Converts USD minor units to CNY minor units with the same rate convention
 * (multiplication direction), for cross-checking and displays.
 */
export function usdMinorToCnyMinor(usdMinor: bigint, rateCnyPerUsd: string): bigint {
  if (usdMinor < BigInt(0)) {
    throw new RangeError("USD amounts must not be negative here; use signed adjustments instead.");
  }
  const rate = parseDecimal(validateFxRate(rateCnyPerUsd));
  return divideRoundHalfUp(usdMinor * rate.coefficient, BigInt(10) ** BigInt(rate.scale));
}
