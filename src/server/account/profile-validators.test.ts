import { describe, expect, it } from "vitest";

import { customerProfileSchema } from "@/server/account/profile-validators";

describe("customer profile validator", () => {
  it("normalizes supported US/USD profile fields", () => {
    const result = customerProfileSchema.safeParse({
      name: "  Ada Lovelace  ",
      firstName: " Ada ",
      lastName: " Lovelace ",
      phone: " +1 (415) 555-0100 ",
      countryCode: "US",
      preferredCurrency: "USD",
      locale: "en-US",
      marketingConsent: "on",
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        name: "Ada Lovelace",
        firstName: "Ada",
        lastName: "Lovelace",
        phone: "+1 (415) 555-0100",
        marketingConsent: true,
      },
    });
  });

  it("rejects unsupported storefront values and malformed phone data", () => {
    const base = {
      name: "Ada Lovelace",
      firstName: "",
      lastName: "",
      phone: "",
      countryCode: "US",
      preferredCurrency: "USD",
      locale: "en-US",
    };

    expect(
      customerProfileSchema.safeParse({ ...base, countryCode: "GB" }).success,
    ).toBe(false);
    expect(
      customerProfileSchema.safeParse({ ...base, phone: "not-a-phone" }).success,
    ).toBe(false);
  });
});
