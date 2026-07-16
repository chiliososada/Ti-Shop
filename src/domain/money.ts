export const USD_CURRENCY = "USD" as const;
export const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");

function assertMinorAmount(value: bigint, name: string) {
  if (value < BigInt(0) || value > MAX_POSTGRES_BIGINT) {
    throw new RangeError(`${name} is outside the supported minor-unit range.`);
  }
}

export function multiplyMinorAmount(unitAmountMinor: bigint, quantity: number) {
  assertMinorAmount(unitAmountMinor, "Unit amount");

  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new RangeError("Quantity must be a positive safe integer.");
  }

  const total = unitAmountMinor * BigInt(quantity);
  assertMinorAmount(total, "Line total");
  return total;
}

export function addMinorAmounts(values: readonly bigint[]) {
  let total = BigInt(0);

  for (const value of values) {
    assertMinorAmount(value, "Minor amount");
    total += value;
    assertMinorAmount(total, "Amount total");
  }

  return total;
}

export function formatUsdMinor(value: bigint | string) {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  assertMinorAmount(amount, "USD amount");

  const digits = amount.toString().padStart(3, "0");
  const dollars = digits.slice(0, -2).replace(/^0+(?=\d)/u, "");
  return `$${dollars}.${digits.slice(-2)}`;
}

