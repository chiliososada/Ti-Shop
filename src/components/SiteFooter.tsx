import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { company } from "@/data/company";
import { WhatsAppIntentButton } from "@/components/whatsapp/WhatsAppIntentButton";
import { StorefrontNavigationLink } from "@/components/StorefrontNavigationLink";
import type { StorefrontNavigationLink as NavigationLinkValue } from "@/lib/navigation-url";

const fallbackCompanyNavigation = [
  { id: "fallback-about", label: "About", href: "/about", external: false, openInNewTab: false },
  { id: "fallback-products", label: "All Products", href: "/products", external: false, openInNewTab: false },
  { id: "fallback-blog", label: "Blog", href: "/blog", external: false, openInNewTab: false },
  { id: "fallback-faq", label: "FAQ", href: "/faq", external: false, openInNewTab: false },
  { id: "fallback-contact", label: "Contact", href: "/contact", external: false, openInNewTab: false },
] satisfies readonly NavigationLinkValue[];

export function resolveFooterNavigation(
  navigation: readonly NavigationLinkValue[] | null,
) {
  return navigation?.length ? navigation : fallbackCompanyNavigation;
}

export function SiteFooter({
  whatsapp,
  categories,
  navigation,
}: {
  whatsapp: {
    displayValue: string;
    businessHours: string | null;
  } | null;
  categories: ReadonlyArray<{ slug: string; name: string }>;
  navigation: readonly NavigationLinkValue[] | null;
}) {
  const companyNavigation = resolveFooterNavigation(navigation);

  return (
    <footer className="bg-ink-900 text-cream-200">
      <div className="container-x py-18">
        <div className="grid gap-12 lg:grid-cols-[1.6fr_repeat(3,1fr)]">
          <div>
            <Link
              href="/"
              aria-label="Veripep home"
              className="inline-flex rounded-2xl bg-white px-3 py-2"
            >
              <BrandLogo className="h-20 w-auto" />
            </Link>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-cream-200/70">
              {company.description}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {["Research use only", "USD storefront", "US market"].map((b) => (
                <span
                  key={b}
                  className="rounded-full border border-cream-50/15 px-3 py-1 text-caption text-cream-200/80"
                >
                  {b}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="font-mono text-eyebrow uppercase text-sage-400">
              Catalogue
            </div>
            <ul className="mt-4 space-y-2.5">
              {categories.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/categories/${c.slug}`}
                    className="text-sm text-cream-200/70 transition-colors hover:text-cream-50"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="font-mono text-eyebrow uppercase text-sage-400">
              Company
            </div>
            <ul className="mt-4 space-y-2.5">
              {companyNavigation.map((link) => (
                <li key={link.id}>
                  <StorefrontNavigationLink
                    link={link}
                    className="text-sm text-cream-200/70 transition-colors hover:text-cream-50"
                  />
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="font-mono text-eyebrow uppercase text-sage-400">
              Contact
            </div>
            <ul className="mt-4 space-y-2.5 text-sm text-cream-200/70">
              <li>
                <a
                  href={`mailto:${company.email}`}
                  className="transition-colors hover:text-cream-50"
                >
                  {company.email}
                </a>
              </li>
              <li>
                {whatsapp ? (
                  <WhatsAppIntentButton
                    intent={{ templateKey: "global" }}
                    className="text-left transition-colors hover:text-cream-50 disabled:cursor-wait disabled:opacity-70"
                    fallbackClassName="block text-caption font-semibold text-cream-50 underline"
                  >
                    WhatsApp {whatsapp.displayValue}
                  </WhatsAppIntentButton>
                ) : (
                  <span className="text-cream-200/50">
                    WhatsApp contact is currently unavailable.
                  </span>
                )}
              </li>
              {whatsapp?.businessHours ? (
                <li className="whitespace-pre-line text-cream-200/50">
                  {whatsapp.businessHours}
                </li>
              ) : null}
              <li className="text-cream-200/50">
                Product and order details are confirmed for each request.
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col justify-between gap-4 border-t border-cream-50/10 pt-8 text-caption text-cream-200/50 md:flex-row">
          <p>
            © {new Date().getFullYear()} {company.name} — For research use only.
            Not for human consumption.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/privacy" className="hover:text-cream-50">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-cream-50">
              Terms
            </Link>
            <Link href="/research-use" className="hover:text-cream-50">
              Compliance
            </Link>
            <Link href="/shipping" className="hover:text-cream-50">Shipping</Link>
            <Link href="/returns" className="hover:text-cream-50">Returns</Link>
            <Link href="/payment-policy" className="hover:text-cream-50">Payments</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
