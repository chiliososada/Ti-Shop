import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  catalogListingSeo,
  isValidListingPage,
  type PublicSearchParams,
} from "@/app/_lib/public-seo";
import { GuideReading } from "@/components/GuideReading";
import { BreadcrumbJsonLd, CatalogJsonLd } from "@/components/JsonLd";
import { PaginationNav } from "@/components/PaginationNav";
import { PageHero } from "@/components/PageHero";
import { ProductCard } from "@/components/ProductCard";
import { Reveal } from "@/components/Reveal";
import { Button } from "@/components/ui";
import { company } from "@/data/company";
import {
  buildQueryHref,
  normalizePageSearchParameter,
} from "@/lib/pagination";
import { createPublicPageMetadata } from "@/lib/public-page-metadata";
import {
  getPublicCategoryBySlug,
  getPublicProductPage,
} from "@/server/catalog";

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<PublicSearchParams>;
};

const CATEGORY_PRODUCT_PAGE_SIZE = 24;

function stripBrandSuffix(title: string) {
  return title.replace(new RegExp(`\\s*\\|\\s*${company.name}$`, "u"), "");
}

export async function generateMetadata({
  params,
  searchParams,
}: CategoryPageProps): Promise<Metadata> {
  await connection();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [category, productPage] = await Promise.all([
    getPublicCategoryBySlug(slug, { productLimit: 1 }),
    getPublicProductPage({
      categorySlug: slug,
      page: normalizePageSearchParameter(query.page),
      pageSize: CATEGORY_PRODUCT_PAGE_SIZE,
    }),
  ]);
  if (!category) notFound();
  if (!isValidListingPage(query, productPage.pagination.page)) notFound();

  const page = productPage.pagination.page;
  const listingSeo = catalogListingSeo(
    `/categories/${category.slug}`,
    query,
    page,
  );
  const title = stripBrandSuffix(category.seo?.title ?? category.name);
  const description =
    category.seo?.description ?? category.description ?? title;

  return createPublicPageMetadata({
    title: `${title}${page > 1 ? ` — Page ${page}` : ""}`,
    description,
    canonical: listingSeo.canonical,
    openGraphImage: category.seo?.openGraphImage ?? null,
    robots: {
      index: listingSeo.robots.index && !category.seo?.noIndex,
      follow: !category.seo?.noFollow,
    },
  });
}

export default async function CategoryPage({
  params,
  searchParams,
}: CategoryPageProps) {
  await connection();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [category, productPage] = await Promise.all([
    getPublicCategoryBySlug(slug, { productLimit: 1 }),
    getPublicProductPage({
      categorySlug: slug,
      page: normalizePageSearchParameter(query.page),
      pageSize: CATEGORY_PRODUCT_PAGE_SIZE,
    }),
  ]);
  if (!category || !isValidListingPage(query, productPage.pagination.page)) {
    notFound();
  }

  const listingSeo = catalogListingSeo(
    `/categories/${category.slug}`,
    query,
    productPage.pagination.page,
  );
  const crumbs = [
    { name: "Home", url: "/" },
    { name: "Products", url: "/products" },
    {
      name: category.name,
      url: category.seo?.canonicalUrl ?? `/categories/${category.slug}`,
    },
  ];

  return (
    <>
      <BreadcrumbJsonLd items={crumbs} />
      <CatalogJsonLd
        title={category.name}
        url={listingSeo.canonical}
        products={productPage.products}
        total={productPage.pagination.total}
        start={(productPage.pagination.page - 1) * CATEGORY_PRODUCT_PAGE_SIZE}
      />
      <PageHero
        eyebrow="Research Category"
        title={category.name}
        intro={
          category.seo?.description ??
          category.description ??
          "Explore catalog materials in this research category."
        }
        breadcrumbs={crumbs}
      />
      <section className="section-y">
        <div className="container-x">
          <div className="mb-8 flex items-center justify-between">
            <p className="text-caption text-muted">
              {productPage.pagination.total} catalog{" "}
              {productPage.pagination.total === 1 ? "listing" : "listings"} in
              this category
              {productPage.pagination.pageCount > 1
                ? ` · page ${productPage.pagination.page} of ${productPage.pagination.pageCount}`
                : ""}
            </p>
            <Button href="/products" variant="outline">
              All products →
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
            {productPage.products.map((product, index) => (
              <Reveal key={product.publicId} delay={index * 40}>
                <ProductCard product={product} />
              </Reveal>
            ))}
          </div>
          {productPage.products.length === 0 ? (
            <p className="mt-16 text-center text-muted">
              No published products are currently available in this category.
            </p>
          ) : null}
          <PaginationNav
            page={productPage.pagination.page}
            pageCount={productPage.pagination.pageCount}
            previousHref={
              productPage.pagination.page > 1
                ? buildQueryHref(
                    `/categories/${encodeURIComponent(category.slug)}`,
                    {
                      page:
                        productPage.pagination.page - 1 > 1
                          ? productPage.pagination.page - 1
                          : undefined,
                    },
                  )
                : null
            }
            nextHref={
              productPage.pagination.page < productPage.pagination.pageCount
                ? buildQueryHref(
                    `/categories/${encodeURIComponent(category.slug)}`,
                    {
                      page: productPage.pagination.page + 1,
                    },
                  )
                : null
            }
            label={`${category.name} product pagination`}
          />
        </div>
      </section>
      <GuideReading />
    </>
  );
}
