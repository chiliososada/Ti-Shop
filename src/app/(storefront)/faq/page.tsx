import type { Metadata } from "next";
import { connection } from "next/server";

import { PageHero } from "@/components/PageHero";
import { Button } from "@/components/ui";
import { BreadcrumbJsonLd, FaqJsonLd } from "@/components/JsonLd";
import { createPublicPageMetadata } from "@/lib/public-page-metadata";
import { getPublicFaqs } from "@/server/content";

export const metadata: Metadata = createPublicPageMetadata({
  title: "Research Peptide FAQ — US Shipping & Payment",
  description:
    "Answers on product specifications, lot documents, US shipping, enabled payment methods and research-use restrictions.",
  canonical: "/faq",
});

export default async function FaqPage() {
  await connection();
  const faqs = await getPublicFaqs();

  return (
    <>
      {faqs.length > 0 ? <FaqJsonLd faqs={faqs} /> : null}
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: "/" },
          { name: "FAQ", url: "/faq" },
        ]}
      />
      <PageHero
        eyebrow="Support"
        title="Frequently asked questions"
        intro="Product details, documentation, shipping, payments and research-use boundaries to review before ordering."
        breadcrumbs={[
          { name: "Home", url: "/" },
          { name: "FAQ", url: "/faq" },
        ]}
      />

      <section className="section-y">
        <div className="container-x max-w-3xl">
          {faqs.length > 0 ? (
            <div className="divide-y divide-line rounded-lg bg-surface ring-1 ring-line">
            {faqs.map((faq, index) => (
              <details
                key={faq.publicId}
                className="group px-6 [&_summary::-webkit-details-marker]:hidden"
                open={index === 0}
              >
                <summary className="flex cursor-pointer items-center justify-between gap-4 py-5 text-h6 text-strong">
                  {faq.question}
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-alt text-ink-500 transition-all group-open:rotate-45 group-open:bg-sage-500 group-open:text-cream-50">
                    +
                  </span>
                </summary>
                <div className="pb-6 pr-10 text-base leading-relaxed text-body">
                  {faq.answer}
                </div>
              </details>
            ))}
            </div>
          ) : (
            <div className="rounded-xl border border-line bg-surface p-8 text-center">
              <h2 className="text-h5 text-strong">No published FAQ entries yet</h2>
              <p className="mx-auto mt-3 max-w-xl text-body">
                The FAQ library is currently empty. Contact us for product,
                ordering, payment, or shipping questions.
              </p>
            </div>
          )}

          <div className="mt-12 rounded-xl border border-line bg-surface-alt p-8 text-center">
            <h2 className="text-h5 text-strong">Still have a question?</h2>
            <p className="mx-auto mt-2 max-w-md text-body">
              Send the product or order details you want us to confirm.
            </p>
            <div className="mt-5 flex justify-center">
              <Button href="/contact" variant="primary">
                Contact our team
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
