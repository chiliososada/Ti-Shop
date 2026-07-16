import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertAssetsForMode,
  auditLegacyAssets,
  findDuplicateCasGroups,
  LegacySourceError,
  loadLegacyCommerceSource,
  parseLegacyDate,
  publicUrls,
  sourceHash,
  usdToMinor,
  validateLegacySource,
} from "../../../scripts/lib/legacy-commerce-source";

describe("legacy commerce source", () => {
  const source = loadLegacyCommerceSource();

  it("preserves the complete legacy entity and URL contract", () => {
    expect(() => validateLegacySource(source)).not.toThrow();
    expect(source.categories).toHaveLength(6);
    expect(source.products).toHaveLength(75);
    expect(source.blogs).toHaveLength(4);
    expect(source.faqs).toHaveLength(8);

    const urls = publicUrls(source);
    expect(urls).toHaveLength(91);
    expect(new Set(urls).size).toBe(91);
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

  it("reports all missing gallery references while accepting verified primary assets", () => {
    const audit = auditLegacyAssets(source, resolve(process.cwd(), "public"));

    expect(audit.productPrimary.referenced).toBe(75);
    expect(audit.productPrimary.verified).toHaveLength(75);
    expect(audit.productPrimary.missing).toEqual([]);
    expect(audit.categoryHeroes.verified).toHaveLength(6);
    expect(audit.blogCovers.verified).toHaveLength(4);
    expect(audit.gallery.referenced).toBe(306);
    expect(audit.gallery.verified).toHaveLength(6);
    expect(audit.gallery.missing).toHaveLength(300);
    expect(() => assertAssetsForMode(audit, "primary-only")).not.toThrow();
  });

  it("fails strict asset mode before missing gallery references can be ignored", () => {
    const audit = auditLegacyAssets(source, resolve(process.cwd(), "public"));

    expect(() => assertAssetsForMode(audit, "strict-assets")).toThrowError(
      /rejected 300 missing gallery references/,
    );
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

    expect(duplicateGroups).toHaveLength(11);
    expect(repeatedProducts).toBe(24);
    expect(selank).toMatchObject([
      { id: "selank", name: "Selank 5mg", cas: "129954-34-3", price: 46 },
      { id: "selank-1", name: "Selank 5mg", cas: "129954-34-3", price: 75 },
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
      question: "Are sheng.an products intended for human use?",
    });
    expect(source.faqs.every((faq) => faq.answer.trim().length > 0)).toBe(true);
  });
});
