import { describe, expect, it } from "vitest";

import { categories } from "@/data/categories";
import supplierCatalog from "@/data/supplier-catalog.json";
import { buildLlmsFullText, buildLlmsText, type LlmsInput } from "@/lib/llms-text";
import {
  categoryFaqs,
  classificationPhrase,
  formatPerMg,
  formatPerVial,
  formatUsd,
  getMaterialFacts,
  groupMaterials,
  hasHub,
  hubFaqs,
  hubIntro,
  hubMetaDescription,
  hubTitle,
  materialSlug,
  productFaqs,
  type MaterialListing,
} from "@/lib/material-hubs";

const listings: MaterialListing[] = supplierCatalog.products.map((product) => ({
  slug: product.slug,
  title: product.title,
  family: product.family,
  strength: product.strength,
  codes: product.codes,
  packCount: product.packCount,
  categorySlug: product.category,
  categoryName: categories.find((category) => category.slug === product.category)?.name ?? null,
  priceMinor: Math.round(product.priceUsd * 100),
  available: product.available,
  updatedAt: "2026-09-23T10:00:00.000Z",
  image: product.image,
}));
const groups = groupMaterials(listings);
const bySlug = new Map(groups.map((group) => [group.slug, group]));

/** Wording that would imply human use, dosing, therapy or outcomes. */
const prohibited = [
  /\bdos(?:e|es|ed|ing|age)\b/iu,
  /\binject\w*/iu,
  /\b(?:human use|for humans|in humans|human subjects?)\b/iu,
  /\bpatients?\b/iu,
  /\b(?:treat|treats|treating|treatment|treatments)\b/iu,
  /\btherap\w*/iu,
  /\b(?:weight[- ]loss|fat[- ]loss|lose weight)\b/iu,
  /\bbenefit\w*/iu,
  /\b(?:safe|safety|side[- ]effects?)\b/iu,
  /\breconstitut\w*/iu,
  /\bbacteriostatic\b/iu,
  /\bpubmed\b/iu,
];

describe("material facts", () => {
  it("describe every catalog family", () => {
    const missing = [...new Set(listings.map((listing) => listing.family))].filter(
      (family) => !getMaterialFacts(family),
    );
    expect(missing).toEqual([]);
  });

  it("give every material a unique, URL-safe hub slug", () => {
    const slugs = groups.map((group) => group.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    expect(materialSlug("Thymosin α-1")).toBe("thymosin-alpha-1");
    expect(materialSlug("BPC-157 5mg + TB-500 5mg Blend")).toBe("bpc-157-5mg-plus-tb-500-5mg-blend");
  });
});

describe("material hubs", () => {
  const tirzepatide = bySlug.get("tirzepatide")!;

  it("exist for materials with several strengths only", () => {
    expect(hasHub(tirzepatide)).toBe(true);
    expect(groups.filter(hasHub).length).toBeGreaterThan(40);
    const single = groups.find((group) => group.listings.length === 1)!;
    expect(hasHub(single)).toBe(false);
  });

  it("sort strengths by amount and state the price range from the data", () => {
    const strengths = tirzepatide.listings.map((listing) => listing.strength);
    expect(strengths[0]).toBe("5mg");
    expect(strengths.at(-1)).toBe("120mg");
    const intro = hubIntro(tirzepatide);
    expect(intro).toMatch(
      /^Tirzepatide is a dual GIP and GLP-1 receptor agonist \(incretin analogue\)\. Flintmarrow lists it in 11 strengths, from 5mg to 120mg per vial, packed 10 vials per box\./u,
    );
    const prices = tirzepatide.listings.map((listing) => listing.priceMinor!);
    expect(intro).toContain(formatUsd(Math.min(...prices)));
    expect(intro).toContain(formatUsd(Math.max(...prices)));
  });

  it("writes the classification as a noun phrase with the right article", () => {
    expect(classificationPhrase("AMPK activator")).toBe("an AMPK activator");
    expect(classificationPhrase("ActRIIB ligand trap")).toBe("an ActRIIB ligand trap");
    expect(classificationPhrase("SNARE-complex modulating peptide")).toBe("a SNARE-complex modulating peptide");
    expect(classificationPhrase("Oxytocin receptor agonist")).toBe("an oxytocin receptor agonist");
    expect(classificationPhrase("Semax (ACTH 4-10 family) analogue")).toBe("a Semax (ACTH 4-10 family) analogue");
    expect(classificationPhrase("α-MSH C-terminal fragment")).toBe("an α-MSH C-terminal fragment");
  });

  it("divides the box price into per-vial and per-mg figures", () => {
    const five = tirzepatide.listings[0];
    expect(formatUsd(five.priceMinor!)).toBe("$30.00");
    expect(formatPerVial(five)).toBe("$3.00");
    expect(formatPerMg(five, tirzepatide)).toBe("$0.600");
  });

  it("gives no per-mg figure for blends or non-mass units", () => {
    const nad = bySlug.get("nad-plus")!;
    expect(formatPerMg(nad.listings[0], nad)).not.toBeNull();
    const blend = groups.find((group) => /\s\+\s/u.test(group.family))!;
    expect(formatPerMg(blend.listings[0], blend)).toBeNull();
    const iu = groups.find((group) => group.listings.some((listing) => /iu$/iu.test(listing.strength)))!;
    const iuListing = iu.listings.find((listing) => /iu$/iu.test(listing.strength))!;
    expect(formatPerMg(iuListing, iu)).toBeNull();
  });

  it("mentions unavailable strengths only when there are some", () => {
    const out = groups.find((group) => group.listings.some((listing) => !listing.available));
    if (out) expect(hubIntro(out)).toContain("temporarily unavailable");
    expect(hubIntro(tirzepatide)).not.toContain("unavailable");
  });

  it("keeps titles and descriptions bounded", () => {
    for (const group of groups.filter(hasHub)) {
      expect(hubTitle(group).length).toBeLessThanOrEqual(80);
      expect(hubMetaDescription(group).length).toBeLessThanOrEqual(160);
    }
  });

  it("keeps generated sentences within research-only language", () => {
    const text = groups
      .flatMap((group) => [
        hubIntro(group),
        ...hubFaqs(group).flatMap((faq) => [faq.question, faq.answer]),
        ...group.listings.flatMap((listing) =>
          productFaqs(listing, group).flatMap((faq) => [faq.question, faq.answer]),
        ),
      ])
      .concat(
        categories.flatMap((category) =>
          categoryFaqs(
            category.name,
            groups.filter((group) => group.listings[0].categorySlug === category.slug),
          ).flatMap((faq) => [faq.question, faq.answer]),
        ),
      )
      .join("\n");
    for (const pattern of prohibited) expect(text).not.toMatch(pattern);
  });
});

describe("llms.txt", () => {
  const origin = "https://flintmarrow.com";
  const input: LlmsInput = {
    origin,
    listings,
    posts: [
      {
        slug: "peptide-certificate-of-analysis-coa-explained",
        title: "Peptide Certificate of Analysis (COA) Explained",
        excerpt: "How to read a COA.",
        body: [{ type: "h2", text: "What a COA shows" }, { type: "p", text: "Identity and purity for one lot." }],
      },
    ],
    faqs: [{ question: "Do you ship outside the US?", answer: "No." }],
    orderMode: "whatsapp",
    generatedOn: "2026-09-26",
  };

  it("follows the llms.txt layout with absolute site links", () => {
    const text = buildLlmsText(input);
    const lines = text.split("\n");
    expect(lines[0]).toBe("# Flintmarrow");
    expect(lines[2]).toMatch(/^> Flintmarrow lists research-use peptides/u);
    for (const heading of ["## Catalog", "## Materials", "## Guides", "## Policies", "## Optional"]) {
      expect(lines).toContain(heading);
    }
    const links = [...text.matchAll(/\]\((https?:[^)]+)\)/gu)].map((match) => match[1]);
    expect(links.length).toBeGreaterThan(90);
    for (const link of links) expect(new URL(link).origin).toBe(origin);
    expect(text).toContain(`(${origin}/research-materials/tirzepatide)`);
    expect(text).toContain(`${listings.length} published presentations`);
  });

  it("lists every presentation with price, per-vial figure and availability in full", () => {
    const text = buildLlmsFullText(input);
    expect(text).toContain("product code TR5, $30.00 per box ($3.00 per vial, $0.600 per mg), available.");
    expect(text).toContain("#### What a COA shows");
    expect(text).toContain("**Do you ship outside the US?**");
    for (const pattern of prohibited) expect(text).not.toMatch(pattern);
  });

  it("describes the current ordering mode", () => {
    expect(buildLlmsText(input)).toContain("prefilled WhatsApp order");
    expect(buildLlmsText({ ...input, orderMode: "checkout" })).toContain("site checkout");
  });
});
