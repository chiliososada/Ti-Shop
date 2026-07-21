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

  it("validates tiered checkout charges without inventing defaults", () => {
    expect(
      checkoutChargesSchema.parse({
        configured: "on",
        shippingFirstBlockMinor: "9000",
        shippingBlockUnits: "4",
        shippingAdditionalBlockMinor: "1500",
        taxRateBps: "825",
      }),
    ).toEqual({
      configured: true,
      shippingFirstBlockMinor: "9000",
      shippingBlockUnits: 4,
      shippingAdditionalBlockMinor: "1500",
      taxRateBps: 825,
    });
    expect(
      checkoutChargesSchema.parse({
        shippingFirstBlockMinor: "",
        shippingBlockUnits: "",
        shippingAdditionalBlockMinor: "",
        taxRateBps: "",
      }),
    ).toEqual({
      configured: false,
      shippingFirstBlockMinor: null,
      shippingBlockUnits: null,
      shippingAdditionalBlockMinor: null,
      taxRateBps: null,
    });
  });

  it("rejects unsafe checkout charge amounts, block sizes, and rates", () => {
    for (const input of [
      { shippingFirstBlockMinor: "-1", shippingBlockUnits: "4", shippingAdditionalBlockMinor: "0", taxRateBps: "0" },
      { shippingFirstBlockMinor: "1.50", shippingBlockUnits: "4", shippingAdditionalBlockMinor: "0", taxRateBps: "0" },
      { shippingFirstBlockMinor: "0", shippingBlockUnits: "0", shippingAdditionalBlockMinor: "0", taxRateBps: "0" },
      { shippingFirstBlockMinor: "0", shippingBlockUnits: "-2", shippingAdditionalBlockMinor: "0", taxRateBps: "0" },
      { shippingFirstBlockMinor: "0", shippingBlockUnits: "4", shippingAdditionalBlockMinor: "0", taxRateBps: "10001" },
      { shippingFirstBlockMinor: "0", shippingBlockUnits: "4", shippingAdditionalBlockMinor: "0", taxRateBps: "8.25" },
    ]) {
      expect(checkoutChargesSchema.safeParse(input).success).toBe(false);
    }
  });

  it("requires every charge field when configured", () => {
    const full = {
      configured: "on",
      shippingFirstBlockMinor: "9000",
      shippingBlockUnits: "4",
      shippingAdditionalBlockMinor: "1500",
      taxRateBps: "0",
    };
    expect(checkoutChargesSchema.safeParse(full).success).toBe(true);
    for (const field of [
      "shippingFirstBlockMinor",
      "shippingBlockUnits",
      "shippingAdditionalBlockMinor",
      "taxRateBps",
    ] as const) {
      expect(
        checkoutChargesSchema.safeParse({ ...full, [field]: "" }).success,
      ).toBe(false);
    }
  });

  it("fails closed on malformed stored JSON without throwing", () => {
    expect(
      checkoutChargesValueSchema.safeParse({
        configured: true,
        shippingFirstBlockMinor: "not-a-number",
        shippingBlockUnits: 4,
        shippingAdditionalBlockMinor: "1500",
        taxRateBps: 0,
      }).success,
    ).toBe(false);
    expect(
      checkoutChargesValueSchema.safeParse({
        configured: true,
        shippingFirstBlockMinor: null,
        shippingBlockUnits: 4,
        shippingAdditionalBlockMinor: "1500",
        taxRateBps: 0,
      }).success,
    ).toBe(false);
  });
});
