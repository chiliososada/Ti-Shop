import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { resolveFooterNavigation } from "@/components/SiteFooter";
import { resolveHeaderNavigation } from "@/components/SiteHeader";
import { StorefrontNavigationLink } from "@/components/StorefrontNavigationLink";

describe("storefront navigation rendering", () => {
  it("retains reviewed header and footer fallbacks for null or empty menus", () => {
    expect(resolveHeaderNavigation(null).length).toBeGreaterThan(0);
    expect(resolveHeaderNavigation([]).map((item) => item.href)).toContain(
      "/products",
    );
    expect(resolveFooterNavigation(null).length).toBeGreaterThan(0);
    expect(resolveFooterNavigation([]).map((item) => item.href)).toContain(
      "/contact",
    );
  });

  it("adds reverse-tabnabbing protection to HTTPS links opened in a new tab", () => {
    const html = renderToStaticMarkup(
      createElement(StorefrontNavigationLink, {
        link: {
          id: "external-docs",
          label: "Documentation",
          href: "https://docs.example.com/",
          external: true,
          openInNewTab: true,
        },
      }),
    );

    expect(html).toContain('href="https://docs.example.com/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
