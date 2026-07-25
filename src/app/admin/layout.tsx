import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";

/**
 * Console chrome, deliberately separate from the storefront frame: no product
 * navigation, no cart, no WhatsApp entry. Access control stays in each page's
 * data layer (layouts do not re-run on client navigation, so they cannot be
 * trusted as an auth gate); these links merely navigate, and every target
 * enforces its own permission.
 */
const ADMIN_NAV = [
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/fulfillment", label: "Fulfillment" },
  { href: "/admin/inventory", label: "Inventory" },
  { href: "/admin/catalog", label: "Catalog" },
  { href: "/admin/finance", label: "Finance" },
  { href: "/admin/customers", label: "Customers" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/manual", label: "Manual" },
] as const;

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-ink-900/[0.08] bg-surface/95 backdrop-blur print:hidden">
        <div className="container-x flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
          <Link
            href="/admin"
            aria-label="Flintmarrow administration home"
            className="flex items-center gap-3 font-semibold text-strong"
          >
            <span className="rounded-lg bg-white px-2 py-1">
              <BrandLogo eager className="h-10 w-auto" />
            </span>
            <span className="font-mono text-eyebrow uppercase tracking-wider text-sage-600">
              Administration
            </span>
          </Link>
          <nav
            aria-label="Administration modules"
            className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm font-medium text-muted"
          >
            {ADMIN_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="transition-colors hover:text-strong"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Link
            href="/"
            target="_blank"
            rel="noreferrer"
            className="ml-auto rounded-full border border-ink-900/15 px-4 py-1.5 text-sm font-semibold text-strong transition-colors hover:border-sage-600 hover:text-sage-700"
          >
            Storefront ↗
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </>
  );
}
