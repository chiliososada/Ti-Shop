import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  publicRobots,
  type PublicSearchParams,
} from "@/app/_lib/public-seo";
import { BlogCard } from "@/components/BlogCard";
import {
  ArticleJsonLd,
  BreadcrumbJsonLd,
  FaqJsonLd,
} from "@/components/JsonLd";
import { Button } from "@/components/ui";
import { company } from "@/data/company";
import type { PublicBlogBlockDto, PublicBlogPostDto } from "@/domain/content";
import {
  isRemotePublicAssetUrl,
  sanitizePublicAssetUrl,
} from "@/lib/public-asset-url";
import {
  getPublicBlogPostBySlug,
  getPublicBlogPosts,
} from "@/server/content";

type BlogPostPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<PublicSearchParams>;
};

const metadataTitleMaxLength = 60;
const metadataDescriptionMaxLength = 155;

function truncateMetadataText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;

  const candidate = normalized.slice(0, maxLength - 1);
  const wordBoundary = candidate.lastIndexOf(" ");
  const truncated = candidate.slice(
    0,
    wordBoundary > maxLength * 0.6 ? wordBoundary : candidate.length,
  );

  return `${truncated.trimEnd()}…`;
}

function metadataTitle(value: string) {
  const suffix = ` | ${company.name}`;
  const unbranded = value.replace(/\s*\|\s*sheng\.an\s*$/i, "");
  const base = truncateMetadataText(
    unbranded,
    metadataTitleMaxLength - suffix.length,
  );
  return `${base}${suffix}`;
}

export async function generateMetadata({
  params,
  searchParams,
}: BlogPostPageProps): Promise<Metadata> {
  await connection();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const post = await getPublicBlogPostBySlug(slug);
  if (!post) notFound();

  const title = metadataTitle(post.seo?.title ?? post.title);
  const description = truncateMetadataText(
    post.seo?.description ?? post.excerpt ?? post.title,
    metadataDescriptionMaxLength,
  );
  const image = post.seo?.openGraphImage ?? post.heroImage;
  const imageUrl = sanitizePublicAssetUrl(image?.url ?? null);
  const canonical = post.seo?.canonicalUrl ?? `/blog/${post.slug}`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    robots: publicRobots(query, {
      noIndex: post.seo?.noIndex,
      noFollow: post.seo?.noFollow,
    }),
    openGraph: {
      type: "article",
      title,
      description,
      url: canonical,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      ...(image && imageUrl
        ? {
            images: [
              {
                url: imageUrl,
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function markdownBodyBlocks(markdown: string): PublicBlogBlockDto[] {
  return markdown
    .trim()
    .split(/\n{2,}/u)
    .flatMap((section): PublicBlogBlockDto[] => {
      const value = section.trim();
      if (!value) return [];
      if (value.startsWith("## ")) {
        return [{ type: "h2", text: value.slice(3).trim() }];
      }

      const lines = value.split("\n").map((line) => line.trim());
      if (lines.every((line) => line.startsWith("- "))) {
        return [
          {
            type: "ul",
            items: lines.map((line) => line.slice(2).trim()).filter(Boolean),
          },
        ];
      }
      return [{ type: "p", text: lines.join("\n") }];
    });
}

function authoritativeBodyBlocks(post: PublicBlogPostDto) {
  if (post.format === "markdown") return markdownBodyBlocks(post.body);
  const text = post.body.trim();
  return text ? ([{ type: "p", text }] satisfies PublicBlogBlockDto[]) : [];
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  await connection();
  const { slug } = await params;
  const [post, posts] = await Promise.all([
    getPublicBlogPostBySlug(slug),
    getPublicBlogPosts({ limit: 100 }),
  ]);
  if (!post) notFound();

  const structuredContent = post.structuredContent;
  const body = authoritativeBodyBlocks(post);
  const takeaways = structuredContent?.takeaways ?? [];
  const faqs = structuredContent?.faqs ?? [];
  const heroImageUrl = sanitizePublicAssetUrl(post.heroImage?.url ?? null);
  const relatedBySlug = new Map(posts.map((candidate) => [candidate.slug, candidate]));
  const prioritized = (structuredContent?.relatedSlugs ?? []).flatMap(
    (relatedSlug) => {
      const relatedPost = relatedBySlug.get(relatedSlug);
      return relatedPost && relatedPost.slug !== post.slug ? [relatedPost] : [];
    },
  );
  const prioritizedSlugs = new Set(prioritized.map((candidate) => candidate.slug));
  const related = prioritized
    .concat(
      posts.filter(
        (candidate) =>
          candidate.slug !== post.slug && !prioritizedSlugs.has(candidate.slug),
      ),
    )
    .slice(0, 3);
  const crumbs = [
    { name: "Home", url: "/" },
    { name: "Blog", url: "/blog" },
    {
      name: post.title,
      url: post.seo?.canonicalUrl ?? `/blog/${post.slug}`,
    },
  ];

  return (
    <>
      <ArticleJsonLd post={post} />
      {faqs.length > 0 ? <FaqJsonLd faqs={faqs} /> : null}
      <BreadcrumbJsonLd items={crumbs} />

      <section className="border-b border-ink-900/[0.06] bg-surface-alt">
        <div className="container-x py-14 md:py-18">
          <nav
            aria-label="Breadcrumb"
            className="mb-6 flex flex-wrap items-center gap-2 text-caption text-muted"
          >
            {crumbs.map((breadcrumb, index) => (
              <span key={breadcrumb.url} className="flex items-center gap-2">
                {index > 0 ? <span className="text-ink-200">/</span> : null}
                {index === crumbs.length - 1 ? (
                  <span className="line-clamp-1 text-body">
                    {breadcrumb.name}
                  </span>
                ) : (
                  <Link href={breadcrumb.url} className="hover:text-strong">
                    {breadcrumb.name}
                  </Link>
                )}
              </span>
            ))}
          </nav>
          <span className="font-mono text-eyebrow uppercase text-sage-600">
            {post.category ?? "Research"}
          </span>
          <h1 className="mt-4 max-w-3xl text-h2 leading-tight text-strong md:text-h1">
            {post.title}
          </h1>
          <div className="mt-6 flex flex-wrap items-center gap-3 font-mono text-caption text-muted">
            <span>{post.author ?? `${company.name} Editorial`}</span>
            <span aria-hidden>·</span>
            <span>{formatDate(post.publishedAt)}</span>
            <span aria-hidden>·</span>
            <span>
              {post.readingMinutes ? `${post.readingMinutes} min` : "Article"}
            </span>
          </div>
        </div>
      </section>

      {post.heroImage && heroImageUrl ? (
        <div className="container-x -mt-2 pt-10">
          <div className="relative aspect-[16/8] overflow-hidden rounded-3xl ring-1 ring-ink-900/[0.06]">
            <Image
              src={heroImageUrl}
              alt={post.heroImage.alt}
              unoptimized={isRemotePublicAssetUrl(heroImageUrl)}
              fill
              sizes="(max-width: 1240px) 100vw, 1240px"
              className="object-cover"
              preload
            />
          </div>
        </div>
      ) : null}

      <article className="container-x py-14 md:py-18">
        <div className="mx-auto max-w-[68ch]">
          {post.excerpt ? (
            <p className="text-xl leading-relaxed text-strong">{post.excerpt}</p>
          ) : null}

          {body.length > 0 ? (
            <div className="mt-10 space-y-6">
              {body.map((block, index) => {
                if (block.type === "h2") {
                  return (
                    <h2 key={index} className="pt-6 text-h4 text-strong">
                      {block.text}
                    </h2>
                  );
                }
                if (block.type === "ul") {
                  return (
                    <ul key={index} className="space-y-2.5 pl-1">
                      {block.items.map((item, itemIndex) => (
                        <li key={itemIndex} className="flex gap-3 text-body">
                          <span
                            className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sage-500"
                            aria-hidden
                          />
                          <span className="leading-relaxed">{item}</span>
                        </li>
                      ))}
                    </ul>
                  );
                }
                return (
                  <p key={index} className="text-lg leading-relaxed text-body">
                    {block.text}
                  </p>
                );
              })}
            </div>
          ) : (
            <p className="mt-10 whitespace-pre-wrap text-lg leading-relaxed text-body">
              {post.body}
            </p>
          )}

          {takeaways.length > 0 ? (
            <div className="mt-12 rounded-2xl bg-sage-50 p-7 ring-1 ring-sage-500/15">
              <h2 className="text-h6 text-strong">Key takeaways</h2>
              <ul className="mt-4 space-y-2.5">
                {takeaways.map((takeaway, index) => (
                  <li key={index} className="flex gap-3 text-body">
                    <span className="font-mono text-sage-600">
                      0{index + 1}
                    </span>
                    <span className="leading-relaxed">{takeaway}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {faqs.length > 0 ? (
            <div className="mt-12">
              <h2 className="text-h4 text-strong">Frequently asked</h2>
              <div className="mt-5 divide-y divide-ink-900/[0.08] rounded-2xl bg-surface-warm ring-1 ring-ink-900/[0.06]">
                {faqs.map((faq, index) => (
                  <details
                    key={index}
                    className="group px-6 [&_summary::-webkit-details-marker]:hidden"
                  >
                    <summary className="flex cursor-pointer items-center justify-between gap-4 py-5 text-h6 text-strong">
                      {faq.question}
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cream-50 text-ink-500 ring-1 ring-ink-900/10 transition-all group-open:rotate-45 group-open:bg-sage-500 group-open:text-cream-50">
                        +
                      </span>
                    </summary>
                    <div className="pb-6 pr-10 text-body leading-relaxed">
                      {faq.answer}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ) : null}

          <p className="mt-12 rounded-xl border border-clay-300/40 bg-clay-50 px-4 py-3 text-caption text-body">
            <strong className="text-strong">Research Use Only.</strong> This
            article is educational and describes research-use materials only.
            sheng.an products are not drugs or supplements and are not for human
            or veterinary use.
          </p>

          <div className="mt-10 flex flex-wrap gap-4 rounded-2xl bg-ink-900 p-8">
            <div className="flex-1">
              <h2 className="text-h5 text-cream-50">
                Need product or lot details confirmed?
              </h2>
              <p className="mt-2 text-sm text-cream-200/70">
                Browse USD pricing where published, then ask about current
                specifications, available documents and shipping for your order.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button href="/products" variant="secondary">
                Browse catalog
              </Button>
            </div>
          </div>
        </div>
      </article>

      {related.length > 0 ? (
        <section className="bg-surface-alt">
          <div className="container-x py-16 md:py-22">
            <h2 className="text-h4 text-strong">More from the research desk</h2>
            <div className="mt-8 grid gap-8 md:grid-cols-3">
              {related.map((relatedPost) => (
                <BlogCard key={relatedPost.publicId} post={relatedPost} />
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
