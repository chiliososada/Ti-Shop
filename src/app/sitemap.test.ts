import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/server/catalog", () => ({
  getPublicCatalogSitemapEntries: vi.fn(async () => []),
}));
vi.mock("@/server/content", () => ({
  getPublicBlogSitemapEntries: vi.fn(async () => []),
  getPublicPageSitemapEntries: vi.fn(async () => []),
  getPublishedManagedPageSitemapStates: vi.fn(async () => []),
}));

import { buildPublicSitemap } from "@/app/sitemap";
import { posts } from "@/data/blog";
import { categories } from "@/data/categories";
import { products } from "@/data/products";
import type { PublicCatalogSitemapEntryDto } from "@/domain/catalog";
import type { PublicBlogSitemapEntryDto } from "@/domain/content";
import type { PublicPageSitemapEntryDto } from "@/domain/content";

const catalogTimestamp = "2026-07-13T00:00:00.000Z";

describe("public sitemap", () => {
  it("includes every catalog URL, policy page and DTO date", () => {
    const catalogEntries: PublicCatalogSitemapEntryDto[] = [
      ...categories.map((category) => ({
        kind: "category" as const,
        slug: category.slug,
        path: `/categories/${category.slug}`,
        canonicalUrl: null,
        lastModified: catalogTimestamp,
      })),
      ...products.map((product) => ({
        kind: "product" as const,
        slug: product.id,
        path: `/products/${product.id}`,
        canonicalUrl: null,
        lastModified: catalogTimestamp,
      })),
    ];
    const blogEntries: PublicBlogSitemapEntryDto[] = posts.map((post) => ({
      kind: "blog",
      slug: post.slug,
      path: `/blog/${post.slug}`,
      canonicalUrl: null,
      lastModified: new Date(`${post.date}T00:00:00.000Z`).toISOString(),
    }));
    const entries = buildPublicSitemap(
      catalogEntries,
      blogEntries,
      "https://example.test",
    );
    const legacyStaticPaths = [
      "/",
      "/products",
      "/about",
      "/blog",
      "/faq",
      "/contact",
    ];
    const policyPaths = [
      "/shipping",
      "/returns",
      "/privacy",
      "/terms",
      "/payment-policy",
      "/research-use",
    ];
    const expectedPaths = [
      ...legacyStaticPaths,
      ...policyPaths,
      ...categories.map((category) => `/categories/${category.slug}`),
      ...products.map((product) => `/products/${product.id}`),
      ...posts.map((post) => `/blog/${post.slug}`),
    ];

    expect(entries).toHaveLength(expectedPaths.length);
    expect(new Set(entries.map((entry) => entry.url)).size).toBe(expectedPaths.length);
    expect(entries.map((entry) => new URL(entry.url).pathname).sort()).toEqual(
      [...expectedPaths].sort(),
    );

    const dynamicDates = new Map([
      ...catalogEntries.map(
        (entry) => [entry.path, entry.lastModified] as const,
      ),
      ...blogEntries.map((entry) => [entry.path, entry.lastModified] as const),
    ]);
    for (const entry of entries) {
      const pathname = new URL(entry.url).pathname;
      const expectedDate = dynamicDates.get(pathname);
      if (expectedDate) {
        expect(entry.lastModified).toBe(expectedDate);
      } else {
        expect(entry.lastModified).toBeUndefined();
      }
    }
  });

  it("deduplicates canonical collisions and keeps the latest real update", () => {
    const duplicate: PublicCatalogSitemapEntryDto = {
      kind: "product",
      slug: "products",
      path: "/products/duplicate",
      canonicalUrl: "/products",
      lastModified: catalogTimestamp,
    };

    const entries = buildPublicSitemap(
      [duplicate],
      [],
      "https://example.test",
    );
    const productsEntries = entries.filter(
      (entry) => entry.url === "https://example.test/products",
    );

    expect(productsEntries).toHaveLength(1);
    expect(productsEntries[0]).toMatchObject({
      lastModified: catalogTimestamp,
      priority: 0.9,
    });
  });

  it("adds published standalone page entries without changing the legacy contract", () => {
    const pageEntries: PublicPageSitemapEntryDto[] = [
      {
        kind: "page",
        slug: "procurement-guide",
        path: "/pages/procurement-guide",
        canonicalUrl: null,
        lastModified: catalogTimestamp,
      },
    ];

    const entries = buildPublicSitemap(
      [],
      [],
      "https://example.test",
      pageEntries,
    );

    expect(entries.at(-1)).toMatchObject({
      url: "https://example.test/pages/procurement-guide",
      lastModified: catalogTimestamp,
    });
  });

  it("updates fixed managed routes and omits a published noindex override", () => {
    const entries = buildPublicSitemap(
      [],
      [],
      "https://example.test",
      [],
      [
        {
          path: "/shipping",
          lastModified: "2026-07-13T03:00:00.000Z",
          noIndex: false,
        },
        {
          path: "/privacy",
          lastModified: "2026-07-13T04:00:00.000Z",
          noIndex: true,
        },
      ],
    );

    expect(
      entries.find((entry) => entry.url === "https://example.test/shipping"),
    ).toMatchObject({ lastModified: "2026-07-13T03:00:00.000Z" });
    expect(entries.map((entry) => entry.url)).not.toContain(
      "https://example.test/privacy",
    );
    expect(entries.map((entry) => entry.url)).toContain(
      "https://example.test/terms",
    );
  });

  it("uses same-origin canonical overrides for every dynamic entity type", () => {
    const entries = buildPublicSitemap(
      [
        {
          kind: "product",
          slug: "product-source",
          path: "/products/product-source",
          canonicalUrl: "/products/product-canonical",
          lastModified: "2026-07-10T00:00:00.000Z",
        },
        {
          kind: "category",
          slug: "category-source",
          path: "/categories/category-source",
          canonicalUrl: "https://example.test/categories/category-canonical",
          lastModified: "2026-07-11T00:00:00.000Z",
        },
      ],
      [
        {
          kind: "blog",
          slug: "blog-source",
          path: "/blog/blog-source",
          canonicalUrl: "/blog/blog-canonical",
          lastModified: "2026-07-12T00:00:00.000Z",
        },
      ],
      "https://example.test",
      [
        {
          kind: "page",
          slug: "page-source",
          path: "/pages/page-source",
          canonicalUrl: "https://example.test/pages/page-canonical",
          lastModified: "2026-07-13T00:00:00.000Z",
        },
      ],
    );
    const urls = new Set(entries.map((entry) => entry.url));

    expect(urls).toContain("https://example.test/products/product-canonical");
    expect(urls).toContain("https://example.test/categories/category-canonical");
    expect(urls).toContain("https://example.test/blog/blog-canonical");
    expect(urls).toContain("https://example.test/pages/page-canonical");
    expect(urls).not.toContain("https://example.test/products/product-source");
    expect(urls).not.toContain("https://example.test/categories/category-source");
    expect(urls).not.toContain("https://example.test/blog/blog-source");
    expect(urls).not.toContain("https://example.test/pages/page-source");
  });

  it("excludes every dynamic entity whose canonical points off-site", () => {
    const entries = buildPublicSitemap(
      [
        {
          kind: "product",
          slug: "external-product",
          path: "/products/external-product",
          canonicalUrl: "https://catalog.example/products/external-product",
          lastModified: catalogTimestamp,
        },
        {
          kind: "category",
          slug: "external-category",
          path: "/categories/external-category",
          canonicalUrl: "https://catalog.example/categories/external-category",
          lastModified: catalogTimestamp,
        },
      ],
      [
        {
          kind: "blog",
          slug: "external-blog",
          path: "/blog/external-blog",
          canonicalUrl: "https://journal.example/external-blog",
          lastModified: catalogTimestamp,
        },
      ],
      "https://example.test",
      [
        {
          kind: "page",
          slug: "external-page",
          path: "/pages/external-page",
          canonicalUrl: "https://docs.example/external-page",
          lastModified: catalogTimestamp,
        },
      ],
    );
    const urls = entries.map((entry) => entry.url);

    expect(urls).toHaveLength(12);
    expect(urls.join("\n")).not.toMatch(
      /external-(?:product|category|blog|page)/u,
    );
    expect(urls.every((url) => new URL(url).origin === "https://example.test"))
      .toBe(true);
  });
});
