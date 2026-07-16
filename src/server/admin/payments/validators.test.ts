import { describe, expect, it } from "vitest";

import {
  checkoutChargesSchema,
  checkoutChargesValueSchema,
  onlinePaymentSwitchSchema,
  paymentMethodConfigSchema,
} from "@/server/admin/payments/validators";

describe("payment settings validators", () => {
  it("normalizes customer-facing settings without accepting secret fields", () => {
    expect(
      paymentMethodConfigSchema.parse({
        method: "WIRE_TRANSFER",
        displayName: " Wire transfer ",
        publicInstructions: " Contact support first. ",
        isEnabled: "on",
      }),
    ).toEqual({
      method: "WIRE_TRANSFER",
      displayName: "Wire transfer",
      publicInstructions: "Contact support first.",
      isEnabled: true,
    });

    expect(
      paymentMethodConfigSchema.safeParse({
        method: "NOWPAYMENTS",
        displayName: "NOWPayments",
        publicInstructions: "",
        apiKey: "must-not-be-accepted",
      }).success,
    ).toBe(false);
  });

  it.each([
    ["WIRE_TRANSFER", "Send to routing 021000021 and confirm."],
    ["ZELLE", "Send Zelle to recipient@example.com."],
    ["ZELLE", "Send to +1 (202) 555-0123."],
    ["NOWPAYMENTS", "Use API key abc123 for checkout."],
  ])("rejects sensitive material in public %s copy", (method, copy) => {
    expect(
      paymentMethodConfigSchema.safeParse({
        method,
        displayName: "Payment",
        publicInstructions: copy,
        isEnabled: "on",
      }).success,
    ).toBe(false);
  });

  it("does not mistake ordinary uppercase procedural copy for a SWIFT code", () => {
    expect(
      paymentMethodConfigSchema.safeParse({
        method: "WIRE_TRANSFER",
        displayName: "Wire transfer",
        publicInstructions: "CONTACT US THROUGH WHATSAPP BEFORE PAYMENT.",
        isEnabled: "on",
      }).success,
    ).toBe(true);
  });

  it("treats an omitted checkbox as disabled and rejects arbitrary values", () => {
    expect(onlinePaymentSwitchSchema.parse({})).toEqual({
      isEnabled: false,
    });
    expect(
      onlinePaymentSwitchSchema.safeParse({ isEnabled: "yes" }).success,
    ).toBe(false);
  });

  it("validates checkout charges without inventing defaults", () => {
    expect(
      checkoutChargesSchema.parse({
        configured: "on",
        shippingFlatMinor: "1500",
        taxRateBps: "825",
      }),
    ).toEqual({
      configured: true,
      shippingFlatMinor: "1500",
      taxRateBps: 825,
    });
    expect(
      checkoutChargesSchema.parse({
        shippingFlatMinor: "",
        taxRateBps: "",
      }),
    ).toEqual({
      configured: false,
      shippingFlatMinor: null,
      taxRateBps: null,
    });
  });

  it("rejects unsafe checkout charge amounts and rates", () => {
    for (const input of [
      { shippingFlatMinor: "-1", taxRateBps: "0" },
      { shippingFlatMinor: "1.50", taxRateBps: "0" },
      { shippingFlatMinor: "9223372036854775808", taxRateBps: "0" },
      { shippingFlatMinor: "0", taxRateBps: "10001" },
      { shippingFlatMinor: "0", taxRateBps: "8.25" },
    ]) {
      expect(checkoutChargesSchema.safeParse(input).success).toBe(false);
    }
  });

  it("requires both explicit charge values when configured", () => {
    expect(
      checkoutChargesSchema.safeParse({
        configured: "on",
        shippingFlatMinor: "",
        taxRateBps: "0",
      }).success,
    ).toBe(false);
    expect(
      checkoutChargesSchema.safeParse({
        configured: "on",
        shippingFlatMinor: "0",
        taxRateBps: "",
      }).success,
    ).toBe(false);
    expect(
      checkoutChargesSchema.safeParse({
        configured: "on",
        shippingFlatMinor: "0",
        taxRateBps: "0",
      }).success,
    ).toBe(true);
  });

  it("fails closed on malformed stored JSON without throwing", () => {
    expect(
      checkoutChargesValueSchema.safeParse({
        configured: true,
        shippingFlatMinor: "not-a-number",
        taxRateBps: 0,
      }).success,
    ).toBe(false);
    expect(
      checkoutChargesValueSchema.safeParse({
        configured: true,
        shippingFlatMinor: null,
        taxRateBps: 0,
      }).success,
    ).toBe(false);
  });
});
