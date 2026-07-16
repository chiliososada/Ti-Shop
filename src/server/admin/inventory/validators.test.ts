import { describe, expect, it } from "vitest";

import {
  adjustInventorySchema,
  createLocationSchema,
} from "@/server/admin/inventory/validators";

const PUBLIC_ID = "00000000-0000-4000-8000-000000000001";

describe("inventory admin validators", () => {
  it("normalizes a US location code", () => {
    const result = createLocationSchema.safeParse({
      code: " us-west_1 ",
      name: "West warehouse",
      countryCode: "US",
      region: "California",
      city: "Los Angeles",
      isActive: "on",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe("US-WEST_1");
      expect(result.data.isActive).toBe(true);
    }
  });

  it("rejects non-US locations", () => {
    expect(
      createLocationSchema.safeParse({
        code: "CA-1",
        name: "Canada",
        countryCode: "CA",
        region: "",
        city: "",
        isActive: "on",
      }).success,
    ).toBe(false);
  });

  it("requires a non-zero integer delta and an adjustment reason", () => {
    expect(
      adjustInventorySchema.safeParse({
        idempotencyKey: PUBLIC_ID,
        locationPublicId: PUBLIC_ID,
        variantPublicId: PUBLIC_ID,
        quantityDelta: "0",
        reason: "",
      }).success,
    ).toBe(false);
  });
});
