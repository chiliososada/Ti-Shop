import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: "catalog-pagination-integration" } },
    roles: ["integration-test"],
    permissions: new Set(["catalog.read"]),
  })),
}));

import { getAdminCatalogIndex } from "@/server/admin/catalog/queries";
import { getPublicProductPage } from "@/server/catalog";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("catalog database pagination and filtering", () => {
  const suffix = randomUUID().slice(0, 8);
  const fixturePrefix = `catalog-page-it-${suffix}`;
  const categorySlug = `${fixturePrefix}-category-00`;
  const needleSlug = `${fixturePrefix}-needle-07`;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const publishedAt = new Date(Date.now() - 60_000);

    await db.category.createMany({
      data: Array.from({ length: 26 }, (_, index) => ({
        slug: `${fixturePrefix}-category-${String(index).padStart(2, "0")}`,
        name: `Catalog pagination category ${suffix} ${String(index).padStart(2, "0")}`,
        status: "ACTIVE" as const,
        position: 0,
        publishedAt,
      })),
    });

    await db.product.createMany({
      data: [
        ...Array.from({ length: 31 }, (_, index) => ({
          slug:
            index === 7
              ? needleSlug
              : `${fixturePrefix}-product-${String(index).padStart(2, "0")}`,
          title: `Catalog pagination product ${suffix} ${String(index).padStart(2, "0")}`,
          status: "ACTIVE" as const,
          dataQualityStatus: "VERIFIED" as const,
          position: index % 3,
          publishedAt: new Date(publishedAt.getTime() - index * 1_000),
        })),
        {
          slug: `${fixturePrefix}-outside-category`,
          title: `Catalog pagination product ${suffix}`,
          status: "ACTIVE" as const,
          dataQualityStatus: "VERIFIED" as const,
          position: 0,
          publishedAt,
        },
        {
          slug: `${fixturePrefix}-draft-in-category`,
          title: `Catalog pagination product ${suffix}`,
          status: "DRAFT" as const,
          dataQualityStatus: "VERIFIED" as const,
          position: 0,
          publishedAt: null,
        },
      ],
    });

    const [category, products] = await Promise.all([
      db.category.findUniqueOrThrow({
        where: { slug: categorySlug },
        select: { id: true },
      }),
      db.product.findMany({
        where: {
          slug: {
            startsWith: fixturePrefix,
            not: `${fixturePrefix}-outside-category`,
          },
        },
        orderBy: { id: "asc" },
        select: { id: true },
      }),
    ]);
    await db.productCategory.createMany({
      data: products.map(({ id }, index) => ({
        productId: id,
        categoryId: category.id,
        position: index,
      })),
    });
  });

  afterAll(async () => {
    const db = getDb();
    await db.product.deleteMany({
      where: { slug: { startsWith: fixturePrefix } },
    });
    await db.category.deleteMany({
      where: { slug: { startsWith: fixturePrefix } },
    });
  });

  it("discovers every published category product across stable database pages", async () => {
    const pages = await Promise.all(
      [1, 2, 3, 4].map((page) =>
        getPublicProductPage({
          categorySlug,
          query: fixturePrefix.toUpperCase(),
          page,
          pageSize: 10,
        }),
      ),
    );
    const slugs = pages.flatMap(({ products }) =>
      products.map((product) => product.slug),
    );

    expect(pages[0]?.pagination).toEqual({
      page: 1,
      pageSize: 10,
      pageCount: 4,
      total: 31,
    });
    expect(pages[3]?.products).toHaveLength(1);
    expect(new Set(slugs).size).toBe(31);
    expect(slugs).not.toContain(`${fixturePrefix}-draft-in-category`);
    expect(slugs).not.toContain(`${fixturePrefix}-outside-category`);
  });

  it("filters in PostgreSQL and safely clamps an excessive page", async () => {
    const filtered = await getPublicProductPage({
      categorySlug,
      query: "NEEDLE-07",
      page: 1,
      pageSize: 10,
    });
    expect(filtered.pagination.total).toBe(1);
    expect(filtered.products.map(({ slug }) => slug)).toEqual([needleSlug]);

    const excessive = await getPublicProductPage({
      categorySlug,
      query: fixturePrefix,
      page: 9_999,
      pageSize: 10,
    });
    expect(excessive.pagination.page).toBe(4);
    expect(excessive.products).toHaveLength(1);
  });

  it("applies every strict sort in PostgreSQL with stable cross-page ordering", async () => {
    const slugAt = (index: number) =>
      index === 7
        ? needleSlug
        : `${fixturePrefix}-product-${String(index).padStart(2, "0")}`;
    const indexes = Array.from({ length: 31 }, (_, index) => index);

    const [recommended, nameAsc, nameDesc, newest] = await Promise.all([
      getPublicProductPage({
        categorySlug,
        query: fixturePrefix,
        pageSize: 48,
        sort: "recommended",
      }),
      getPublicProductPage({
        categorySlug,
        query: fixturePrefix,
        pageSize: 48,
        sort: "name-asc",
      }),
      getPublicProductPage({
        categorySlug,
        query: fixturePrefix,
        pageSize: 48,
        sort: "name-desc",
      }),
      getPublicProductPage({
        categorySlug,
        query: fixturePrefix,
        pageSize: 48,
        sort: "newest",
      }),
    ]);

    const slugs = (result: typeof recommended) =>
      result.products.map((product) => product.slug);
    expect(slugs(recommended)).toEqual(
      [...indexes]
        .sort((left, right) => left % 3 - (right % 3) || left - right)
        .map(slugAt),
    );
    expect(slugs(nameAsc)).toEqual(indexes.map(slugAt));
    expect(slugs(nameDesc)).toEqual([...indexes].reverse().map(slugAt));
    expect(slugs(newest)).toEqual(indexes.map(slugAt));
  });

  it("paginates both admin lists without the former fixed-result truncation", async () => {
    const secondPage = await getAdminCatalogIndex({
      productQ: fixturePrefix,
      productPage: "2",
      categoryQ: fixturePrefix,
      categoryPage: "2",
    });

    expect(secondPage.productPagination).toEqual({
      page: 2,
      pageSize: 25,
      pageCount: 2,
      total: 33,
    });
    expect(secondPage.products).toHaveLength(8);
    expect(secondPage.categoryPagination).toEqual({
      page: 2,
      pageSize: 25,
      pageCount: 2,
      total: 26,
    });
    expect(secondPage.categories).toHaveLength(1);

    const excessive = await getAdminCatalogIndex({
      productQ: fixturePrefix,
      productPage: "9999",
      categoryQ: fixturePrefix,
      categoryPage: "9999",
    });
    expect(excessive.filters.productPage).toBe(2);
    expect(excessive.filters.categoryPage).toBe(2);
    expect(excessive.products).toHaveLength(8);
    expect(excessive.categories).toHaveLength(1);
  });
});
