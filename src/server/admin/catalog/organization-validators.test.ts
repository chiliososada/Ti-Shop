import { describe, expect, it } from "vitest";

import {
  merchandisingPlacementKeySchema,
  placementCreateFormSchema,
  placementDeleteFormSchema,
  placementUpdateFormSchema,
  productTagAssignmentFormSchema,
  tagCreateFormSchema,
  tagUpdateFormSchema,
} from "@/server/admin/catalog/organization-validators";

const PRODUCT_ID = "00000000-0000-4000-8000-000000000001";
const TAG_ID = "00000000-0000-4000-8000-000000000002";
const PLACEMENT_ID = "00000000-0000-4000-8000-000000000003";

describe("catalog organization validators", () => {
  it("accepts canonical tag creation and update payloads", () => {
    expect(
      tagCreateFormSchema.safeParse({
        submissionId: TAG_ID,
        slug: "featured-research",
        name: "Featured research",
        status: "ACTIVE",
      }).success,
    ).toBe(true);
    expect(
      tagUpdateFormSchema.safeParse({
        publicId: TAG_ID,
        slug: "featured-research",
        name: "Featured research",
        status: "ARCHIVED",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed tag slugs, control characters, internal ids, and unknown fields", () => {
    for (const slug of ["Featured", "two--hyphens", " padded", "under_score"]) {
      expect(
        tagCreateFormSchema.safeParse({
          submissionId: TAG_ID,
          slug,
          name: "Tag",
          status: "DRAFT",
        }).success,
      ).toBe(false);
    }
    expect(
      tagCreateFormSchema.safeParse({
        submissionId: "42",
        slug: "safe-tag",
        name: "Tag\nInjected",
        status: "DRAFT",
      }).success,
    ).toBe(false);
    expect(
      tagCreateFormSchema.safeParse({
        submissionId: TAG_ID,
        slug: "safe-tag",
        name: "Tag",
        status: "DRAFT",
        internalId: "42",
      }).success,
    ).toBe(false);
  });

  it("allows an empty tag assignment but rejects duplicates and excessive selections", () => {
    expect(
      productTagAssignmentFormSchema.parse({
        productPublicId: PRODUCT_ID,
        tagPublicIds: [],
      }),
    ).toEqual({ productPublicId: PRODUCT_ID, tagPublicIds: [] });
    expect(
      productTagAssignmentFormSchema.safeParse({
        productPublicId: PRODUCT_ID,
        tagPublicIds: [TAG_ID, TAG_ID],
      }).success,
    ).toBe(false);
    expect(
      productTagAssignmentFormSchema.safeParse({
        productPublicId: PRODUCT_ID,
        tagPublicIds: Array.from(
          { length: 101 },
          (_, index) =>
            `00000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`,
        ),
      }).success,
    ).toBe(false);
  });

  it("accepts only bounded canonical placement keys and public UUID references", () => {
    expect(
      merchandisingPlacementKeySchema.safeParse("legacy-home-bestsellers").success,
    ).toBe(true);
    for (const key of [
      "Legacy-home",
      "legacy--home",
      " legacy-home",
      "legacy/home",
      "legacy\nhome",
    ]) {
      expect(merchandisingPlacementKeySchema.safeParse(key).success).toBe(false);
    }
    expect(
      placementCreateFormSchema.safeParse({
        submissionId: PLACEMENT_ID,
        placementKey: "legacy-home-bestsellers",
        productPublicId: PRODUCT_ID,
        position: "12",
        isActive: "on",
      }).success,
    ).toBe(true);
    expect(
      placementCreateFormSchema.safeParse({
        submissionId: PLACEMENT_ID,
        placementKey: "legacy-home-bestsellers",
        productPublicId: "9",
        position: "12",
      }).success,
    ).toBe(false);
  });

  it("validates placement moves and deletes without accepting hidden numeric ids", () => {
    expect(
      placementUpdateFormSchema.parse({
        placementPublicId: PLACEMENT_ID,
        placementKey: "legacy-home-bestsellers",
        position: "1000000",
      }),
    ).toMatchObject({
      placementPublicId: PLACEMENT_ID,
      position: 1_000_000,
      isActive: false,
    });
    expect(
      placementUpdateFormSchema.safeParse({
        placementPublicId: PLACEMENT_ID,
        placementKey: "legacy-home-bestsellers",
        position: "1000001",
      }).success,
    ).toBe(false);
    expect(
      placementDeleteFormSchema.safeParse({
        placementPublicId: PLACEMENT_ID,
        placementKey: "legacy-home-bestsellers",
        id: "123",
      }).success,
    ).toBe(false);
  });
});

