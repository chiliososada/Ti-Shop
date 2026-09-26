import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  catalogListingSeo,
  isValidListingPage,
  type PublicSearchParams,
} from "@/app/_lib/public-seo";
import { GuideReading } from "@/components/GuideReading";
import Link from "next/link";

import { BreadcrumbJsonLd, CatalogJsonLd, FaqJsonLd } from "@/components/JsonLd";
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
import {
  categoryFaqs,
  displayName,
  formatUsd,
  groupMaterials,
  hasHub,
  hubPath,
  strengthRange,
} from "@/lib/material-hubs";
import { createPublicPageMetadata } from "@/lib/public-page-metadata";
import { getPublicMaterialListings } from "@/server/catalog/material-listings";
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

  const materials =
    productPage.pagination.page === 1
      ? groupMaterials(
          (await getPublicMaterialListings()).filter(
            (listing) => listing.categorySlug === category.slug,
          ),
        )
      : [];
  const faqs = categoryFaqs(category.name, materials);

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
      {faqs.length ? <FaqJsonLd faqs={faqs} /> : null}
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
      {materials.length ? (
        <section
          className="border-t border-line section-y"
          aria-labelledby="category-materials-heading"
        >
          <div className="container-x">
            <h2 id="category-materials-heading" className="text-h4 text-strong">
              Materials in {category.name}
            </h2>
            <p className="mt-3 max-w-[68ch] leading-relaxed text-body">
              {materials.length} materials, each with every listed strength and
              its USD price per box. Materials with several strengths have an
              overview page comparing price per vial, per mg and availability.
            </p>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {materials.map((material) => {
                const prices = material.listings
                  .map((listing) => listing.priceMinor)
                  .filter((price): price is number => price !== null);
                return (
                  <li key={material.slug}>
                    <Link
                      href={
                        hasHub(material)
                          ? hubPath(material)
                          : `/products/${material.listings[0].slug}`
                      }
                      className="block h-full rounded-xl border border-line bg-base p-5 transition-colors hover:border-sage-500"
                    >
                      <span className="block font-semibold text-strong">
                        {displayName(material)} →
                      </span>
                      {material.facts ? (
                        <span className="mt-1.5 block text-sm leading-relaxed text-muted">
                          {material.facts.classification}
                        </span>
                      ) : null}
                      <span className="mt-3 block font-mono text-caption text-body">
                        {material.listings.length}{" "}
                        {material.listings.length === 1 ? "strength" : "strengths"} ·{" "}
                        {strengthRange(material)}
                        {prices.length ? ` · from ${formatUsd(Math.min(...prices))}` : ""}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <h2 className="mt-14 text-h5 text-strong">
              {category.name}: frequently asked questions
            </h2>
            <div className="mt-5 max-w-[80ch] divide-y divide-line border-y border-line">
              {faqs.map((faq) => (
                <div key={faq.question} className="py-5">
                  <h3 className="font-semibold text-strong">{faq.question}</h3>
                  <p className="mt-2 leading-relaxed text-body">{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
      <GuideReading />
    </>
  );
}
