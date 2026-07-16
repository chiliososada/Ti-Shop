import { describe, expect, it } from "vitest";

import {
  buildVariantCartSnapshot,
  selectInitialPurchaseVariant,
} from "@/components/cart/product-purchase";
import type { PublicProductVariantDto } from "@/domain/catalog";

function variant(
  publicId: string,
  overrides: Partial<PublicProductVariantDto> = {},
): PublicProductVariantDto {
  return {
    publicId,
    sku: "VARIANT-SKU",
    title: "5mg vial",
    optionValues: { size: "5mg" },
    minimumOrderQuantity: 2,
    requiresShipping: true,
    priceMode: "fixed",
    price: {
      amountMinor: "4200",
      currency: "USD",
      display: "$42.00",
      kind: "regular",
      taxInclusive: false,
    },
    directPurchaseAvailable: true,
    ...overrides,
  };
}

describe("product variant purchase presentation", () => {
  it("defaults to the first conservatively available variant", () => {
    const unavailable = variant("variant-unavailable", {
      directPurchaseAvailable: false,
    });
    const available = variant("variant-available", { title: "10mg vial" });

    expect(selectInitialPurchaseVariant([unavailable, available])).toBe(
      available,
    );
  });

  it("still presents an unavailable variant when no direct option is available", () => {
    const unavailable = variant("variant-unavailable", {
      directPurchaseAvailable: false,
    });

    expect(selectInitialPurchaseVariant([unavailable])).toBe(unavailable);
    expect(selectInitialPurchaseVariant([])).toBeNull();
  });

  it("builds a variant-specific cart snapshot without client-supplied inventory", () => {
    const snapshot = buildVariantCartSnapshot(
      {
        publicId: "product-public-id",
        slug: "example-product",
        title: "Example Product",
      },
      variant("variant-public-id", {
        sku: "EXAMPLE-10MG",
        title: "10mg vial",
        minimumOrderQuantity: 3,
        price: {
          amountMinor: "7650",
          currency: "USD",
          display: "$76.50",
          kind: "sale",
          taxInclusive: false,
        },
      }),
      {
        publicId: "media-public-id",
        url: "/products/example.jpg",
        alt: "Example vial",
        width: 800,
        height: 800,
        renditions: null,
      },
    );

    expect(snapshot).toEqual({
      publicId: "product-public-id",
      variantPublicId: "variant-public-id",
      slug: "example-product",
      title: "Example Product",
      variantTitle: "10mg vial",
      sku: "EXAMPLE-10MG",
      imageUrl: "/products/example.jpg",
      imageAlt: "Example vial",
      unitAmountMinor: "7650",
      currency: "USD",
      minimumOrderQuantity: 3,
    });
    expect(snapshot).not.toHaveProperty("directPurchaseAvailable");
    expect(snapshot).not.toHaveProperty("inventory");
  });
});
