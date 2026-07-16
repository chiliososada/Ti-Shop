import Link from "next/link";

import { BreadcrumbJsonLd, WebPageJsonLd } from "@/components/JsonLd";
import { PageHero } from "@/components/PageHero";
import {
  parseManagedPageContent,
  type ManagedPageContentBlock,
} from "@/lib/managed-page-content";
import type { ManagedPageDefinition } from "@/lib/managed-page-routes";
import type { PublicManagedPage } from "@/server/content/public-managed-pages";

function ContentBlock({ block }: { block: ManagedPageContentBlock }) {
  if (block.type === "heading") {
    return <h2 className="pt-4 text-h4 text-strong">{block.text}</h2>;
  }
  if (block.type === "list") {
    return (
      <ul className="list-disc space-y-2 pl-5 text-base leading-relaxed text-body marker:text-sage-500">
        {block.items.map((item, index) => (
          <li key={`${index}-${item}`}>{item}</li>
        ))}
      </ul>
    );
  }
  return (
    <p className="whitespace-pre-wrap text-base leading-relaxed text-body">
      {block.text}
    </p>
  );
}

export function ManagedPageContent({
  definition,
  page,
}: {
  definition: ManagedPageDefinition;
  page: PublicManagedPage;
}) {
  const blocks = parseManagedPageContent(page.body);
  if (!blocks) return null;

  const description = page.seo?.description ?? definition.fallbackDescription;
  const crumbs = [
    { name: "Home", url: "/" },
    { name: page.title, url: definition.path },
  ];

  return (
    <>
      <WebPageJsonLd
        title={page.title}
        description={description}
        url={definition.path}
        datePublished={page.publishedAt}
        dateModified={page.updatedAt}
      />
      <BreadcrumbJsonLd items={crumbs} />
      <PageHero
        eyebrow={definition.eyebrow}
        title={page.title}
        intro={description}
        breadcrumbs={crumbs}
      />

      <article className="section-y bg-surface-warm">
        <div className="container-x max-w-4xl">
          <p className="font-mono text-caption uppercase tracking-wider text-muted">
            Last updated {new Intl.DateTimeFormat("en-US", {
              dateStyle: "long",
              timeZone: "UTC",
            }).format(new Date(page.updatedAt))}
          </p>
          <div className="mt-8 space-y-6 rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
            {blocks.map((block, index) => (
              <ContentBlock key={`${block.type}-${index}`} block={block} />
            ))}
          </div>

          <aside
            aria-label="Required compliance notice"
            className="mt-8 space-y-3 rounded-2xl border border-amber-700/20 bg-amber-50 px-6 py-5 text-sm leading-relaxed text-amber-950"
          >
            <p className="font-semibold">Required compliance notice</p>
            <p>{definition.complianceNotice}</p>
            <p>
              All listed materials are for qualified laboratory and research use
              only, not for human or veterinary use. Never send account
              passwords, payment credentials, private keys, recovery phrases,
              or unnecessary personal information through WhatsApp or a public
              page.
            </p>
          </aside>

          <p className="mt-8 rounded-2xl bg-surface-alt px-6 py-5 text-sm leading-relaxed text-body">
            Questions about this page or a specific order can be sent through
            our{" "}
            <Link
              href="/contact"
              className="font-semibold text-strong underline"
            >
              contact page
            </Link>
            .
          </p>
        </div>
      </article>
    </>
  );
}
