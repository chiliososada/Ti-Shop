import type { Metadata } from "next";
import { connection } from "next/server";

import {
  publicRobots,
  type PublicSearchParams,
} from "@/app/_lib/public-seo";
import { Reveal } from "@/components/Reveal";
import { HeroVideo } from "@/components/HeroVideo";
import { Button, SectionHeading, Pill } from "@/components/ui";
import { ProductCard } from "@/components/ProductCard";
import { BlogCard } from "@/components/BlogCard";
import { SpinShowcase } from "@/components/SpinShowcase";
import { company } from "@/data/company";
import { hero, guarantees } from "@/data/content";
import { createPublicPageMetadata } from "@/lib/public-page-metadata";
import {
  getPublicCategories,
  getPublicHomePlacements,
  getPublicProductList,
} from "@/server/catalog";
import { getPublicBlogPosts } from "@/server/content";

type HomePageProps = {
  searchParams: Promise<PublicSearchParams>;
};

export async function generateMetadata({
  searchParams,
}: HomePageProps): Promise<Metadata> {
  await connection();
  const query = await searchParams;
  return createPublicPageMetadata({
    title: "Veripep | Research Materials for Laboratory Procurement",
    description:
      "Research-use peptide catalog with USD pricing where published and ordering for eligible US addresses. Confirm current specifications and documentation before purchase.",
    canonical: "/",
    robots: publicRobots(query),
  });
}

export default async function Home() {
  await connection();
  const [categories, products, placements, recentPosts] = await Promise.all([
    getPublicCategories(),
    getPublicProductList({ limit: 200 }),
    getPublicHomePlacements(),
    getPublicBlogPosts({ limit: 3 }),
  ]);
  const categoryBySlug = new Map(
    categories.map((category) => [category.slug, category]),
  );
  const showcases = (placements["legacy-category-signatures"] ?? []).flatMap(
    (item) => {
      if (!item.presentation) return [];
      const category = categoryBySlug.get(item.presentation.categorySlug);
      return category ? [{ item: { ...item, presentation: item.presentation }, category }] : [];
    },
  );
  const bestsellers = (placements["legacy-home-bestsellers"] ?? []).map(
    (item) => item.product,
  );

  return (
    <>
      {/* HERO */}
      <section className="relative flex min-h-[88vh] items-center overflow-hidden bg-ink-900">
        <HeroVideo />
        <div
          className="absolute inset-0 bg-gradient-to-r from-ink-900/85 via-ink-900/55 to-ink-900/20"
          aria-hidden
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-ink-900 via-transparent to-ink-900/40"
          aria-hidden
        />

        <div className="container-x relative py-24">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-cream-50/10 px-4 py-1.5 text-caption font-semibold text-cream-100 ring-1 ring-cream-50/15 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-sage-400" aria-hidden />
              Catalog for supported United States orders
            </span>
            <h1 className="mt-6 text-h1 text-cream-50 md:text-display">
              Research materials,
              <br />
              <span className="text-sage-300">clearer procurement.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-cream-100/85">
              {hero.subhead}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Button href={hero.ctaPrimary.href} variant="secondary" size="lg">
                {hero.ctaPrimary.label}
              </Button>
              <Button
                href={hero.ctaSecondary.href}
                variant="outline-invert"
                size="lg"
              >
                {hero.ctaSecondary.label}
              </Button>
            </div>
            <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-caption uppercase tracking-wider text-cream-100/70">
              <span>◦ USD storefront</span>
              <span>◦ US order support</span>
              <span>◦ Research use only</span>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST STRIP */}
      <section className="border-b border-ink-900/[0.06] bg-cream-50">
        <div className="container-x grid grid-cols-2 gap-x-8 gap-y-10 py-14 md:grid-cols-4">
          {company.stats.map((s) => (
            <div key={s.label}>
              <div className="text-h3 text-strong">{s.value}</div>
              <div className="mt-1.5 text-sm text-muted">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CATEGORY SHOWCASES (numbered, spin videos) */}
      <section className="section-y">
        <div className="container-x">
          <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
            <SectionHeading
              eyebrow="Research Catalogue"
              title={`${categories.length} research catalog categories`}
              intro="Browse by research area, then confirm the current presentation, specification, available documents and order eligibility for the material you need."
            />
            <Button href="/products" variant="outline">
              Browse all {products.length} products
            </Button>
          </div>

          <div className="mt-16 space-y-20 md:space-y-28">
            {showcases.map(({ item, category }, index) => (
              <Reveal key={item.product.publicId}>
                <SpinShowcase
                  item={item}
                  category={category}
                  count={category.productCount}
                  flip={index % 2 === 1}
                />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* WHY / TRUST 4-UP */}
      <section className="bg-surface-alt">
        <div className="container-x py-20 md:py-28">
          <SectionHeading
            eyebrow="Why Veripep"
            title="A clearer research procurement workflow"
            align="center"
          />
          <div className="mt-14 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {guarantees.map((g, i) => (
              <Reveal
                key={g.title}
                delay={i * 70}
                className="rounded-2xl bg-cream-50 p-7 ring-1 ring-ink-900/[0.06]"
              >
                <div className="grid h-11 w-11 place-items-center rounded-full bg-sage-100 text-sage-600">
                  <span className="font-mono text-sm">0{i + 1}</span>
                </div>
                <h3 className="mt-5 text-h6 text-strong">{g.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-body">
                  {g.body}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* BESTSELLERS */}
      <section className="section-y">
        <div className="container-x">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <SectionHeading
              eyebrow="Catalog Selection"
              title="Featured research materials"
            />
            <Button href="/products" variant="outline">
              View all products
            </Button>
          </div>
          <div className="mt-12 grid grid-cols-2 gap-6 lg:grid-cols-4">
            {bestsellers.map((product, index) => (
              <Reveal key={product.publicId} delay={index * 60}>
                <ProductCard product={product} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* BLOG / RESEARCH DESK */}
      {recentPosts.length > 0 ? (
        <section className="section-y">
          <div className="container-x">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHeading
                eyebrow="Research Desk"
                title="Guides to specifications, COAs & research materials"
              />
              <Button href="/blog" variant="outline">
                Read the blog
              </Button>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {recentPosts.map((post, index) => (
                <Reveal key={post.publicId} delay={index * 70}>
                  <BlogCard post={post} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* CTA BAND */}
      <section className="section-y">
        <div className="container-x">
          <div className="relative overflow-hidden rounded-3xl bg-sage-600 px-8 py-16 text-center md:px-16 md:py-24">
            <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-6">
              <Pill tone="cream">Administrator-managed contact options</Pill>
              <h2 className="text-h2 text-cream-50">
                Confirm the details your procurement process requires
              </h2>
              <p className="max-w-xl text-lg text-cream-50/85">
                Share the material, quantity, presentation, documentation and
                destination you need. Availability, price, shipping and any
                lead-time estimate are confirmed for the specific request.
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-4">
                <Button href="/contact" variant="primary" size="lg">
                  Request a Quote
                </Button>
                <Button
                  href="/products"
                  variant="outline-invert"
                  size="lg"
                >
                  Browse the Catalog
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
