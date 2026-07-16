import { describe, expect, it } from "vitest";

import { parseSafeNavigationUrl } from "@/lib/navigation-url";

describe("storefront navigation URL policy", () => {
  it("accepts and classifies root-relative paths and credential-free HTTPS URLs", () => {
    expect(parseSafeNavigationUrl("/products?sort=new#catalog")).toEqual({
      href: "/products?sort=new#catalog",
      external: false,
    });
    expect(parseSafeNavigationUrl("https://docs.example.com/guide?q=1")).toEqual({
      href: "https://docs.example.com/guide?q=1",
      external: true,
    });
  });

  it("rejects executable, protocol-relative, credentialed, ambiguous, and controlled URLs", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,unsafe",
      "//evil.example/path",
      "https://user:password@example.com/",
      "https://example.com\\@evil.example/",
      "https://example.com/%0aunsafe",
      "https://example.com/%E2%80%AEunsafe",
      "/path/%5c/unsafe",
      "products",
      " /products",
      "/products\n",
    ]) {
      expect(parseSafeNavigationUrl(value), value).toBeNull();
    }
  });

  it("rejects private and framework-internal same-origin destinations", () => {
    for (const value of [
      "/admin",
      "/admin/users",
      "/ADMIN/users",
      "/%61dmin/users",
      "/products/../api/orders",
      "/account/orders",
      "/checkout/success",
      "/_next/static/chunk.js",
      "/api;internal",
    ]) {
      expect(parseSafeNavigationUrl(value), value).toBeNull();
    }

    expect(parseSafeNavigationUrl("/administrator")).toEqual({
      href: "/administrator",
      external: false,
    });
    expect(parseSafeNavigationUrl("/login")).toEqual({
      href: "/login",
      external: false,
    });
  });
});
