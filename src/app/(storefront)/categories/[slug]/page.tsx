import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  publicRobots,
  type PublicSearchParams,
} from "@/app/_lib/public-seo";
import { BreadcrumbJsonLd } from "@/components/JsonLd";
import { PaginationNav } from "@/components/PaginationNav";
import { PageHero } from "@/components/PageHero";
import { ProductCard } from "@/components/ProductCard";
import { Reveal } from "@/components/Reveal";
import { Button } from "@/components/ui";
import {
  buildQueryHref,
  normalizePageSearchParameter,
} from "@/lib/pagination";
import { publicPageTitle } from "@/lib/public-page-metadata";
import {
  getPublicCategoryBySlug,
  getPublicProductPage,
} from "@/server/catalog";

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<PublicSearchParams>;
};

const CATEGORY_PRODUCT_PAGE_SIZE = 24;

export async function generateMetadata({
  params,
  searchParams,
}: CategoryPageProps): Promise<Metadata> {
  await connection();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const category = await getPublicCategoryBySlug(slug, { productLimit: 1 });
  if (!category) notFound();

  const title = publicPageTitle(category.seo?.title ?? category.name);
  const description = category.seo?.description ?? category.description ?? title;
  const image = category.seo?.openGraphImage;
  const canonical =
    category.seo?.canonicalUrl ?? `/categories/${category.slug}`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    robots: publicRobots(query, {
      noIndex: category.seo?.noIndex,
      noFollow: category.seo?.noFollow,
    }),
    openGraph: {
      type: "website",
      title,
      description,
      url: canonical,
      ...(image
        ? {
            images: [
              {
                url: image.url,
                alt: image.alt,
                ...(image.width ? { width: image.width } : {}),
                ...(image.height ? { height: image.height } : {}),
              },
            ],
          }
        : {}),
    },
  };
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
  if (!category) notFound();

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
                ? buildQueryHref(`/categories/${encodeURIComponent(category.slug)}`, {
                    page:
                      productPage.pagination.page - 1 > 1
                        ? productPage.pagination.page - 1
                        : undefined,
                  })
                : null
            }
            nextHref={
              productPage.pagination.page < productPage.pagination.pageCount
                ? buildQueryHref(`/categories/${encodeURIComponent(category.slug)}`, {
                    page: productPage.pagination.page + 1,
                  })
                : null
            }
            label={`${category.name} product pagination`}
          />
        </div>
      </section>
    </>
  );
}
