import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertAssetsForMode,
  auditLegacyAssets,
  findDuplicateCasGroups,
  LegacySourceError,
  EXPECTED_CATALOG_PRODUCT_COUNT,
  loadLegacyCommerceSource,
  parseLegacyDate,
  publicUrls,
  sourceHash,
  usdToMinor,
  validateLegacySource,
} from "../../../scripts/lib/legacy-commerce-source";

describe("legacy commerce source", () => {
  const source = loadLegacyCommerceSource();

  it("preserves the complete catalog entity and URL contract", () => {
    expect(() => validateLegacySource(source)).not.toThrow();
    expect(source.categories).toHaveLength(6);
    expect(source.products).toHaveLength(EXPECTED_CATALOG_PRODUCT_COUNT);
    expect(source.blogs).toHaveLength(4);
    expect(source.faqs).toHaveLength(8);

    const urls = publicUrls(source);
    expect(urls).toHaveLength(178);
    expect(new Set(urls).size).toBe(178);
    expect(urls).toContain("/products/selank");
    expect(urls).toContain("/products/selank-1");
  });

  it("converts exact USD amounts to bigint cents and never turns null into zero", () => {
    expect(usdToMinor(null)).toBeNull();
    expect(usdToMinor(9)).toBe(BigInt(900));
    expect(usdToMinor(19.99)).toBe(BigInt(1_999));
    expect(usdToMinor(0)).toBe(BigInt(0));
    expect(() => usdToMinor(-1)).toThrowError(LegacySourceError);
    expect(() => usdToMinor(1.001)).toThrowError(/at most two decimal places/);
  });

  it("treats date-only publication dates as UTC rather than local time", () => {
    expect(parseLegacyDate("2026-06-18").toISOString()).toBe(
      "2026-06-18T00:00:00.000Z",
    );
    expect(() => parseLegacyDate("2026-02-30")).toThrowError(LegacySourceError);
  });

  it("reports all missing gallery references while accepting verified primary assets", async () => {
    const audit = await auditLegacyAssets(source, resolve(process.cwd(), "public"));

    expect(audit.productPrimary.referenced).toBe(EXPECTED_CATALOG_PRODUCT_COUNT);
    expect(audit.productPrimary.verified).toHaveLength(EXPECTED_CATALOG_PRODUCT_COUNT);
    expect(
      audit.productPrimary.verified.every(
        (asset) => asset.width > 0 && asset.height > 0,
      ),
    ).toBe(true);
    expect(audit.productPrimary.missing).toEqual([]);
    expect(audit.categoryHeroes.verified).toHaveLength(6);
    expect(audit.blogCovers.verified).toHaveLength(4);
    expect(audit.gallery.referenced).toBe(0);
    expect(audit.gallery.verified).toHaveLength(0);
    expect(audit.gallery.missing).toHaveLength(0);
    expect(() => assertAssetsForMode(audit, "primary-only")).not.toThrow();
  });

  it("accepts strict asset mode after obsolete gallery references are removed", async () => {
    const audit = await auditLegacyAssets(source, resolve(process.cwd(), "public"));

    expect(() => assertAssetsForMode(audit, "strict-assets")).not.toThrow();
  });

  it("keeps repeated CAS numbers as non-unique attributes and preserves both Selank rows", () => {
    const duplicateGroups = findDuplicateCasGroups(source.products);
    const repeatedProducts = duplicateGroups.reduce(
      (count, group) => count + group.products.length,
      0,
    );
    const selank = source.products.filter((product) =>
      ["selank", "selank-1"].includes(product.id),
    );

    expect(duplicateGroups).toHaveLength(9);
    expect(repeatedProducts).toBe(19);
    expect(selank).toMatchObject([
      { id: "selank", name: "Selank 5mg", cas: "129954-34-3", price: 40 },
      { id: "selank-1", name: "Selank 10mg", cas: "129954-34-3", price: 69 },
    ]);
    expect(new Set(selank.map((product) => product.id)).size).toBe(2);
  });

  it("builds stable, order-sensitive source hashes", () => {
    const first = sourceHash({ slug: "selank", gallery: ["a", "b"] });
    const sameDifferentKeyOrder = sourceHash({ gallery: ["a", "b"], slug: "selank" });
    const changedArrayOrder = sourceHash({ slug: "selank", gallery: ["b", "a"] });

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(sameDifferentKeyOrder);
    expect(first).not.toBe(changedArrayOrder);
  });

  it("retains all three independent merchandising placement sets", () => {
    expect(source.placements.featuredProducts).toHaveLength(8);
    expect(source.placements.homeBestsellers).toHaveLength(8);
    expect(source.placements.categorySignatures).toHaveLength(6);
    expect(source.placements.categorySignatures.map((placement) => placement.index)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
    ]);
  });

  it("preserves every structured blog block, takeaway, FAQ, and related link", () => {
    expect(source.blogs.reduce((count, post) => count + post.body.length, 0)).toBe(88);
    expect(source.blogs.reduce((count, post) => count + post.takeaways.length, 0)).toBe(16);
    expect(source.blogs.reduce((count, post) => count + post.faqs.length, 0)).toBe(12);
    expect(
      source.blogs.reduce((count, post) => count + (post.related?.length ?? 0), 0),
    ).toBe(8);
  });

  it("assigns stable slugs without changing the reviewed storefront FAQ copy", () => {
    expect(source.faqs).toHaveLength(8);
    expect(new Set(source.faqs.map((faq) => faq.slug)).size).toBe(8);
    expect(source.faqs[0]).toMatchObject({
      slug: "research-use-only",
      question: "Are Veripep products intended for human use?",
    });
    expect(source.faqs.every((faq) => faq.answer.trim().length > 0)).toBe(true);
  });
});
