import { describe, expect, it } from "vitest";

import { whatsappIntentInputSchema } from "@/server/whatsapp/input";

describe("WhatsApp intent payload", () => {
  it("accepts a structured cart payload", () => {
    expect(
      whatsappIntentInputSchema.safeParse({
        templateKey: "cart",
        sourcePath: "/checkout",
        lines: [
          {
            productSlug: "bpc-157",
            variantPublicId: "0191c24b-6666-7777-8888-999999999999",
            quantity: 2,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects a client-supplied cart subtotal so the server must reprice it", () => {
    expect(
      whatsappIntentInputSchema.safeParse({
        templateKey: "cart",
        sourcePath: "/checkout",
        lines: [
          {
            productSlug: "bpc-157",
            variantPublicId: "0191c24b-6666-7777-8888-999999999999",
            quantity: 2,
          },
        ],
        displayedSubtotalMinor: "1",
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      templateKey: "global",
      sourcePath: "/",
      message: "Send me to an arbitrary recipient",
    },
    {
      templateKey: "order",
      sourcePath: "/account/orders/x?email=private@example.com",
      orderPublicId: "0191c24b-6666-7777-8888-999999999999",
    },
    {
      templateKey: "order",
      sourcePath: "/account/orders/x",
      orderPublicId: "0191c24b-6666-7777-8888-999999999999",
      customerEmail: "private@example.com",
    },
    {
      templateKey: "product",
      sourcePath: "/products/bpc-157",
      productSlug: "https://evil.example",
    },
    {
      templateKey: "cart",
      sourcePath: "/cart",
      lines: [
        {
          productSlug: "bpc-157",
          variantPublicId: "0191c24b-6666-7777-8888-999999999999",
          quantity: 1,
        },
      ],
      displayedSubtotalMinor: "1",
      paymentDetails: "secret",
    },
  ])("rejects arbitrary or sensitive-shaped payloads", (value) => {
    expect(whatsappIntentInputSchema.safeParse(value).success).toBe(false);
  });
});
