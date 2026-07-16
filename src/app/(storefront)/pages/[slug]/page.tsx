import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  publicRobots,
  type PublicSearchParams,
} from "@/app/_lib/public-seo";
import { BreadcrumbJsonLd, WebPageJsonLd } from "@/components/JsonLd";
import { PageHero } from "@/components/PageHero";
import { company } from "@/data/company";
import type { PublicPageDto } from "@/domain/content";
import { publicPageTitle } from "@/lib/public-page-metadata";
import { getPublicPageBySlug } from "@/server/content";

type PageRouteProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<PublicSearchParams>;
};

type ContentBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

function summaryText(page: PublicPageDto) {
  const normalized = page.body
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/^[-*]\s+/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return page.title;
  return normalized.length <= 155 ? normalized : `${normalized.slice(0, 154).trimEnd()}…`;
}

function markdownBlocks(markdown: string): ContentBlock[] {
  return markdown
    .trim()
    .split(/\n{2,}/u)
    .flatMap((section): ContentBlock[] => {
      const value = section.trim();
      if (!value) return [];
      if (/^#{2,3}\s+/u.test(value)) {
        return [{ type: "heading", text: value.replace(/^#{2,3}\s+/u, "").trim() }];
      }
      const lines = value.split("\n").map((line) => line.trim());
      if (lines.every((line) => /^[-*]\s+/u.test(line))) {
        return [{
          type: "list",
          items: lines.map((line) => line.replace(/^[-*]\s+/u, "").trim()).filter(Boolean),
        }];
      }
      return [{ type: "paragraph", text: lines.join("\n") }];
    });
}

export async function generateMetadata({
  params,
  searchParams,
}: PageRouteProps): Promise<Metadata> {
  await connection();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const page = await getPublicPageBySlug(slug);
  if (!page) notFound();

  const description = page.seo?.description ?? summaryText(page);
  const title = publicPageTitle(page.seo?.title ?? page.title);
  const image = page.seo?.openGraphImage;
  const canonical = page.seo?.canonicalUrl ?? `/pages/${page.slug}`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    robots: publicRobots(query, {
      noIndex: page.seo?.noIndex,
      noFollow: page.seo?.noFollow,
    }),
    openGraph: {
      type: "website",
      title,
      description,
      url: canonical,
      ...(image
        ? {
            images: [{
              url: image.url,
              alt: image.alt,
              ...(image.width ? { width: image.width } : {}),
              ...(image.height ? { height: image.height } : {}),
            }],
          }
        : {}),
    },
  };
}

export default async function PublicPage({ params }: PageRouteProps) {
  await connection();
  const { slug } = await params;
  const page = await getPublicPageBySlug(slug);
  if (!page) notFound();

  const description = page.seo?.description ?? summaryText(page);
  const canonical = page.seo?.canonicalUrl ?? `/pages/${page.slug}`;
  const blocks = page.format === "markdown" ? markdownBlocks(page.body) : [];
  const crumbs = [
    { name: "Home", url: "/" },
    { name: page.title, url: canonical },
  ];

  return (
    <>
      <WebPageJsonLd
        title={page.title}
        description={description}
        url={canonical}
        datePublished={page.publishedAt}
        dateModified={page.updatedAt}
      />
      <BreadcrumbJsonLd items={crumbs} />
      <PageHero eyebrow={company.name} title={page.title} breadcrumbs={crumbs} />

      <article className="section-y">
        <div className="container-x max-w-[72ch]">
          {blocks.length > 0 ? (
            <div className="space-y-6">
              {blocks.map((block, index) => {
                if (block.type === "heading") {
                  return <h2 key={index} className="pt-4 text-h4 text-strong">{block.text}</h2>;
                }
                if (block.type === "list") {
                  return (
                    <ul key={index} className="space-y-2.5">
                      {block.items.map((item, itemIndex) => (
                        <li key={itemIndex} className="flex gap-3 text-body">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sage-500" aria-hidden />
                          <span className="leading-relaxed">{item}</span>
                        </li>
                      ))}
                    </ul>
                  );
                }
                return <p key={index} className="whitespace-pre-wrap text-lg leading-relaxed text-body">{block.text}</p>;
              })}
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-lg leading-relaxed text-body">
              {page.body}
            </p>
          )}
        </div>
      </article>
    </>
  );
}
