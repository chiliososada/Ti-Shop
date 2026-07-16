import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProductsExplorer } from "@/components/ProductsExplorer";
import { buildProductsExplorerHref } from "@/components/products-explorer-links";

describe("product explorer links", () => {
  it("preserves category, search, sort, and stable pagination state", () => {
    expect(
      buildProductsExplorerHref({
        category: "neuroscience",
        query: "reference material",
        sort: "newest",
        page: 3,
      }),
    ).toBe(
      "/products?category=neuroscience&page=3&q=reference+material&sort=newest",
    );
  });

  it("keeps the canonical default URL free of default sort and page values", () => {
    expect(
      buildProductsExplorerHref({
        category: "all",
        query: "",
        sort: "recommended",
      }),
    ).toBe("/products");
  });

  it("keeps the normalized category and sort in the search form and page links", () => {
    const markup = renderToStaticMarkup(
      createElement(ProductsExplorer, {
        products: [],
        total: 30,
        page: 2,
        pageCount: 3,
        categories: [
          {
            publicId: "00000000-0000-4000-8000-000000000001",
            slug: "neuroscience",
            name: "Neuroscience",
            description: null,
            productCount: 30,
          },
        ],
        activeCategory: "neuroscience",
        query: "reference material",
        sort: "newest",
      }),
    );

    expect(markup).toContain('name="category" value="neuroscience"');
    expect(markup).toContain('name="sort" value="newest"');
    expect(markup).toContain('name="q" value="reference material"');
    expect(markup).toContain(
      'href="/products?category=neuroscience&amp;page=3&amp;q=reference+material&amp;sort=newest"',
    );
    expect(markup).toContain(
      'href="/products?category=neuroscience&amp;q=reference+material&amp;sort=name-asc"',
    );
  });
});
