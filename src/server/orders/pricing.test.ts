import { describe, expect, it } from "vitest";

import {
  selectCheckoutUsdPrice,
  type CheckoutPriceCandidate,
} from "@/server/orders/pricing";

function price(
  amountMinor: bigint,
  overrides: Partial<CheckoutPriceCandidate> = {},
): CheckoutPriceCandidate {
  return {
    amountMinor,
    currency: "USD",
    kind: "REGULAR",
    countryCode: null,
    isActive: true,
    startsAt: null,
    endsAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

describe("server checkout pricing", () => {
  const now = new Date("2026-07-13T00:00:00.000Z");

  it("prefers a current US sale over global and regular prices", () => {
    expect(
      selectCheckoutUsdPrice(
        [
          price(BigInt(4_000)),
          price(BigInt(3_500), { countryCode: "US" }),
          price(BigInt(3_000), { countryCode: "US", kind: "SALE" }),
        ],
        now,
      )?.amountMinor,
    ).toBe(BigInt(3_000));
  });

  it("rejects expired, future, non-US, non-USD, and negative prices", () => {
    expect(
      selectCheckoutUsdPrice(
        [
          price(BigInt(100), { endsAt: now }),
          price(BigInt(100), {
            startsAt: new Date("2026-07-14T00:00:00.000Z"),
          }),
          price(BigInt(100), { countryCode: "CA" }),
          price(BigInt(100), { currency: "EUR" }),
          price(BigInt(-1)),
        ],
        now,
      ),
    ).toBeNull();
  });
});

