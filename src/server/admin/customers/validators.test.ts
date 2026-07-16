import { describe, expect, it } from "vitest";

import {
  disableCustomerAccountSchema,
  restoreCustomerAccountSchema,
  updateCustomerProfileSchema,
} from "@/server/admin/customers/validators";

const PUBLIC_ID = "00000000-0000-4000-8000-000000000001";

describe("customer admin validators", () => {
  it("accepts a US profile and normalizes optional fields", () => {
    const result = updateCustomerProfileSchema.safeParse({
      publicId: PUBLIC_ID,
      name: "  Ada Lovelace  ",
      firstName: " Ada ",
      lastName: " Lovelace ",
      phone: " +1 (415) 555-0100 ",
      countryCode: "US",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Ada Lovelace");
      expect(result.data.phone).toBe("+1 (415) 555-0100");
    }
  });

  it("rejects a country outside the supported US storefront", () => {
    expect(
      updateCustomerProfileSchema.safeParse({
        publicId: PUBLIC_ID,
        name: "Ada Lovelace",
        firstName: "Ada",
        lastName: "Lovelace",
        phone: "",
        countryCode: "GB",
      }).success,
    ).toBe(false);
  });

  it("requires a durable reason and explicit email/session confirmations", () => {
    expect(
      disableCustomerAccountSchema.safeParse({
        publicId: PUBLIC_ID,
        reason: "Confirmed account takeover report",
        confirmationEmail: " Customer@Example.com ",
        confirmation: "DISABLE_CUSTOMER_ACCOUNT",
      }),
    ).toMatchObject({
      success: true,
      data: { confirmationEmail: "customer@example.com" },
    });
    expect(
      disableCustomerAccountSchema.safeParse({
        publicId: PUBLIC_ID,
        reason: "short",
        confirmationEmail: "customer@example.com",
        confirmation: "DISABLE_CUSTOMER_ACCOUNT",
      }).success,
    ).toBe(false);
    expect(
      restoreCustomerAccountSchema.safeParse({
        publicId: PUBLIC_ID,
        confirmationEmail: "customer@example.com",
        confirmation: "RESTORE_CUSTOMER_ACCOUNT",
      }).success,
    ).toBe(true);
  });
});
