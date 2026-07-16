import { z } from "zod";

import {
  addMinorAmounts,
  MAX_POSTGRES_BIGINT,
} from "@/domain/money";

const checkoutChargesSettingSchema = z
  .object({
    configured: z.boolean(),
    shippingFlatMinor: z
      .string()
      .refine(
        (value) =>
          /^(?:0|[1-9]\d*)$/u.test(value) &&
          BigInt(value) <= MAX_POSTGRES_BIGINT,
      )
      .nullable(),
    taxRateBps: z.number().int().min(0).max(10_000).nullable(),
  })
  .strict();

export type CheckoutChargesDto = {
  shippingFlatMinor: string;
  taxRateBps: number;
};

export function parseConfiguredCheckoutCharges(
  value: unknown,
): CheckoutChargesDto | null {
  const parsed = checkoutChargesSettingSchema.safeParse(value);
  if (
    !parsed.success ||
    !parsed.data.configured ||
    parsed.data.shippingFlatMinor === null ||
    parsed.data.taxRateBps === null
  ) {
    return null;
  }
  return {
    shippingFlatMinor: parsed.data.shippingFlatMinor,
    taxRateBps: parsed.data.taxRateBps,
  };
}

export function calculateConfiguredCheckoutCharges(
  subtotalMinor: bigint,
  config: CheckoutChargesDto,
) {
  const shippingMinor = BigInt(config.shippingFlatMinor);
  // The configured rate applies to the merchandise subtotal only. A merchant
  // must not enable this until that rule and rate match its obligations.
  const taxMinor =
    (subtotalMinor * BigInt(config.taxRateBps) + BigInt(5_000)) /
    BigInt(10_000);
  const totalMinor = addMinorAmounts([
    subtotalMinor,
    shippingMinor,
    taxMinor,
  ]);
  return { shippingMinor, taxMinor, totalMinor };
}

/**
 * Allocates the already-rounded order tax across item snapshots with the
 * largest-remainder method. The stable input order breaks equal remainders,
 * so retries produce byte-for-byte equivalent line amounts.
 */
export function allocateCheckoutTax(
  lineSubtotalsMinor: readonly bigint[],
  taxMinor: bigint,
) {
  const subtotalMinor = addMinorAmounts(lineSubtotalsMinor);
  addMinorAmounts([taxMinor]);

  if (taxMinor === BigInt(0)) {
    return lineSubtotalsMinor.map(() => BigInt(0));
  }
  if (subtotalMinor === BigInt(0)) {
    throw new RangeError("Tax cannot be allocated across a zero subtotal.");
  }

  const allocations = lineSubtotalsMinor.map((lineSubtotalMinor, index) => {
    const numerator = lineSubtotalMinor * taxMinor;
    return {
      index,
      amount: numerator / subtotalMinor,
      remainder: numerator % subtotalMinor,
    };
  });
  const allocatedMinor = addMinorAmounts(
    allocations.map(({ amount }) => amount),
  );
  const remainderMinor = taxMinor - allocatedMinor;
  if (
    remainderMinor < BigInt(0) ||
    remainderMinor > BigInt(allocations.length)
  ) {
    throw new RangeError("The tax allocation remainder is invalid.");
  }

  const priority = [...allocations].sort(
    (left, right) =>
      (left.remainder === right.remainder
        ? left.index - right.index
        : left.remainder > right.remainder
          ? -1
          : 1),
  );
  for (let index = 0; index < Number(remainderMinor); index += 1) {
    const allocation = priority[index];
    if (!allocation) {
      throw new RangeError("The tax allocation could not be completed.");
    }
    allocation.amount += BigInt(1);
  }

  return allocations
    .sort((left, right) => left.index - right.index)
    .map(({ amount }) => amount);
}
