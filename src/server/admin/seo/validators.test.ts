import { describe, expect, it } from "vitest";

import {
  redirectCreateFormSchema,
  seoFormSchema,
} from "@/server/admin/seo/validators";

const BASE = {
  entityType: "product",
  targetPublicId: "00000000-0000-4000-8000-000000000001",
  title: "SEO title",
  description: "SEO description",
  openGraphMediaPublicId: "",
};

describe("SEO admin validators", () => {
  it("accepts safe relative and HTTPS canonical URLs", () => {
    expect(
      seoFormSchema.safeParse({ ...BASE, canonicalUrl: "/products/item" }).success,
    ).toBe(true);
    expect(
      seoFormSchema.safeParse({
        ...BASE,
        canonicalUrl: "https://example.com/products/item",
      }).success,
    ).toBe(true);
  });

  it("rejects protocol-relative, HTTP, credentialed, stateful, and ambiguous canonical values", () => {
    for (const canonicalUrl of [
      "//evil.example/item",
      "javascript:alert(1)",
      "/\\evil.example/item",
      "http://example.com/item",
      "http://localhost:3000/item",
      "https://user:password@example.com/item",
      "https://example.com/item?campaign=test",
      "https://example.com/item#section",
      "/admin/seo",
    ]) {
      expect(seoFormSchema.safeParse({ ...BASE, canonicalUrl }).success).toBe(
        false,
      );
    }
  });

  it("accepts an existing media public UUID or an explicit cleared selection", () => {
    expect(
      seoFormSchema.safeParse({
        ...BASE,
        canonicalUrl: "",
        openGraphMediaPublicId: "00000000-0000-4000-8000-000000000002",
      }).success,
    ).toBe(true);
    expect(
      seoFormSchema.safeParse({
        ...BASE,
        canonicalUrl: "",
        openGraphMediaPublicId: "2",
      }).success,
    ).toBe(false);
  });

  it("supports standalone page SEO targets", () => {
    expect(
      seoFormSchema.safeParse({ ...BASE, entityType: "page", canonicalUrl: "/pages/guide" })
        .success,
    ).toBe(true);
  });

  it("allows only permanent, root-relative public redirect paths", () => {
    const base = {
      sourcePath: "/old-page",
      destinationPath: "/pages/new-page",
      statusCode: "308",
      preserveQuery: "on",
      isActive: "on",
      startsAt: "",
      endsAt: "",
    };
    expect(redirectCreateFormSchema.safeParse(base).success).toBe(true);

    for (const invalid of [
      { ...base, sourcePath: "/admin/users" },
      { ...base, sourcePath: "/api/orders" },
      { ...base, destinationPath: "https://evil.example/new" },
      { ...base, destinationPath: "//evil.example/new" },
      { ...base, destinationPath: "/new?from=old" },
      { ...base, statusCode: "302" },
      { ...base, destinationPath: "/old-page" },
    ]) {
      expect(redirectCreateFormSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
