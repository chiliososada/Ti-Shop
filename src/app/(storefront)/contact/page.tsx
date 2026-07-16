import type { Metadata } from "next";
import { connection } from "next/server";
import { PageHero } from "@/components/PageHero";
import { ContactForm } from "@/components/ContactForm";
import { BreadcrumbJsonLd } from "@/components/JsonLd";
import { company } from "@/data/company";
import { createPublicPageMetadata } from "@/lib/public-page-metadata";
import { getPublicCategories } from "@/server/catalog";
import { getPublicWhatsAppPresentation } from "@/server/whatsapp/config";

export const metadata: Metadata = createPublicPageMetadata({
  title: "Contact sheng.an — Research Product and Order Questions",
  description:
    "Reach sheng.an by email and, when configured, a tracked WhatsApp handoff to discuss catalog items, USD orders, documents and eligible US shipping.",
  canonical: "/contact",
});

export default async function ContactPage() {
  await connection();
  const [whatsapp, categories] = await Promise.all([
    getPublicWhatsAppPresentation(),
    getPublicCategories(),
  ]);
  const details = [
    { label: "Email", value: company.email, href: `mailto:${company.email}` },
    {
      label: "WhatsApp",
      value: whatsapp?.displayValue ?? "Currently unavailable",
    },
    ...(whatsapp?.businessHours
      ? [{ label: "Business hours", value: whatsapp.businessHours }]
      : []),
    { label: "Storefront currency", value: company.displayCurrency },
    { label: "Order destinations", value: "Eligible United States addresses" },
  ];

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: "/" },
          { name: "Contact", url: "/contact" },
        ]}
      />
      <PageHero
        eyebrow="Contact"
        title="Discuss a product or order requirement"
        intro="Tell us the material, quantity, presentation and documents you need. When WhatsApp is enabled, the form prepares a tracked click-to-chat handoff so details can be confirmed for your request."
        breadcrumbs={[
          { name: "Home", url: "/" },
          { name: "Contact", url: "/contact" },
        ]}
      />

      <section className="section-y">
        <div className="container-x grid gap-12 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <h2 className="text-h4 text-strong">Talk to our team</h2>
            <p className="mt-3 text-body">
              Ask about catalog details, current availability, documentation,
              payment instructions or an existing order for an eligible United
              States destination.
            </p>
            <dl className="mt-8 space-y-6">
              {details.map((d) => (
                <div key={d.label} className="border-l-2 border-sage-500 pl-4">
                  <dt className="font-mono text-eyebrow uppercase text-sage-600">
                    {d.label}
                  </dt>
                  <dd className="mt-1 text-body">
                    {d.href ? (
                      <a
                        href={d.href}
                        className="transition-colors hover:text-strong"
                      >
                        {d.value}
                      </a>
                    ) : (
                      d.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <ContactForm
            whatsappEnabled={whatsapp !== null}
            categories={categories.map(({ slug, name }) => ({ slug, name }))}
          />
        </div>
      </section>
    </>
  );
}
