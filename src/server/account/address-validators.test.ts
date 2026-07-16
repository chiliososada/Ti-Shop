import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  addressIdSchema,
  CREATE_ADDRESS_FIELDS,
  createAddressSchema,
  readStrictAddressFormData,
} from "@/server/account/address-validators";

const validAddress = {
  submissionId: randomUUID(),
  label: " Home ",
  recipientName: " Ada Lovelace ",
  company: " ",
  line1: " 123 Main Street ",
  line2: " ",
  city: " Boston ",
  region: "ma",
  postalCode: "02108-1234",
  countryCode: "US",
  phone: "+1 (617) 555-0100",
  isDefaultShipping: "on",
};

describe("customer address validators", () => {
  it("normalizes a valid US address and checkbox values", () => {
    expect(createAddressSchema.parse(validAddress)).toEqual({
      submissionId: validAddress.submissionId,
      label: "Home",
      recipientName: "Ada Lovelace",
      company: null,
      line1: "123 Main Street",
      line2: null,
      city: "Boston",
      region: "MA",
      postalCode: "02108-1234",
      countryCode: "US",
      phone: "+1 (617) 555-0100",
      isDefaultShipping: true,
      isDefaultBilling: false,
    });
  });

  it.each([
    ["countryCode", "CA"],
    ["region", "Massachusetts"],
    // Well-formed length but not a real USPS code — must be rejected so a
    // bogus state never reaches an order's shipping snapshot.
    ["region", "ZZ"],
    ["region", "QQ"],
    ["postalCode", "ABC"],
    ["phone", "call-me"],
  ])("rejects invalid %s values", (field, value) => {
    expect(
      createAddressSchema.safeParse({ ...validAddress, [field]: value }).success,
    ).toBe(false);
  });

  it.each(["MA", "ca", "dc", "pr", "GU"])(
    "accepts real US region code %s (any case)",
    (region) => {
      const parsed = createAddressSchema.safeParse({ ...validAddress, region });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.region).toBe(region.toUpperCase());
    },
  );

  it("accepts only positive PostgreSQL bigint address identifiers", () => {
    expect(addressIdSchema.parse("42")).toBe(BigInt(42));
    expect(addressIdSchema.safeParse("0").success).toBe(false);
    expect(addressIdSchema.safeParse("9223372036854775808").success).toBe(false);
  });

  it("rejects unexpected and duplicate FormData fields", () => {
    const unexpected = new FormData();
    unexpected.set("recipientName", "Ada");
    unexpected.set("userId", "another-user");
    expect(
      readStrictAddressFormData(unexpected, CREATE_ADDRESS_FIELDS).success,
    ).toBe(false);

    const duplicate = new FormData();
    duplicate.append("recipientName", "Ada");
    duplicate.append("recipientName", "Grace");
    expect(
      readStrictAddressFormData(duplicate, CREATE_ADDRESS_FIELDS).success,
    ).toBe(false);
  });

  it("ignores React's internal action metadata", () => {
    const formData = new FormData();
    formData.set("$ACTION_ID_test", "internal");
    formData.set("recipientName", "Ada");
    expect(readStrictAddressFormData(formData, CREATE_ADDRESS_FIELDS)).toEqual({
      success: true,
      data: { recipientName: "Ada" },
    });
  });
});
