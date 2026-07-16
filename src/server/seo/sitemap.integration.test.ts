import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildPublicSitemap } from "@/app/sitemap";
import { getPublicCatalogSitemapEntries } from "@/server/catalog";
import {
  getPublicBlogSitemapEntries,
  getPublicPageSitemapEntries,
} from "@/server/content";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("public sitemap SEO visibility", () => {
  const suffix = randomUUID().slice(0, 8);
  const fixturePrefix = `sitemap-seo-it-${suffix}`;
  const slugs = {
    product: {
      indexable: `${fixturePrefix}-product-indexable`,
      external: `${fixturePrefix}-product-external`,
      noIndex: `${fixturePrefix}-product-no-index`,
      unpublished: `${fixturePrefix}-product-unpublished`,
    },
    category: {
      indexable: `${fixturePrefix}-category-indexable`,
      external: `${fixturePrefix}-category-external`,
      noIndex: `${fixturePrefix}-category-no-index`,
      unpublished: `${fixturePrefix}-category-unpublished`,
    },
    blog: {
      indexable: `${fixturePrefix}-blog-indexable`,
      external: `${fixturePrefix}-blog-external`,
      noIndex: `${fixturePrefix}-blog-no-index`,
      unpublished: `${fixturePrefix}-blog-unpublished`,
    },
    page: {
      indexable: `${fixturePrefix}-page-indexable`,
      external: `${fixturePrefix}-page-external`,
      noIndex: `${fixturePrefix}-page-no-index`,
      unpublished: `${fixturePrefix}-page-unpublished`,
    },
  } as const;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const publishedAt = new Date(Date.now() - 60_000);
    const entityUpdatedAt = new Date("2026-07-10T00:00:00.000Z");
    const seoUpdatedAt = new Date("2026-07-11T00:00:00.000Z");

    await db.product.createMany({
      data: [
        {
          slug: slugs.product.indexable,
          title: "Indexable sitemap integration product",
          status: "ACTIVE",
          dataQualityStatus: "VERIFIED",
          publishedAt,
          updatedAt: entityUpdatedAt,
        },
        {
          slug: slugs.product.external,
          title: "External-canonical sitemap integration product",
          status: "ACTIVE",
          dataQualityStatus: "VERIFIED",
          publishedAt,
          updatedAt: entityUpdatedAt,
        },
        {
          slug: slugs.product.noIndex,
          title: "No-index sitemap integration product",
          status: "ACTIVE",
          dataQualityStatus: "VERIFIED",
          publishedAt,
          updatedAt: entityUpdatedAt,
        },
        {
          slug: slugs.product.unpublished,
          title: "Unpublished sitemap integration product",
          status: "DRAFT",
          dataQualityStatus: "VERIFIED",
          updatedAt: entityUpdatedAt,
        },
      ],
    });
    await db.category.createMany({
      data: [
        {
          slug: slugs.category.indexable,
          name: "Indexable sitemap integration category",
          status: "ACTIVE",
          publishedAt,
          updatedAt: entityUpdatedAt,
        },
        {
          slug: slugs.category.external,
          name: "External-canonical sitemap integration category",
          status: "ACTIVE",
          publishedAt,
          updatedAt: entityUpdatedAt,
        },
        {
          slug: slugs.category.noIndex,
          name: "No-index sitemap integration category",
          status: "ACTIVE",
          publishedAt,
          updatedAt: entityUpdatedAt,
        },
        {
          slug: slugs.category.unpublished,
          name: "Unpublished sitemap integration category",
          status: "DRAFT",
          updatedAt: entityUpdatedAt,
        },
      ],
    });
    await db.blogPost.createMany({
      data: [
        {
          slug: slugs.blog.indexable,
          title: "Indexable sitemap integration blog post",
          body: "Indexable integration fixture.",
          status: "PUBLISHED",
          publishedAt,
          updatedAt: entityUpdatedAt,
        },
        {
          slug: slugs.blog.external,
          title: "External-canonical sitemap integration blog post",
          body: "External-canonical integration fixture.",
          status: "PUBLISHED",
          publishedAt,
          updatedAt: entityUpdatedAt,
        },
        {
          slug: slugs.blog.noIndex,
          title: "No-index sitemap integration blog post",
          body: "No-index integration fixture.",
          status: "PUBLISHED",
          publishedAt,
          updatedAt: entityUpdatedAt,
        },
        {
          slug: slugs.blog.unpublished,
          title: "Unpublished sitemap integration blog post",
          body: "Unpublished integration fixture.",
          status: "DRAFT",
          updatedAt: entityUpdatedAt,
        },
      ],
    });
    await db.page.createMany({
      data: [
        {
          slug: slugs.page.indexable,
          title: "Indexable sitemap integration page",
          body: "Indexable integration fixture.",
          status: "PUBLISHED",
          publishedAt,
          updatedAt: entityUpdatedAt,
        },
        {
          slug: slugs.page.external,
          title: "External-canonical sitemap integration page",
          body: "External-canonical integration fixture.",
          status: "PUBLISHED",
          publishedAt,
          updatedAt: entityUpdatedAt,
        },
        {
          slug: slugs.page.noIndex,
          title: "No-index sitemap integration page",
          body: "No-index integration fixture.",
          status: "PUBLISHED",
          publishedAt,
          updatedAt: entityUpdatedAt,
        },
        {
          slug: slugs.page.unpublished,
          title: "Unpublished sitemap integration page",
          body: "Unpublished integration fixture.",
          status: "DRAFT",
          updatedAt: entityUpdatedAt,
        },
      ],
    });

    const [products, categories, blogPosts, pages] = await Promise.all([
      db.product.findMany({
        where: { slug: { in: Object.values(slugs.product) } },
        select: { id: true, slug: true },
      }),
      db.category.findMany({
        where: { slug: { in: Object.values(slugs.category) } },
        select: { id: true, slug: true },
      }),
      db.blogPost.findMany({
        where: { slug: { in: Object.values(slugs.blog) } },
        select: { id: true, slug: true },
      }),
      db.page.findMany({
        where: { slug: { in: Object.values(slugs.page) } },
        select: { id: true, slug: true },
      }),
    ]);
    await db.seoMetadata.createMany({
      data: [
        ...products.map(({ id, slug }) => ({
          productId: id,
          noIndex: slug === slugs.product.noIndex,
          canonicalUrl:
            slug === slugs.product.indexable
              ? `/products/${fixturePrefix}-product-canonical`
              : slug === slugs.product.external
                ? `https://catalog.example/products/${slug}`
                : null,
          updatedAt: seoUpdatedAt,
        })),
        ...categories.map(({ id, slug }) => ({
          categoryId: id,
          noIndex: slug === slugs.category.noIndex,
          canonicalUrl:
            slug === slugs.category.indexable
              ? `/categories/${fixturePrefix}-category-canonical`
              : slug === slugs.category.external
                ? `https://catalog.example/categories/${slug}`
                : null,
          updatedAt: seoUpdatedAt,
        })),
        ...blogPosts.map(({ id, slug }) => ({
          blogPostId: id,
          noIndex: slug === slugs.blog.noIndex,
          canonicalUrl:
            slug === slugs.blog.indexable
              ? `/blog/${fixturePrefix}-blog-canonical`
              : slug === slugs.blog.external
                ? `https://journal.example/${slug}`
                : null,
          updatedAt: seoUpdatedAt,
        })),
        ...pages.map(({ id, slug }) => ({
          pageId: id,
          noIndex: slug === slugs.page.noIndex,
          canonicalUrl:
            slug === slugs.page.indexable
              ? `/pages/${fixturePrefix}-page-canonical`
              : slug === slugs.page.external
                ? `https://docs.example/${slug}`
                : null,
          updatedAt: seoUpdatedAt,
        })),
      ],
    });
  });

  afterAll(async () => {
    const db = getDb();
    await db.product.deleteMany({ where: { slug: { startsWith: fixturePrefix } } });
    await db.category.deleteMany({ where: { slug: { startsWith: fixturePrefix } } });
    await db.blogPost.deleteMany({ where: { slug: { startsWith: fixturePrefix } } });
    await db.page.deleteMany({ where: { slug: { startsWith: fixturePrefix } } });
  });

  it("honors canonical and no-index policy across every database-backed source", async () => {
    const [catalogEntries, blogEntries, pageEntries] = await Promise.all([
      getPublicCatalogSitemapEntries(),
      getPublicBlogSitemapEntries(),
      getPublicPageSitemapEntries(),
    ]);
    const paths = new Set(
      [...catalogEntries, ...blogEntries, ...pageEntries].map(
        (entry) => entry.path,
      ),
    );

    expect(paths).toContain(`/products/${slugs.product.indexable}`);
    expect(paths).not.toContain(`/products/${slugs.product.noIndex}`);
    expect(paths).toContain(`/categories/${slugs.category.indexable}`);
    expect(paths).not.toContain(`/categories/${slugs.category.noIndex}`);
    expect(paths).toContain(`/blog/${slugs.blog.indexable}`);
    expect(paths).not.toContain(`/blog/${slugs.blog.noIndex}`);
    expect(paths).toContain(`/pages/${slugs.page.indexable}`);
    expect(paths).not.toContain(`/pages/${slugs.page.noIndex}`);

    const allEntries = [...catalogEntries, ...blogEntries, ...pageEntries];
    for (const kind of ["product", "category", "blog", "page"] as const) {
      const sameSite = allEntries.find(
        (entry) => entry.kind === kind && entry.slug === slugs[kind].indexable,
      );
      const external = allEntries.find(
        (entry) => entry.kind === kind && entry.slug === slugs[kind].external,
      );

      expect(sameSite?.canonicalUrl).toBe(
        `/${kind === "category" ? "categories" : kind === "product" ? "products" : kind === "page" ? "pages" : "blog"}/${fixturePrefix}-${kind}-canonical`,
      );
      expect(sameSite?.lastModified).toBe("2026-07-11T00:00:00.000Z");
      expect(external?.canonicalUrl).toMatch(/^https:\/\//u);
      expect(external?.lastModified).toBe("2026-07-11T00:00:00.000Z");
      expect(
        allEntries.some((entry) => entry.slug === slugs[kind].unpublished),
      ).toBe(false);
    }

    const sitemap = buildPublicSitemap(
      catalogEntries,
      blogEntries,
      "https://shop.example",
      pageEntries,
    );
    const urls = new Set(sitemap.map((entry) => entry.url));

    for (const kind of ["product", "category", "blog", "page"] as const) {
      const pathSegment =
        kind === "category"
          ? "categories"
          : kind === "product"
            ? "products"
            : kind === "page"
              ? "pages"
              : "blog";
      expect(urls).toContain(
        `https://shop.example/${pathSegment}/${fixturePrefix}-${kind}-canonical`,
      );
      expect(
        [...urls].some((url) => url.includes(slugs[kind].external)),
      ).toBe(false);
    }
  });
});
