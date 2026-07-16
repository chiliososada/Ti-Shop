import Link from "next/link";

import { BreadcrumbJsonLd } from "@/components/JsonLd";
import { PageHero } from "@/components/PageHero";

export type PolicySection = {
  heading: string;
  paragraphs?: readonly string[];
  items?: readonly string[];
};

export function PolicyPage({
  eyebrow,
  title,
  intro,
  path,
  sections,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  path: string;
  sections: readonly PolicySection[];
}) {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: "/" },
          { name: title, url: path },
        ]}
      />
      <PageHero
        eyebrow={eyebrow}
        title={title}
        intro={intro}
        breadcrumbs={[
          { name: "Home", url: "/" },
          { name: title, url: path },
        ]}
      />
      <section className="section-y bg-surface-warm">
        <div className="container-x max-w-4xl">
          <p className="font-mono text-caption uppercase tracking-wider text-muted">
            Last updated July 13, 2026
          </p>
          <div className="mt-8 space-y-6">
            {sections.map((section) => (
              <article
                key={section.heading}
                className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8"
              >
                <h2 className="text-h4 text-strong">{section.heading}</h2>
                {section.paragraphs?.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="mt-4 text-base leading-relaxed text-body"
                  >
                    {paragraph}
                  </p>
                ))}
                {section.items ? (
                  <ul className="mt-4 list-disc space-y-2 pl-5 text-base leading-relaxed text-body marker:text-sage-500">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
          <p className="mt-8 rounded-2xl bg-surface-alt px-6 py-5 text-sm leading-relaxed text-body">
            Questions about this policy or a specific order can be sent through
            our <Link href="/contact" className="font-semibold text-strong underline">contact page</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
