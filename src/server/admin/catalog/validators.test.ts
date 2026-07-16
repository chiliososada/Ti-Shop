import { describe, expect, it } from "vitest";

import {
  categoryAssignmentFormSchema,
  createProductFormSchema,
  createProductMediaFormSchema,
  normalizeCatalogMediaSource,
  productFormSchema,
  usdPriceToMinor,
  variantFormSchema,
  variantPriceFormSchema,
} from "@/server/admin/catalog/validators";

const PUBLIC_ID = "00000000-0000-4000-8000-000000000001";

describe("catalog admin validators", () => {
  it("converts exact USD decimal input to bigint cents", () => {
    expect(usdPriceToMinor("0")).toBe(BigInt(0));
    expect(usdPriceToMinor("19.99")).toBe(BigInt(1_999));
    expect(usdPriceToMinor("1.001")).toBeNull();
    expect(usdPriceToMinor("1e3")).toBeNull();
  });

  it("requires a publish timestamp for active products", () => {
    const parsed = productFormSchema.safeParse({
      publicId: PUBLIC_ID,
      title: "Product",
      subtitle: "",
      shortDescription: "",
      description: "",
      brand: "",
      purity: "",
      casNumber: "",
      appearance: "",
      storageInstructions: "",
      status: "ACTIVE",
      publishedAt: "",
      position: "0",
    });
    expect(parsed.success).toBe(false);
  });

  it("enforces fixed-price and quote-only form invariants", () => {
    expect(
      variantPriceFormSchema.safeParse({
        productPublicId: PUBLIC_ID,
        variantPublicId: "00000000-0000-4000-8000-000000000002",
        priceMode: "FIXED",
        usdPrice: "46.00",
      }),
    ).toMatchObject({ success: true });

    expect(
      variantPriceFormSchema.safeParse({
        productPublicId: PUBLIC_ID,
        variantPublicId: "00000000-0000-4000-8000-000000000002",
        priceMode: "ON_REQUEST",
        usdPrice: "46.00",
      }).success,
    ).toBe(false);
  });

  it("accepts only canonical new slugs", () => {
    expect(
      createProductFormSchema.safeParse({
        slug: "new-product-2",
        title: "New product",
        position: "0",
      }).success,
    ).toBe(true);
    for (const slug of ["New-Product", "new--product", " new-product", "new_product"]) {
      expect(
        createProductFormSchema.safeParse({
          slug,
          title: "New product",
          position: "0",
        }).success,
      ).toBe(false);
    }
  });

  it("validates full variant edits and reserves MOQ outside free-form options", () => {
    const base = {
      productPublicId: PUBLIC_ID,
      variantPublicId: "00000000-0000-4000-8000-000000000002",
      title: "5 mg",
      sku: "TEST-5MG",
      status: "ACTIVE",
      priceMode: "FIXED",
      usdPrice: "46.00",
      minimumOrderQuantity: "2",
      position: "0",
      publishedAt: "2026-07-13T12:00:00Z",
      trackInventory: "on",
      optionValues: '{"size":"5 mg"}',
    };
    const parsed = variantFormSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.amountMinor).toBe(BigInt(4_600));
      expect(parsed.data.optionValues).toEqual({
        size: "5 mg",
        minimumOrderQuantity: 2,
      });
      expect(parsed.data.trackInventory).toBe(true);
    }
    expect(
      variantFormSchema.safeParse({
        ...base,
        optionValues: '{"minimumOrderQuantity":999}',
      }).success,
    ).toBe(false);
    expect(
      variantFormSchema.safeParse({
        ...base,
        minimumOrderQuantity: "100",
      }).success,
    ).toBe(false);
  });

  it("requires a selected primary category when categories are assigned", () => {
    const categoryId = "00000000-0000-4000-8000-000000000003";
    expect(
      categoryAssignmentFormSchema.safeParse({
        productPublicId: PUBLIC_ID,
        primaryCategoryPublicId: categoryId,
        categoryPublicIds: [categoryId],
      }).success,
    ).toBe(true);
    expect(
      categoryAssignmentFormSchema.safeParse({
        productPublicId: PUBLIC_ID,
        primaryCategoryPublicId: "",
        categoryPublicIds: [categoryId],
      }).success,
    ).toBe(false);
  });

  it("allows only safe local public paths or public HTTPS media URLs", () => {
    expect(normalizeCatalogMediaSource("/products/example.jpg")).toBe(
      "/products/example.jpg",
    );
    expect(normalizeCatalogMediaSource("https://cdn.example.com/a.jpg")).toBe(
      "https://cdn.example.com/a.jpg",
    );
    for (const value of [
      "javascript:alert(1)",
      "data:image/svg+xml,test",
      "file:///etc/passwd",
      "//cdn.example.com/a.jpg",
      "/products/../secret.jpg",
      "/products/%2e%2e/secret.jpg",
      "https://127.0.0.1/a.jpg",
      "https://user:pass@example.com/a.jpg",
    ]) {
      expect(normalizeCatalogMediaSource(value)).toBeNull();
    }
  });

  it("requires exactly one media source and compatible kind/role", () => {
    const valid = {
      productPublicId: PUBLIC_ID,
      existingMediaPublicId: "",
      sourceUrl: "/products/example.jpg",
      kind: "IMAGE",
      variantPublicId: "",
      role: "PRIMARY",
      altText: "Example",
      position: "0",
    };
    expect(createProductMediaFormSchema.safeParse(valid).success).toBe(true);
    expect(
      createProductMediaFormSchema.safeParse({
        ...valid,
        existingMediaPublicId: "00000000-0000-4000-8000-000000000004",
      }).success,
    ).toBe(false);
    expect(
      createProductMediaFormSchema.safeParse({
        ...valid,
        kind: "DOCUMENT",
      }).success,
    ).toBe(false);
  });
});
