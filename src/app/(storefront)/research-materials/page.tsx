import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { publicRobots, type PublicSearchParams } from "@/app/_lib/public-seo";
import { GuideReading } from "@/components/GuideReading";
import { BreadcrumbJsonLd } from "@/components/JsonLd";
import { PageHero } from "@/components/PageHero";
import { materialDirectory } from "@/lib/material-directory";
import { createPublicPageMetadata } from "@/lib/public-page-metadata";
import { getPublicProductDirectory } from "@/server/catalog/public-directory";

type DirectoryPageProps = {
  searchParams: Promise<PublicSearchParams>;
};

const crumbs = [
  { name: "Home", url: "/" },
  { name: "Products", url: "/products" },
  { name: "Materials A–Z", url: "/research-materials" },
];

export async function generateMetadata({
  searchParams,
}: DirectoryPageProps): Promise<Metadata> {
  await connection();
  return createPublicPageMetadata({
    title: "Research Peptides & Materials A–Z, Priced per Box",
    description:
      "Find research peptides and laboratory materials by name. Compare every listed strength, the USD price per 10-vial box and the product code before you order.",
    canonical: "/research-materials",
    robots: publicRobots(await searchParams),
  });
}

export default async function MaterialDirectoryPage() {
  await connection();
  const groups = materialDirectory(await getPublicProductDirectory());
  const letters = [...new Set(groups.map((group) => group.letter))];
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <>
      <BreadcrumbJsonLd items={crumbs} />
      <PageHero
        eyebrow="Catalog reference"
        title="Research peptides & materials, A–Z"
        intro={`${total} published presentations across ${groups.length} materials. Each line shows the amount per vial, the USD price per box and the product code to quote when you order on WhatsApp.`}
        breadcrumbs={crumbs}
      />
      <section className="section-y">
        <div className="container-x">
          <div className="grid gap-8 border-b border-line pb-10 md:grid-cols-2">
            <div>
              <h2 className="text-h4 text-strong">
                One name. Every listed presentation.
              </h2>
              <p className="mt-4 leading-relaxed text-body">
                Use this directory when you already know the material name and
                want to compare the listed strengths side by side. Each link
                opens the full specification page. Quote the product code so
                our team can identify the exact presentation in your order.
              </p>
              <Link
                href="/products"
                className="mt-4 inline-block font-semibold text-strong underline underline-offset-4"
              >
                Prefer images and search? Browse the product catalog →
              </Link>
            </div>
            <div>
              <h2 className="text-h4 text-strong">Read quantities in context</h2>
              <p className="mt-4 leading-relaxed text-body">
                The listed amount is per vial and the price is per box of 10
                vials. mg, IU and mL describe different quantities and are not
                interchangeable. A blend has its own listing and should be
                checked against its component names and stated amounts.
              </p>
              <p className="mt-3 text-sm text-muted">
                All listings are for laboratory research only. Availability and
                lot documents are confirmed for each order.
              </p>
            </div>
          </div>

          <nav
            aria-label="Material names by first letter"
            className="my-8 flex flex-wrap gap-2"
          >
            {letters.map((letter) => (
              <a
                key={letter}
                href={`#letter-${letter}`}
                className="rounded-lg border border-line px-4 py-3 font-mono text-sm text-strong hover:bg-surface-alt"
              >
                {letter}
              </a>
            ))}
          </nav>

          {letters.map((letter) => (
            <section
              key={letter}
              id={`letter-${letter}`}
              className="scroll-mt-28 border-t border-line py-8"
              aria-labelledby={`heading-${letter}`}
            >
              <h2
                id={`heading-${letter}`}
                className="mb-6 font-mono text-h3 text-strong"
              >
                {letter}
              </h2>
              <div className="grid gap-5 md:grid-cols-2">
                {groups
                  .filter((group) => group.letter === letter)
                  .map((group) => (
                    <article
                      key={group.family}
                      className="min-w-0 rounded-xl border border-line p-5"
                    >
                      <h3 className="break-words text-lg font-semibold text-strong">
                        {group.family}
                      </h3>
                      <ul className="mt-3 divide-y divide-line">
                        {group.items.map((item) => (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm hover:underline"
                              aria-label={`${item.title}${item.price ? `, ${item.price} per box` : ""}${item.code ? `, product code ${item.code}` : ""}`}
                            >
                              <span className="font-medium text-strong">
                                {item.strength
                                  ? `${item.strength} per vial`
                                  : item.title}
                              </span>
                              <span className="flex items-center gap-3">
                                {item.price ? (
                                  <span className="font-semibold text-strong">
                                    {item.price}
                                  </span>
                                ) : null}
                                <span className="font-mono text-xs text-muted">
                                  {item.code}
                                  {item.packCount
                                    ? ` · ${item.packCount} vials/box`
                                    : ""}{" "}
                                  →
                                </span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
              </div>
            </section>
          ))}
        </div>
      </section>
      <GuideReading />
    </>
  );
}
