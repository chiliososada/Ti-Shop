import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {} }),
}));

import { CartProvider } from "@/components/cart/CartProvider";
import { ProductPurchasePanel } from "@/components/cart/ProductPurchasePanel";
import type { PublicProductVariantDto } from "@/domain/catalog";

function variant(
  publicId: string,
  overrides: Partial<PublicProductVariantDto> = {},
): PublicProductVariantDto {
  return {
    publicId,
    sku: "EXAMPLE-5MG",
    title: "5mg vial",
    optionValues: { size: "5mg" },
    minimumOrderQuantity: 1,
    requiresShipping: true,
    priceMode: "fixed",
    price: {
      amountMinor: "4000",
      currency: "USD",
      display: "$40.00",
      kind: "regular",
      taxInclusive: false,
    },
    directPurchaseAvailable: true,
    ...overrides,
  };
}

function renderPanel(variants: PublicProductVariantDto[]) {
  return renderToStaticMarkup(
    createElement(
      CartProvider,
      null,
      createElement(ProductPurchasePanel, {
        product: {
          publicId: "product-public-id",
          slug: "example-product",
          title: "Example Product",
          subtitle: null,
          variants,
        },
        primaryImage: null,
        whatsappEnabled: true,
      }),
    ),
  );
}

describe("ProductPurchasePanel", () => {
  it("renders the first available variant as the selected purchase state", () => {
    const html = renderPanel([
      variant("unavailable", { directPurchaseAvailable: false }),
      variant("available", {
        sku: "EXAMPLE-10MG",
        title: "10mg vial",
        minimumOrderQuantity: 3,
        price: {
          amountMinor: "8000",
          currency: "USD",
          display: "$80.00",
          kind: "regular",
          taxInclusive: false,
        },
      }),
    ]);

    expect(html).toContain("Select variant");
    expect(html).toContain(
      '<span class="text-h2 text-strong">$80.00',
    );
    expect(html).toContain(">EXAMPLE-10MG</dd>");
    expect(html).toContain(">3</dd>");
    expect(html).toContain("Available to order");
  });

  it("disables direct actions for an unavailable variant but keeps WhatsApp", () => {
    const html = renderPanel([
      variant("unavailable", { directPurchaseAvailable: false }),
    ]);

    expect(html).toContain("temporarily unavailable for direct purchase");
    expect(html).toMatch(
      /<button(?=[^>]*disabled="")[^>]*>Add to cart<\/button>/u,
    );
    expect(html).toMatch(
      /<button(?=[^>]*disabled="")[^>]*>Buy now<\/button>/u,
    );
    expect(html).toContain("Ask about this product on WhatsApp");
  });
});
