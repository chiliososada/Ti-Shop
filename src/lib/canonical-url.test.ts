import { describe, expect, it } from "vitest";

import { normalizeCanonicalUrl } from "@/lib/canonical-url";

describe("canonical URL policy", () => {
  it("accepts public root-relative paths and normalized credential-free HTTPS", () => {
    expect(normalizeCanonicalUrl("/products/item")).toBe("/products/item");
    expect(normalizeCanonicalUrl("https://example.com/products/item")).toBe(
      "https://example.com/products/item",
    );
    expect(normalizeCanonicalUrl("https://localhost:3000/pages/guide")).toBe(
      "https://localhost:3000/pages/guide",
    );
  });

  it("rejects HTTP, credentials, query/hash state, private paths, and ambiguous input", () => {
    for (const value of [
      "http://example.com/products/item",
      "http://localhost:3000/products/item",
      "https://user:password@example.com/products/item",
      "https://example.com/products/item?campaign=test",
      "https://example.com/products/item#details",
      "/products/item?campaign=test",
      "/products/item#details",
      "/admin/seo",
      "/ad%6din/seo",
      "/%2561dmin/seo",
      "/api/products",
      "/account/orders",
      "//evil.example/products/item",
      "/products/../admin/seo",
      "/products\\item",
      "/products/%250aitem",
      "/products/%253fpreview",
      "https://example.com/products/%2523details",
      "/products/%E2%80%AEitem",
      " /products/item",
    ]) {
      expect(normalizeCanonicalUrl(value), value).toBeNull();
    }
  });
});
