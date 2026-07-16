import { describe, expect, it } from "vitest";

import {
  isRemotePublicAssetUrl,
  sanitizePublicAssetUrl,
} from "@/lib/public-asset-url";

describe("public asset URL policy", () => {
  it("allows normalized root-relative paths and credential-free HTTPS", () => {
    expect(sanitizePublicAssetUrl("/products/example.jpg?v=2")).toBe(
      "/products/example.jpg?v=2",
    );
    expect(sanitizePublicAssetUrl("/documents/file%20name.pdf")).toBe(
      "/documents/file%20name.pdf",
    );
    expect(sanitizePublicAssetUrl("https://CDN.EXAMPLE:443/a.jpg")).toBe(
      "https://cdn.example/a.jpg",
    );
    expect(isRemotePublicAssetUrl("https://cdn.example/a.jpg")).toBe(true);
    expect(isRemotePublicAssetUrl("/products/a.jpg")).toBe(false);
  });

  it("rejects insecure, credentialed, ambiguous, and encoded-control URLs", () => {
    for (const unsafe of [
      "http://cdn.example/a.jpg",
      "https://user:password@cdn.example/a.jpg",
      "https://user@cdn.example/a.jpg",
      "https:\\cdn.example\\a.jpg",
      "//cdn.example/a.jpg",
      "/\\cdn.example/a.jpg",
      "/%2fcdn.example/a.jpg",
      "/products/foo%5cbar.jpg",
      "/products/foo%255cbar.jpg",
      "/products/foo%00bar.jpg",
      "/products/foo%250abar.jpg",
      "https://cdn.example/a%0d%0a.jpg",
      "javascript:alert(1)",
      "data:image/svg+xml,<svg />",
      " /products/a.jpg",
      "/products/a b.jpg",
      "/products/bad%.jpg",
    ]) {
      expect(sanitizePublicAssetUrl(unsafe), unsafe).toBeNull();
      expect(isRemotePublicAssetUrl(unsafe), unsafe).toBe(false);
    }
  });
});
