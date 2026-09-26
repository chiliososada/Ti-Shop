import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";

import { publicRobots, type PublicSearchParams } from "@/app/_lib/public-seo";
import { GuideReading } from "@/components/GuideReading";
import {
  BreadcrumbJsonLd,
  FaqJsonLd,
  MaterialHubJsonLd,
} from "@/components/JsonLd";
import { PageHero } from "@/components/PageHero";
import {
  catalogFamilies,
  getFamilyPresentations,
} from "@/lib/catalog-specifications";
import {
  HUB_MIN_LISTINGS,
  displayName,
  formatDate,
  formatPerMg,
  formatPerVial,
  formatUsd,
  groupMaterials,
  hubFaqs,
  hubIntro,
  hubMetaDescription,
  hubPath,
  hubTitle,
  materialSlug,
  nounName,
  pricesCheckedOn,
  strengthRange,
} from "@/lib/material-hubs";
import { createPublicPageMetadata } from "@/lib/public-page-metadata";
import { getPublicMaterialListings } from "@/server/catalog/material-listings";

type MaterialHubProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<PublicSearchParams>;
};

/**
 * Resolves the hub of one material family. A family with a single published
 * strength is represented by that product page, so its hub URL redirects.
 */
async function loadHub(slug: string) {
  const family = catalogFamilies.find((candidate) => materialSlug(candidate) === slug);
  if (!family) notFound();
  const listings = await getPublicMaterialListings(
    getFamilyPresentations(family).map((presentation) => presentation.slug),
  );
  const group = groupMaterials(listings.filter((listing) => listing.family === family))[0];
  if (!group) notFound();
  if (group.listings.length < HUB_MIN_LISTINGS) {
    permanentRedirect(`/products/${group.listings[0].slug}`);
  }
  return group;
}

export async function generateMetadata({
  params,
  searchParams,
}: MaterialHubProps): Promise<Metadata> {
  await connection();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const group = await loadHub(slug);
  const lead = group.listings.find((listing) => listing.image);
  return createPublicPageMetadata({
    title: hubTitle(group),
    description: hubMetaDescription(group),
    canonical: hubPath(group),
    robots: publicRobots(query),
    openGraphImage: lead?.image
      ? {
          publicId: `material-${group.slug}`,
          url: lead.image,
          alt: `${displayName(group)} catalog image`,
          width: null,
          height: null,
          renditions: null,
        }
      : null,
  });
}

export default async function MaterialHubPage({ params }: MaterialHubProps) {
  await connection();
  const { slug } = await params;
  const group = await loadHub(slug);
  const name = displayName(group);
  const facts = group.facts;
  const category = group.listings.find((listing) => listing.categorySlug);
  const checkedOn = pricesCheckedOn(group.listings);
  const faqs = hubFaqs(group);
  const crumbs = [
    { name: "Home", url: "/" },
    { name: "Materials A–Z", url: "/research-materials" },
    { name, url: hubPath(group) },
  ];
  const glance: Array<[string, React.ReactNode]> = [
    ...(facts
      ? ([
          ["Material type", facts.materialType],
          ["Classification", facts.classification],
          ...(facts.aliases.length ? [["Also known as", facts.aliases.join("; ")]] : []),
        ] as Array<[string, string]>)
      : []),
    ...(category?.categorySlug && category.categoryName
      ? ([
          [
            "Research area",
            <Link
              key="category"
              href={`/categories/${category.categorySlug}`}
              className="underline underline-offset-4 hover:text-sage-600"
            >
              {category.categoryName}
            </Link>,
          ],
        ] as Array<[string, React.ReactNode]>)
      : []),
    ["Strengths listed", `${group.listings.length} · ${strengthRange(group)} per vial`],
    ["Product codes", group.listings.map((listing) => listing.codes.join(" / ")).join(", ")],
    ...(checkedOn
      ? ([
          [
            "Last updated",
            <time key="checked" dateTime={checkedOn}>
              {formatDate(checkedOn)}
            </time>,
          ],
        ] as Array<[string, React.ReactNode]>)
      : []),
  ];

  return (
    <>
      <BreadcrumbJsonLd items={crumbs} />
      <MaterialHubJsonLd
        url={hubPath(group)}
        name={nounName(group)}
        description={hubIntro(group)}
        aliases={facts?.aliases ?? []}
        classification={facts?.classification ?? null}
        items={group.listings.map((listing) => ({
          name: listing.title,
          url: `/products/${listing.slug}`,
          sku: listing.codes[0] ?? null,
          priceMinor: listing.priceMinor,
          available: listing.available,
          image: listing.image,
        }))}
      />
      <FaqJsonLd faqs={faqs} />

      <PageHero
        eyebrow={category?.categoryName ?? "Research material"}
        title={nounName(group)}
        intro={hubIntro(group)}
        breadcrumbs={crumbs}
      />

      <section className="section-y" aria-labelledby="strengths-heading">
        <div className="container-x grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-14">
          <div className="min-w-0">
            <h2 id="strengths-heading" className="text-h4 text-strong">
              {name} strengths and prices
            </h2>
            <p className="mt-3 max-w-[68ch] leading-relaxed text-body">
              Every listed strength, priced in USD per box. Per-vial and per-mg
              figures are the box price divided out, for comparing strengths.
              Open a strength to see its specification page and order it.
            </p>
            <div className="mt-6 overflow-x-auto rounded-xl ring-1 ring-line">
              <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
                <thead className="bg-surface-alt text-left text-caption uppercase tracking-[0.06em] text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Strength</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Code</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Per box</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Per vial</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Per mg</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {group.listings.map((listing) => (
                    <tr key={listing.slug} className="even:bg-surface-alt/60">
                      <td className="border-t border-line px-4 py-3.5">
                        <Link
                          href={`/products/${listing.slug}`}
                          className="font-semibold text-strong underline-offset-4 hover:underline"
                        >
                          {listing.strength || listing.title} →
                        </Link>
                        <span className="block text-caption text-muted">
                          {listing.packCount} vials per box
                        </span>
                      </td>
                      <td className="border-t border-line px-4 py-3.5 font-mono text-body">
                        {listing.codes.join(" / ")}
                      </td>
                      <td className="border-t border-line px-4 py-3.5 font-semibold text-strong">
                        {listing.priceMinor === null ? "—" : formatUsd(listing.priceMinor)}
                      </td>
                      <td className="border-t border-line px-4 py-3.5 font-mono text-body">
                        {formatPerVial(listing) ?? "—"}
                      </td>
                      <td className="border-t border-line px-4 py-3.5 font-mono text-body">
                        {formatPerMg(listing, group) ?? "—"}
                      </td>
                      <td className="border-t border-line px-4 py-3.5 text-body">
                        {listing.available ? "Available" : "Temporarily unavailable"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-caption text-muted">
              Amounts are per vial. mg, IU and mL describe different quantities
              and are not interchangeable; blends have no per-mg figure because
              their stated total combines several materials. For laboratory
              research use only.
            </p>
          </div>

          <aside className="min-w-0 rounded-xl border border-line bg-surface-alt p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted">
              At a glance
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              {glance.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-caption text-muted">{label}</dt>
                  <dd className="mt-0.5 break-words font-medium text-strong">{value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      </section>

      <section className="border-t border-line section-y" aria-labelledby="faq-heading">
        <div className="container-x max-w-[80ch]">
          <h2 id="faq-heading" className="text-h4 text-strong">
            {name}: frequently asked questions
          </h2>
          <div className="mt-6 divide-y divide-line border-y border-line">
            {faqs.map((faq) => (
              <div key={faq.question} className="py-5">
                <h3 className="font-semibold text-strong">{faq.question}</h3>
                <p className="mt-2 leading-relaxed text-body">{faq.answer}</p>
              </div>
            ))}
          </div>
          {facts?.licensedActive ? (
            <p className="mt-8 rounded-xl border border-line bg-surface-alt px-4 py-3 text-sm leading-relaxed text-body">
              {name} is also an active ingredient in licensed medicines in
              some markets. This catalog material is research supply only: it
              is not a medicine and must not be used as one.
            </p>
          ) : null}
          <p className="mt-6 rounded-xl border border-clay-300/40 bg-clay-50 px-4 py-3 text-caption text-body">
            <strong className="text-strong">Research Use Only.</strong> {name} is
            supplied strictly for laboratory research. It is not a drug,
            supplement or medical product and is not for human or veterinary
            consumption.
          </p>
          <p className="mt-6 text-sm text-muted">
            <Link
              href="/research-materials"
              className="font-semibold text-strong underline underline-offset-4"
            >
              Browse all research materials A–Z →
            </Link>
          </p>
        </div>
      </section>
      <GuideReading />
    </>
  );
}
