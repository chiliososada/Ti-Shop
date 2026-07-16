"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CartButton } from "@/components/cart/CartButton";
import { StorefrontNavigationLink } from "@/components/StorefrontNavigationLink";
import type { StorefrontNavigationLink as NavigationLinkValue } from "@/lib/navigation-url";

type NavigationCategory = {
  slug: string;
  name: string;
  description: string | null;
};

const fallbackNavigation = [
  { id: "fallback-products", label: "Products", href: "/products", external: false, openInNewTab: false },
  { id: "fallback-about", label: "About", href: "/about", external: false, openInNewTab: false },
  { id: "fallback-blog", label: "Blog", href: "/blog", external: false, openInNewTab: false },
  { id: "fallback-faq", label: "FAQ", href: "/faq", external: false, openInNewTab: false },
  { id: "fallback-contact", label: "Contact", href: "/contact", external: false, openInNewTab: false },
] satisfies readonly NavigationLinkValue[];

export function resolveHeaderNavigation(
  navigation: readonly NavigationLinkValue[] | null,
) {
  return navigation?.length ? navigation : fallbackNavigation;
}

function Wordmark() {
  return (
    <Link
      href="/"
      className="text-h5 font-bold tracking-tight text-strong"
    >
      sheng<span className="text-sage-500">.</span>an
    </Link>
  );
}

export function SiteHeader({
  categories,
  navigation,
}: {
  categories: readonly NavigationCategory[];
  navigation: readonly NavigationLinkValue[] | null;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const navigationLinks = resolveHeaderNavigation(navigation);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-ink-900/[0.07] bg-base/85 backdrop-blur-xl"
          : "border-b border-transparent bg-base/40 backdrop-blur-md"
      }`}
    >
      <nav className="container-x flex h-20 items-center justify-between">
        <Wordmark />

        <ul className="hidden items-center gap-9 lg:flex">
          {navigationLinks.map((link) =>
            !link.external &&
            link.href === "/products" &&
            !link.openInNewTab ? (
              <li key={link.id} className="group relative">
                <StorefrontNavigationLink
                  link={link}
                  className="flex items-center gap-1 py-2 text-sm font-semibold text-body transition-colors hover:text-strong"
                >
                  {link.label}
                  <svg
                    className="h-4 w-4 transition-transform group-hover:rotate-180"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </StorefrontNavigationLink>
                <div className="invisible absolute left-1/2 top-full w-[660px] -translate-x-1/2 pt-3 opacity-0 transition-all duration-200 group-hover:visible group-hover:opacity-100">
                  <div className="rounded-2xl border border-ink-900/[0.07] bg-cream-50 p-6 shadow-xl">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                      {categories.map((category) => (
                        <Link
                          key={category.slug}
                          href={`/categories/${category.slug}`}
                          className="flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-surface-alt"
                        >
                          <svg
                            className="mt-0.5 h-5 w-5 shrink-0 text-sage-500"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            aria-hidden
                          >
                            <path d="M4 7h16M6 12h12M8 17h8" />
                          </svg>
                          <span>
                            <span className="block text-sm font-semibold text-strong">
                              {category.name}
                            </span>
                            <span className="block line-clamp-1 text-caption text-muted">
                              {category.description ?? `Explore ${category.name}`}
                            </span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              </li>
            ) : (
              <li key={link.id}>
                <StorefrontNavigationLink
                  link={link}
                  className="py-2 text-sm font-semibold text-body transition-colors hover:text-strong"
                />
              </li>
            ),
          )}
        </ul>

        <div className="flex items-center gap-2">
          <Link
            href="/account"
            aria-label="Customer account"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-strong transition-colors hover:bg-ink-900/[0.06]"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
            </svg>
          </Link>
          <CartButton />
          <Link
            href="/contact"
            className="hidden rounded-full bg-ink-900 px-5 py-2.5 text-sm font-semibold text-cream-50 transition-colors hover:bg-sage-600 md:block"
          >
            Request Quote
          </Link>
          <button
            className="lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            <svg
              className="h-6 w-6 text-strong"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              {open ? (
                <path d="M18 6 6 18M6 6l12 12" />
              ) : (
                <path d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </nav>

      {open ? (
        <div className="border-t border-ink-900/[0.07] bg-cream-50 lg:hidden">
          <div className="container-x flex flex-col gap-1 py-4">
            {navigationLinks.map((link) => (
              <StorefrontNavigationLink
                key={link.id}
                link={link}
                className="rounded-xl px-3 py-2.5 text-sm font-semibold text-body hover:bg-surface-alt"
                onNavigate={() => setOpen(false)}
              />
            ))}
            <Link
              href="/account"
              className="rounded-xl px-3 py-2.5 text-sm font-semibold text-body hover:bg-surface-alt"
              onClick={() => setOpen(false)}
            >
              Customer account
            </Link>
            <div className="mt-2 grid grid-cols-1 gap-1 border-t border-ink-900/[0.07] pt-3">
              {categories.map((c) => (
                <Link
                  key={c.slug}
                  href={`/categories/${c.slug}`}
                  className="rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface-alt"
                  onClick={() => setOpen(false)}
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
