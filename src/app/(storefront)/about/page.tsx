import Image from "next/image";
import type { ManagedPageRouteProps } from "@/app/_lib/managed-page-route";
import {
  generateManagedPageRouteMetadata,
  getManagedPageRouteData,
} from "@/app/_lib/managed-page-route";
import { ManagedPageContent } from "@/components/ManagedPageContent";
import { PageHero } from "@/components/PageHero";
import { Reveal } from "@/components/Reveal";
import { BreadcrumbJsonLd } from "@/components/JsonLd";
import { about } from "@/data/content";
import { company } from "@/data/company";

export function generateMetadata({ searchParams }: ManagedPageRouteProps) {
  return generateManagedPageRouteMetadata("ABOUT", searchParams);
}

const bands = [
  {
    title: "Product details grounded in available evidence",
    body: "Catalog descriptions help identify a material. Specifications, analytical results and documents that depend on a product or lot are confirmed separately before they are represented as available.",
    image: "/categories/antibacterial.jpg",
  },
  {
    title: "Requirements discussed in context",
    body: "Use a contact option currently enabled on the storefront to share the material, quantity, presentation, documentation and destination you need. We confirm what can be supported and put estimates or instructions in writing.",
    image: "/categories/muscle-growth.jpg",
  },
  {
    title: "Order progress recorded for customers",
    body: "Signed-in customers can review the status recorded for an order, payment, fulfillment and shipment. A status appears only after the corresponding event is created or confirmed.",
    image: "/categories/metabolic.jpg",
  },
];

function AboutFallback() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: "/" },
          { name: "About", url: "/about" },
        ]}
      />
      <PageHero
        eyebrow="About Flintmarrow"
        title="Research-use catalog and ordering for the United States"
        intro={about.intro}
        breadcrumbs={[
          { name: "Home", url: "/" },
          { name: "About", url: "/about" },
        ]}
      />

      <section className="section-y">
        <div className="container-x max-w-prose">
          {about.paragraphs.map((p, i) => (
            <p
              key={i}
              className={`text-lg text-body ${i > 0 ? "mt-6" : ""}`}
            >
              {p}
            </p>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section className="bg-ink-900">
        <div className="container-x grid grid-cols-2 gap-8 py-16 md:grid-cols-4">
          {company.stats.map((s) => (
            <div key={s.label} className="border-l border-cream-50/15 pl-5">
              <div className="text-h3 tabular-nums text-sage-300">
                {s.value}
              </div>
              <div className="mt-1 text-caption uppercase tracking-widest text-cream-200/60">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Story bands */}
      <section className="section-y">
        <div className="container-x space-y-20">
          {bands.map((b, i) => (
            <Reveal
              key={b.title}
              className={`grid items-center gap-10 lg:grid-cols-2 ${
                i % 2 === 1 ? "lg:[&>div:first-child]:order-2" : ""
              }`}
            >
              <div>
                <h2 className="text-h3 text-strong">{b.title}</h2>
                <p className="mt-4 text-lg text-body">{b.body}</p>
              </div>
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-line">
                <Image
                  src={b.image}
                  alt=""
                  fill
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="object-cover"
                />
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Operating principles */}
      <section className="bg-surface-alt">
        <div className="container-x py-20 md:py-30">
          <h2 className="text-h3 text-strong">How the storefront is designed to work</h2>
          <ul className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {about.principles.map((principle, index) => (
              <li
                key={principle.title}
                className="rounded-xl border border-line bg-surface p-6 shadow-sm"
              >
                <span className="font-mono text-h5 text-sage-500">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2 text-h6 text-strong">{principle.title}</h3>
                <p className="mt-2 text-sm text-body">{principle.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

export default async function AboutPage() {
  const { definition, page } = await getManagedPageRouteData("ABOUT");
  return page ? (
    <ManagedPageContent definition={definition} page={page} />
  ) : (
    <AboutFallback />
  );
}
