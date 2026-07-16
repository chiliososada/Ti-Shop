import { describe, expect, it } from "vitest";

import { checkoutInputSchema } from "@/server/orders/input";

const validInput = {
  idempotencyKey: "8f7eb39a-cbf8-4be4-a382-87b31042d084",
  items: [
    {
      variantPublicId: "02510b73-e45c-48e0-8276-d95333424ee4",
      quantity: 2,
    },
  ],
  shippingAddress: {
    recipientName: "Research Lab",
    line1: "123 Science Way",
    city: "San Diego",
    region: "ca",
    postalCode: "92101",
    countryCode: "US",
  },
  paymentMethod: "NOWPAYMENTS",
} as const;

describe("checkout input", () => {
  it("accepts only variant IDs, quantities, a US address, and a known method", () => {
    const parsed = checkoutInputSchema.parse(validInput);

    expect(parsed.shippingAddress.region).toBe("CA");
    expect(parsed.items).toEqual(validInput.items);
  });

  it.each(["ZZ", "QQ", "XX"])(
    "rejects a bogus region code %s at checkout",
    (region) => {
      expect(
        checkoutInputSchema.safeParse({
          ...validInput,
          shippingAddress: { ...validInput.shippingAddress, region },
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    ["client price", { unitPriceMinor: "1" }],
    ["client total", { totalMinor: "1" }],
    ["client user", { userId: "0cd594b7-21ae-4776-96bd-24abf78baf60" }],
    ["client status", { status: "CONFIRMED" }],
  ])("rejects a %s field", (_label, injected) => {
    expect(
      checkoutInputSchema.safeParse({ ...validInput, ...injected }).success,
    ).toBe(false);
  });

  it("rejects non-US addresses, unknown methods, and duplicate variants", () => {
    expect(
      checkoutInputSchema.safeParse({
        ...validInput,
        shippingAddress: {
          ...validInput.shippingAddress,
          countryCode: "CA",
        },
      }).success,
    ).toBe(false);
    expect(
      checkoutInputSchema.safeParse({
        ...validInput,
        paymentMethod: "CARD",
      }).success,
    ).toBe(false);
    expect(
      checkoutInputSchema.safeParse({
        ...validInput,
        items: [...validInput.items, validInput.items[0]],
      }).success,
    ).toBe(false);
  });
});
