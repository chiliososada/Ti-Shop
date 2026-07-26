import type { Metadata } from "next";
import { connection } from "next/server";

import {
  publicRobots,
  type PublicSearchParams,
} from "@/app/_lib/public-seo";
import { BreadcrumbJsonLd } from "@/components/JsonLd";
import { PageHero } from "@/components/PageHero";
import { ProductsExplorer } from "@/components/ProductsExplorer";
import {
  normalizePageSearchParameter,
  normalizeSearchText,
} from "@/lib/pagination";
import { createPublicPageMetadata } from "@/lib/public-page-metadata";
import {
  getPublicCategories,
  getPublicProductPage,
  normalizePublicProductSort,
} from "@/server/catalog";

type ProductsPageProps = {
  searchParams: Promise<PublicSearchParams>;
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PRODUCT_PAGE_SIZE = 24;

function requestedCategory(value: string | string[] | undefined) {
  if (typeof value !== "string") return "all";
  const category = value.trim().toLowerCase();
  return category.length <= 180 && SLUG_PATTERN.test(category)
    ? category
    : "all";
}

export async function generateMetadata({
  searchParams,
}: ProductsPageProps): Promise<Metadata> {
  await connection();
  const [query, productPage, categories] = await Promise.all([
    searchParams,
    getPublicProductPage({ pageSize: 1 }),
    getPublicCategories(),
  ]);
  const productCount = productPage.pagination.total;
  const categoryCount = categories.length;

  return createPublicPageMetadata({
    title: `Research-Use Catalog — ${productCount} Products`,
    description: `Browse ${productCount} research-use catalog ${productCount === 1 ? "listing" : "listings"} across ${categoryCount} ${categoryCount === 1 ? "category" : "categories"}. Confirm current specifications, documents and availability before ordering.`,
    canonical: "/products",
    robots: publicRobots(query),
  });
}

export default async function ProductsPage({
  searchParams,
}: ProductsPageProps) {
  await connection();
  const [queryParams, categories] = await Promise.all([
    searchParams,
    getPublicCategories(),
  ]);
  const category = requestedCategory(queryParams.category);
  const query = normalizeSearchText(queryParams.q);
  const sort = normalizePublicProductSort(queryParams.sort);
  const productPage = await getPublicProductPage({
    ...(category === "all" ? {} : { categorySlug: category }),
    query,
    page: normalizePageSearchParameter(queryParams.page),
    pageSize: PRODUCT_PAGE_SIZE,
    sort,
  });

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: "/" },
          { name: "Products", url: "/products" },
        ]}
      />
      <PageHero
        eyebrow="Research Catalog"
        title={`${productPage.pagination.total} Research-Use Catalog Listings`}
        intro="Catalog information supports product identification and discovery. Confirm the current specification, lot-document availability and order eligibility for the material you need. Research use only."
        breadcrumbs={[
          { name: "Home", url: "/" },
          { name: "Products", url: "/products" },
        ]}
      />
      <section className="section-y">
        <div className="container-x">
          <ProductsExplorer
            products={productPage.products}
            total={productPage.pagination.total}
            page={productPage.pagination.page}
            pageCount={productPage.pagination.pageCount}
            categories={categories}
            activeCategory={category}
            query={query}
            sort={sort}
          />
        </div>
      </section>
    </>
  );
}
