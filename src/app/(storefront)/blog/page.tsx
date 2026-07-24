import type { Metadata } from "next";
import { connection } from "next/server";

import {
  publicRobots,
  type PublicSearchParams,
} from "@/app/_lib/public-seo";
import { BlogCard } from "@/components/BlogCard";
import { BreadcrumbJsonLd } from "@/components/JsonLd";
import { PaginationNav } from "@/components/PaginationNav";
import { PageHero } from "@/components/PageHero";
import {
  buildQueryHref,
  normalizePageSearchParameter,
} from "@/lib/pagination";
import { createPublicPageMetadata } from "@/lib/public-page-metadata";
import { getPublicBlogPage } from "@/server/content";

type BlogIndexProps = {
  searchParams: Promise<PublicSearchParams>;
};

export async function generateMetadata({
  searchParams,
}: BlogIndexProps): Promise<Metadata> {
  await connection();
  const query = await searchParams;
  return createPublicPageMetadata({
    title: "Research Peptide Insights & Lab Guides",
    description:
      "Guides on peptide purity, Certificate of Analysis, reconstitution and peptide science from Flintmarrow. Research use only.",
    canonical: "/blog",
    robots: publicRobots(query),
  });
}

export default async function BlogIndex({ searchParams }: BlogIndexProps) {
  await connection();
  const query = await searchParams;
  const result = await getPublicBlogPage({
    page: normalizePageSearchParameter(query.page),
    pageSize: 12,
  });

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: "/" },
          { name: "Blog", url: "/blog" },
        ]}
      />
      <PageHero
        eyebrow="Research Desk"
        title="Peptide science, quality & lab guides"
        intro="General guides to research-material specifications, documentation and handling. Confirm product- and lot-specific details separately before use."
        breadcrumbs={[
          { name: "Home", url: "/" },
          { name: "Blog", url: "/blog" },
        ]}
      />
      <section className="section-y">
        <div className="container-x">
          {result.posts.length > 0 ? (
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {result.posts.map((post) => (
                <BlogCard key={post.publicId} post={post} />
              ))}
            </div>
          ) : (
            <p className="text-center text-muted">Articles coming soon.</p>
          )}
          <PaginationNav
            page={result.pagination.page}
            pageCount={result.pagination.pageCount}
            previousHref={
              result.pagination.page > 1
                ? buildQueryHref("/blog", {
                    page:
                      result.pagination.page - 1 > 1
                        ? result.pagination.page - 1
                        : undefined,
                  })
                : null
            }
            nextHref={
              result.pagination.page < result.pagination.pageCount
                ? buildQueryHref("/blog", {
                    page: result.pagination.page + 1,
                  })
                : null
            }
            label="Blog pagination"
          />
        </div>
      </section>
    </>
  );
}
