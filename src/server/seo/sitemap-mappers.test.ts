import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { mapPublicCatalogSitemapRows } from "@/server/catalog/mappers";
import {
  mapPublicBlogSitemapRows,
  mapPublicPageSitemapRows,
} from "@/server/content/mappers";

describe("sitemap row mappers", () => {
  it("maps a safe canonical and uses the newer SEO timestamp", () => {
    const entries = mapPublicCatalogSitemapRows(
      [
        {
          slug: "catalog-item",
          updatedAt: new Date("2026-07-10T00:00:00.000Z"),
          seo: {
            canonicalUrl: "/products/canonical-item",
            updatedAt: new Date("2026-07-12T00:00:00.000Z"),
          },
        },
      ],
      [],
    );

    expect(entries).toEqual([
      {
        kind: "product",
        slug: "catalog-item",
        path: "/products/catalog-item",
        canonicalUrl: "/products/canonical-item",
        lastModified: "2026-07-12T00:00:00.000Z",
      },
    ]);
  });

  it("fails closed on an unsafe canonical and keeps a newer content timestamp", () => {
    const entries = mapPublicBlogSitemapRows([
      {
        slug: "research-guide",
        updatedAt: new Date("2026-07-13T00:00:00.000Z"),
        seo: {
          canonicalUrl: "http://journal.example/research-guide",
          updatedAt: new Date("2026-07-11T00:00:00.000Z"),
        },
      },
    ]);

    expect(entries).toEqual([
      {
        kind: "blog",
        slug: "research-guide",
        path: "/blog/research-guide",
        canonicalUrl: null,
        lastModified: "2026-07-13T00:00:00.000Z",
      },
    ]);
  });

  it("maps standalone page canonicals through the shared content contract", () => {
    const entries = mapPublicPageSitemapRows([
      {
        slug: "procurement-guide",
        updatedAt: new Date("2026-07-10T00:00:00.000Z"),
        seo: {
          canonicalUrl: "https://docs.example/procurement-guide",
          updatedAt: new Date("2026-07-11T00:00:00.000Z"),
        },
      },
    ]);

    expect(entries).toEqual([
      {
        kind: "page",
        slug: "procurement-guide",
        path: "/pages/procurement-guide",
        canonicalUrl: "https://docs.example/procurement-guide",
        lastModified: "2026-07-11T00:00:00.000Z",
      },
    ]);
  });
});
