import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { adminManualOrderFormSchema } from "@/server/admin/orders/manual-order-input";

const variantPublicId = "02510b73-e45c-48e0-8276-d95333424ee4";
const base = {
  idempotencyKey: "8f7eb39a-cbf8-4be4-a382-87b31042d084",
  customerUserId: "0cd594b7-21ae-4776-96bd-24abf78baf60",
  paymentMethod: "WIRE_TRANSFER",
  itemsJson: JSON.stringify([{ variantPublicId, quantity: 2 }]),
  addressMode: "SAVED",
  addressId: "42",
  confirmation: "CREATE_PENDING_MANUAL_ORDER",
};

describe("admin manual order input", () => {
  it("normalizes a saved-address order without accepting money or status", () => {
    expect(adminManualOrderFormSchema.parse(base)).toEqual({
      idempotencyKey: base.idempotencyKey,
      customerUserId: base.customerUserId,
      paymentMethod: "WIRE_TRANSFER",
      items: [{ variantPublicId, quantity: 2 }],
      address: { mode: "SAVED", addressId: "42" },
    });

    expect(
      adminManualOrderFormSchema.safeParse({
        ...base,
        amountMinor: "1",
      }).success,
    ).toBe(false);
    expect(
      adminManualOrderFormSchema.safeParse({
        ...base,
        paymentStatus: "PAID",
      }).success,
    ).toBe(false);
  });

  it("accepts and normalizes a strict one-time US address", () => {
    const parsed = adminManualOrderFormSchema.parse({
      ...base,
      paymentMethod: "ZELLE",
      addressMode: "CUSTOM",
      addressId: "",
      recipientName: "  Receiving Lab  ",
      company: "Example Research",
      line1: "100 Science Way",
      line2: "Suite 2",
      city: "San Diego",
      region: "ca",
      postalCode: "92101",
      countryCode: "US",
      phone: "+1 619 555 0100",
    });

    expect(parsed.address).toEqual({
      mode: "CUSTOM",
      value: {
        recipientName: "Receiving Lab",
        company: "Example Research",
        line1: "100 Science Way",
        line2: "Suite 2",
        city: "San Diego",
        region: "CA",
        postalCode: "92101",
        countryCode: "US",
        phone: "+1 619 555 0100",
      },
    });
  });

  it.each(["NOWPAYMENTS", "OTHER_MANUAL", "CARD"])(
    "rejects unsupported payment method %s",
    (paymentMethod) => {
      expect(
        adminManualOrderFormSchema.safeParse({ ...base, paymentMethod })
          .success,
      ).toBe(false);
    },
  );

  it("rejects duplicate variants, invalid quantities, non-US addresses, and missing confirmation", () => {
    expect(
      adminManualOrderFormSchema.safeParse({
        ...base,
        itemsJson: JSON.stringify([
          { variantPublicId, quantity: 1 },
          { variantPublicId, quantity: 1 },
        ]),
      }).success,
    ).toBe(false);
    expect(
      adminManualOrderFormSchema.safeParse({
        ...base,
        itemsJson: JSON.stringify([
          { variantPublicId: randomUUID(), quantity: 100 },
        ]),
      }).success,
    ).toBe(false);
    expect(
      adminManualOrderFormSchema.safeParse({
        ...base,
        addressMode: "CUSTOM",
        addressId: "",
        recipientName: "Receiving Lab",
        line1: "100 Science Way",
        city: "Toronto",
        region: "ON",
        postalCode: "M5V 3A8",
        countryCode: "CA",
      }).success,
    ).toBe(false);
    expect(
      adminManualOrderFormSchema.safeParse({
        ...base,
        confirmation: undefined,
      }).success,
    ).toBe(false);
  });

  it("rejects malformed or out-of-range database address identifiers", () => {
    for (const addressId of ["0", "-1", "not-an-id", "9223372036854775808"]) {
      expect(
        adminManualOrderFormSchema.safeParse({ ...base, addressId }).success,
      ).toBe(false);
    }
  });
});
