import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  catalogListingSeo,
  isValidListingPage,
  type PublicSearchParams,
} from "@/app/_lib/public-seo";
import { BreadcrumbJsonLd, CatalogJsonLd } from "@/components/JsonLd";
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
  const query = await searchParams;
  const [productPage, categories] = await Promise.all([
    getPublicProductPage({
      pageSize: PRODUCT_PAGE_SIZE,
      page: normalizePageSearchParameter(query.page),
    }),
    getPublicCategories(),
  ]);
  if (!isValidListingPage(query, productPage.pagination.page)) notFound();
  const productCount = productPage.pagination.total;
  const categoryCount = categories.length;
  const page = productPage.pagination.page;

  return createPublicPageMetadata({
    title: `Research Peptide Catalog — ${productCount} Products${page > 1 ? `, Page ${page}` : ""}`,
    description: `Browse ${productCount} research-use peptide ${productCount === 1 ? "listing" : "listings"} across ${categoryCount} ${categoryCount === 1 ? "category" : "categories"}, priced in USD per 10-vial box. Confirm current specifications, documents and availability before ordering.`,
    ...catalogListingSeo("/products", query, page),
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
  if (!isValidListingPage(queryParams, productPage.pagination.page)) notFound();

  const crumbs = [
    { name: "Home", url: "/" },
    { name: "Products", url: "/products" },
  ];

  return (
    <>
      <BreadcrumbJsonLd items={crumbs} />
      <CatalogJsonLd
        title="Research peptide catalog"
        url={
          catalogListingSeo("/products", queryParams, productPage.pagination.page)
            .canonical
        }
        products={productPage.products}
        total={productPage.pagination.total}
        start={(productPage.pagination.page - 1) * PRODUCT_PAGE_SIZE}
      />
      <PageHero
        eyebrow="Research Catalog"
        title={
          query
            ? `Results for “${query}”`
            : "Research peptides & laboratory materials"
        }
        intro={`${productPage.pagination.total} catalog ${productPage.pagination.total === 1 ? "listing" : "listings"} priced in USD per 10-vial box. Compare strengths, product codes and availability, then order on WhatsApp. For laboratory research only.`}
        breadcrumbs={crumbs}
      />
      <section className="section-y">
        <div className="container-x">
          <p className="mb-6 text-sm text-muted">
            Know the material name?{" "}
            <Link
              href="/research-materials"
              className="font-semibold text-strong underline underline-offset-4"
            >
              Compare every strength and price in the A–Z directory →
            </Link>
          </p>
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
