export type CheckoutPriceCandidate = {
  amountMinor: bigint;
  currency: string;
  kind: string;
  countryCode: string | null;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
};

function isCurrentUsdPrice(price: CheckoutPriceCandidate, now: Date) {
  return (
    price.currency === "USD" &&
    (price.countryCode === "US" || price.countryCode === null) &&
    price.isActive &&
    price.deletedAt === null &&
    price.amountMinor >= BigInt(0) &&
    (price.startsAt === null || price.startsAt.getTime() <= now.getTime()) &&
    (price.endsAt === null || price.endsAt.getTime() > now.getTime())
  );
}

function priority(price: CheckoutPriceCandidate) {
  return [
    price.countryCode === "US" ? 1 : 0,
    price.kind === "SALE" ? 1 : 0,
    price.startsAt?.getTime() ?? Number.MIN_SAFE_INTEGER,
    price.createdAt.getTime(),
  ] as const;
}

export function selectCheckoutUsdPrice(
  prices: readonly CheckoutPriceCandidate[],
  now: Date,
) {
  return [...prices]
    .filter((price) => isCurrentUsdPrice(price, now))
    .sort((left, right) => {
      const leftPriority = priority(left);
      const rightPriority = priority(right);
      for (let index = 0; index < leftPriority.length; index += 1) {
        const difference = rightPriority[index] - leftPriority[index];
        if (difference !== 0) return difference;
      }
      return 0;
    })[0] ?? null;
}
