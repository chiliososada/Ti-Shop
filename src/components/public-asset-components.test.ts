import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BlogCard } from "@/components/BlogCard";
import { ProductCard } from "@/components/ProductCard";
import type { PublicProductSummaryDto } from "@/domain/catalog";
import type { PublicBlogSummaryDto } from "@/domain/content";

describe("public asset component boundaries", () => {
  it("renders a safe fallback instead of an unsafe product image", () => {
    const product: PublicProductSummaryDto = {
      publicId: "00000000-0000-4000-8000-000000000001",
      slug: "example-product",
      title: "Example product",
      subtitle: null,
      shortDescription: null,
      brand: null,
      purity: null,
      isFeatured: false,
      primaryImage: {
        publicId: "00000000-0000-4000-8000-000000000002",
        url: "https://user:password@cdn.example/product.jpg",
        alt: "Unsafe product image",
        width: 800,
        height: 800,
        renditions: null,
      },
      primaryCategory: null,
      defaultVariantPublicId: null,
      minimumOrderQuantity: null,
      priceMode: null,
      price: null,
    };
    const markup = renderToStaticMarkup(createElement(ProductCard, { product }));

    expect(markup).toContain("Product image coming soon");
    expect(markup).not.toContain("cdn.example");
  });

  it("renders a safe fallback instead of an unsafe blog image", () => {
    const post: PublicBlogSummaryDto = {
      publicId: "00000000-0000-4000-8000-000000000003",
      slug: "example-post",
      title: "Example post",
      category: null,
      author: null,
      readingMinutes: null,
      excerpt: null,
      heroImage: {
        publicId: "00000000-0000-4000-8000-000000000004",
        url: "/images/foo%250abar.jpg",
        alt: "Unsafe blog image",
        width: 1200,
        height: 630,
        renditions: null,
      },
      publishedAt: "2026-07-13T00:00:00.000Z",
    };
    const markup = renderToStaticMarkup(createElement(BlogCard, { post }));

    expect(markup).toContain("Research desk");
    expect(markup).not.toContain("foo%250abar.jpg");
  });
});
