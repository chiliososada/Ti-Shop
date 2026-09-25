/**
 * Build src/data/supplier-catalog.json from the extracted supplier price list.
 *
 * Input:  src/data/supplier-price-list.json  (A:C + H, see scripts/extract-price-list.py)
 *         src/data/products.json             (legacy storefront catalog, used only to keep
 *                                             existing slugs / image files stable)
 * Output: src/data/supplier-catalog.json      (one storefront product per price-list row,
 *                                             duplicates merged, prices from column H)
 *         output/supplier-catalog-reconciliation.json (matched / new / retired / flags)
 *
 * The storefront must mirror the spreadsheet: every row is published exactly once
 * and its USD box price is the "<200 Boxes" tier (column H). Spelling is
 * normalised to the storefront's canonical product names; every judgement call on
 * an ambiguous row is recorded in `decisions` below and echoed to the report.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  expectedCategoryForProductName,
  type ProductCategorySlug,
} from "../src/data/product-category-taxonomy";

type PriceListRow = {
  row: number;
  code: string;
  name: string;
  specification: string;
  priceUsd: number;
};

type PriceList = {
  source: string;
  sheet: string;
  priceColumn: string;
  priceTier: string;
  notes: Array<{ row: number; text: string }>;
  products: PriceListRow[];
};

type LegacyProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  image: string;
  catalogNumber?: string | null;
};

export type SupplierCatalogEntry = {
  slug: string;
  /** Slug the product currently has in the database when it must be renamed. */
  previousSlug: string | null;
  title: string;
  family: string;
  strength: string;
  packCount: number;
  presentation: string;
  category: ProductCategorySlug;
  codes: string[];
  sourceRows: number[];
  priceUsd: number;
  available: boolean;
  image: string;
  shortDescription: string;
  description: string;
  legacySlug: string | null;
  matchedBy: "decision" | "code" | "name" | null;
};

type Decision = {
  /** Canonical product family (name without strength). */
  family?: string;
  /** Override the parsed strength, e.g. a unit typo in the sheet. */
  strength?: string;
  /** Reuse this existing storefront slug even if heuristics disagree. */
  legacySlug?: string;
  /** Rename the reused slug (the freed slug is then available to a new listing). */
  renameTo?: string;
  /** Force a specific slug for a brand-new product. */
  newSlug?: string;
  /** Never match the legacy product by catalog number. */
  blockCodeMatch?: boolean;
  /** Do not publish this row at all (compliance or business decision). */
  exclude?: boolean;
  reason: string;
};

const root = resolve(import.meta.dirname, "..");
const priceList = JSON.parse(
  readFileSync(resolve(root, "src/data/supplier-price-list.json"), "utf8"),
) as PriceList;
const legacyProducts = JSON.parse(
  readFileSync(resolve(root, "src/data/products.json"), "utf8"),
) as LegacyProduct[];

/** Spreadsheet spelling → canonical storefront family name. */
const aliases: Record<string, string> = {
  LL37: "LL-37",
  "ACE 031": "ACE-031",
  "BPC 157": "BPC-157",
  bronchogen: "Bronchogen",
  cerebrolysin: "Cerebrolysin",
  "TB500(Thymosin B4 Acetate)": "TB-500 (Thymosin B4 Acetate)",
  "CJC 1295 with DAC": "CJC-1295 with DAC",
  "CJC 1295 without DAC": "CJC-1295 without DAC",
  "CJC1295(without DAC)5mg+IPA5mg": "CJC-1295 No-DAC 5mg + Ipamorelin 5mg Blend",
  "BPC 5mg + TB 5mg": "BPC-157 5mg + TB-500 5mg Blend",
  "BPC 10mg + TB 10mg": "BPC-157 10mg + TB-500 10mg Blend",
  "Glow(TB10mg+BPC-15710mg+GHK50mg)":
    "GLOW Blend (TB-500 10mg + BPC-157 10mg + GHK-Cu 50mg)",
  "Glow70(BPC157 10mg+GHK-CU50mg+TB500 10mg)":
    "GLOW Blend (BPC-157 10mg + GHK-Cu 50mg + TB-500 10mg)",
  "(BPC157 10mg+GHK-CU50mg+TB500 10mg+kpv10mg)":
    "KLOW Blend (BPC-157 10mg + GHK-Cu 50mg + TB-500 10mg + KPV 10mg)",
  "cagrilintide 5mg+ Semaglutide5mg": "CagriSema 5mg + 5mg Blend",
  "GHK-CU": "GHK-Cu",
  "PEG MGF": "PEG-MGF",
  "FST 344": "Follistatin-344",
  "HGH 191AA(Somatropin)": "HGH 191AA (Somatropin)",
  "IGF-1LR3": "IGF-1 LR3",
  "L-carnitine 1200": "L-Carnitine 1200",
  "L-carnitine 600": "L-Carnitine 600",
  "Lipo-c": "Lipo-C",
  MK677: "MK-677",
  "Snap-8": "SNAP-8",
  "ARA 290": "ARA-290",
  "sermorelin Acetate": "Sermorelin Acetate",
  "Thymosin alpha-1": "Thymosin Alpha-1",
  "TB Frag": "TB Fragment",
  "bac.water": "Bacteriostatic Water",
  "Tesa10+ip5": "Tesamorelin 10mg + Ipamorelin 5mg Blend",
  "TSM10+IP5": "Tesamorelin 10mg + Ipamorelin 5mg Blend",
  "Selank+Semax": "Selank + Semax Blend",
  "SLU-PP-322": "SLU-PP-332",
  Survovidutide: "Survodutide",
};

/**
 * Row-level judgement calls. Keyed by spreadsheet row number; every entry is
 * surfaced in the reconciliation report so the owner can veto it.
 */
const decisions: Record<number, Decision> = {
  23: {
    legacySlug: "slu-pp-322",
    reason:
      "Sheet spells the compound SLU-PP-322; the storefront keeps the established name SLU-PP-332 (existing listing).",
  },
  24: {
    legacySlug: "slu-pp-332-10mg",
    reason: "Same SLU-PP-322 → SLU-PP-332 spelling correction, 10mg listing.",
  },
  31: {
    family: "5-Amino-1MQ",
    reason: "Sheet name '5-amino-5mg' = 5-Amino-1MQ 5mg (matches supplier code 5AM in the previous list).",
  },
  32: {
    family: "5-Amino-1MQ",
    reason:
      "Sheet name '10-amino-1mg' conflicts with the 10mg specification; treated as 5-Amino-1MQ 10mg (code 10AM), specification wins.",
  },
  33: {
    family: "5-Amino-1MQ",
    reason: "Sheet name '50-amino-50mg' = 5-Amino-1MQ 50mg (code 50AM).",
  },
  42: {
    blockCodeMatch: true,
    reason:
      "Code B12 is vitamin B-12 10mg in the sheet; the legacy listing with code B12 was 'Large Bottle 10ml' and is retired instead of reused.",
  },
  47: {
    newSlug: "glow-blend-bbg70",
    reason:
      "BBG70 and GLOW70 describe the same GLOW composition but the sheet prices them differently (USD 194 vs 196), so both are published as separate listings.",
  },
  69: {
    family: "CagriSema 10mg + 10mg Blend",
    reason:
      "Merged name cell says 5mg + 5mg while the specification is 20mg; the previous supplier list identified CS20 as Cagrilintide 10mg + Semaglutide 10mg.",
  },
  70: {
    family: "CagriSema 2.5mg + 2.5mg Blend",
    reason:
      "Merged name cell says 5mg + 5mg while the specification is 5mg; the previous supplier list identified CS5 as Cagrilintide 2.5mg + Semaglutide 2.5mg.",
  },
  88: {
    family: "HGH Fragment 176-191",
    reason:
      "Product name cell is empty; codes FR10/Frag10 matched HGH Fragment 176-191 in the previous supplier list. The legacy '10iu' listing is retired because the sheet specifies 10mg.",
  },
  89: { family: "HGH Fragment 176-191", reason: "Empty name cell; FR12/Frag12 = HGH Fragment 176-191 12mg." },
  90: { family: "HGH Fragment 176-191", reason: "Empty name cell; FR15/Frag15 = HGH Fragment 176-191 15mg." },
  91: { family: "HGH Fragment 176-191", reason: "Empty name cell; FR2/Frag2 = HGH Fragment 176-191 2mg." },
  92: { family: "HGH Fragment 176-191", reason: "Empty name cell; FR5/Frag5 = HGH Fragment 176-191 5mg." },
  108: {
    strength: "24iu",
    reason:
      "Sheet specification says 24mg for HGH; every other HGH row and the previous list use IU (code H24 = 24iu). Published as 24iu — confirm with the supplier.",
  },
  126: {
    legacySlug: "l-carnitine-1200mg",
    reason:
      "Sheet lists L-carnitine 1200 as a 10ml vial; the existing listing URL (…-1200mg) is kept, the title now follows the sheet.",
  },
  128: {
    legacySlug: "l-carnitine-600mg",
    reason: "Same as row 126 for L-carnitine 600.",
  },
  127: {
    legacySlug: "mic-lipo-c-with-b12",
    reason: "Code LC216 was the 'MIC Lipo-C with B12' listing; the sheet now calls it Lipo-C. URL kept, title follows the sheet.",
  },
  135: { family: "MOTS-c", reason: "Sheet name cell says GHK-CU but codes MS10/MS20/MS40 are MOTS-c (previous list) and GHK-Cu is already listed under CU50/CU100." },
  136: { family: "MOTS-c", reason: "See row 135." },
  137: { family: "MOTS-c", reason: "See row 135." },
  147: {
    family: "P21",
    reason:
      "Code P210 suggests 10mg but the specification column says 5mg; the specification wins and the legacy 'P21 (P021) 10mg' listing is retired.",
  },
  162: {
    legacySlug: "sermorelin-acetate-10mg",
    renameTo: "sermorelin-10mg",
    reason:
      "The sheet lists 'Sermorelin' (SMO) and 'sermorelin Acetate' (SML) as different products. The existing SMO10 record keeps its cost data but moves to /products/sermorelin-10mg; the Acetate URL is taken over by the new SML10 listing, whose title matches what that URL always showed.",
  },
  163: {
    legacySlug: "sermorelin-acetate-5mg",
    renameTo: "sermorelin-5mg",
    reason: "See row 162 (5mg).",
  },
  180: {
    exclude: true,
    reason:
      "Bacteriostatic water (WA10) is not listed. FDA's 2026 warning letters to research-peptide sellers cite reconstitution supplies sold alongside peptides as evidence of human-use intent.",
  },
  181: {
    exclude: true,
    reason: "Bacteriostatic water (WA3) is not listed; see row 180.",
  },
  164: {
    newSlug: "sermorelin-acetate-5mg",
    reason: "SML5 'sermorelin Acetate' 5mg is a new listing; it takes the URL freed by the row 163 rename.",
  },
  165: {
    newSlug: "sermorelin-acetate-10mg",
    reason: "SML10 'sermorelin Acetate' 10mg is a new listing; it takes the URL freed by the row 162 rename.",
  },
  166: {
    reason: "Sheet spells the compound 'Survovidutide'; published as Survodutide.",
  },
};

/** Categories for families the taxonomy does not list by name. */
const categoryOverrides: Record<string, ProductCategorySlug> = {
  "ACTH 1-39": "growth-energy",
  Adipotide: "metabolic",
  "B-12": "metabolic",
  "TB Fragment": "muscle-growth",
  Melatonin: "growth-energy",
  Matrixyl: "skin-aging",
  Sermorelin: "growth-energy",
  "Thymosin Alpha-1": "antibacterial",
};

/** Blend families that already carry their component doses in the name. */
const titleCarriesDose = (family: string) =>
  /\d(?:mg|mcg|iu|ml)\s*\+/iu.test(family) && !family.includes("(");

const unavailableRows = new Set(
  priceList.notes
    .filter((note) => /out of stock/iu.test(note.text))
    .map((note) => note.row),
);

function parseSpecification(specification: string) {
  const match =
    /^([\d.]+)\s*(mg|mcg|iu|ml)\s*\*\s*(\d+)\s*vials$/iu.exec(specification);
  if (!match) throw new Error(`Unrecognised specification: ${specification}`);
  return {
    amount: match[1],
    unit: match[2].toLowerCase(),
    packCount: Number(match[3]),
  };
}

/** Compare strengths across unit spellings (0.1mg == 100mcg). */
function strengthKey(strength: string): string {
  const match = /^([\d.]+)(mg|mcg|iu|ml)$/iu.exec(strength);
  if (!match) return strength.toLowerCase();
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "mg") return `${Math.round(amount * 1_000_000)}ug`;
  if (unit === "mcg") return `${Math.round(amount * 1_000)}ug`;
  return `${amount}${unit}`;
}

function legacyStrength(name: string): string | null {
  return /\s(\d+(?:\.\d+)?(?:mcg|mg|ml|iu))$/iu.exec(name)?.[1] ?? null;
}

function equivalent(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\(thymosinb4acetate\)|191aa\(somatropin\)/g, "")
    .replace(/^ftpp\(adipotide\)/, "adipotide")
    .replace(/^ara-290\(cibinetide\)/, "ara-290")
    .replace(/^p21\(p021\)/, "p21")
    .replace(/^(ghrp-[26]|oxytocin|gonadorelin|hexarelin)acetate/, "$1")
    .replace(/^thymosinα-1/, "thymosinalpha-1")
    .replace(/^cjc-1295no-dac5mg/, "cjc-12955mg");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/α/g, "alpha")
    .replace(/\+/g, "plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const legacyByCode = new Map<string, LegacyProduct[]>();
const legacyByName = new Map<string, LegacyProduct>();
const legacyBySlug = new Map<string, LegacyProduct>();
for (const product of legacyProducts) {
  legacyBySlug.set(product.id, product);
  legacyByName.set(equivalent(product.name), product);
  const code = product.catalogNumber?.trim().toUpperCase();
  if (code) {
    const list = legacyByCode.get(code) ?? [];
    list.push(product);
    legacyByCode.set(code, list);
  }
}

type Draft = Omit<SupplierCatalogEntry, "slug" | "previousSlug" | "image" | "shortDescription" | "description" | "legacySlug" | "matchedBy"> & {
  decision: Decision | undefined;
};

const drafts: Draft[] = [];
const excludedRows: Array<{ row: number; code: string; name: string; reason: string }> = [];
for (const row of priceList.products) {
  const decision = decisions[row.row];
  if (decision?.exclude) {
    excludedRows.push({ row: row.row, code: row.code, name: row.name, reason: decision.reason });
    continue;
  }
  const parsed = parseSpecification(row.specification);
  const sheetName = row.name.trim();
  const family = decision?.family ?? aliases[sheetName] ?? sheetName;
  if (!family) throw new Error(`Row ${row.row} (${row.code}) has no product name and no decision`);
  const strength = decision?.strength ?? `${parsed.amount}${parsed.unit}`;
  const title = titleCarriesDose(family) ? family : `${family} ${strength}`;
  // Keep the sheet's code verbatim (e.g. "FR10/Frag10"); the slash-separated
  // parts are only alternative spellings used for matching legacy listings.
  const codes = [row.code.trim()];

  const duplicate = drafts.find(
    (draft) =>
      draft.family === family &&
      draft.strength === strength &&
      draft.packCount === parsed.packCount,
  );
  if (duplicate) {
    if (duplicate.priceUsd !== row.priceUsd) {
      throw new Error(
        `Rows ${duplicate.sourceRows.join(",")} and ${row.row} share ${title} but disagree on price (${duplicate.priceUsd} vs ${row.priceUsd}); add a decision to separate them.`,
      );
    }
    duplicate.codes.push(...codes.filter((code) => !duplicate.codes.includes(code)));
    duplicate.sourceRows.push(row.row);
    continue;
  }

  const category =
    categoryOverrides[family] ?? expectedCategoryForProductName(family);
  if (!category) throw new Error(`Row ${row.row}: no category for family "${family}"`);

  drafts.push({
    title,
    family,
    strength,
    packCount: parsed.packCount,
    presentation: `${strength} per vial, ${parsed.packCount} vials/box`,
    category,
    codes,
    sourceRows: [row.row],
    priceUsd: row.priceUsd,
    available: !unavailableRows.has(row.row),
    decision,
  });
}

const usedLegacy = new Set<string>();
const flags: Array<{ rows: number[]; codes: string[]; title: string; reason: string }> = [];
const strengthMismatches: Array<{ rows: number[]; title: string; legacy: string }> = [];
const entries: SupplierCatalogEntry[] = [];

for (const draft of drafts) {
  const { decision, ...rest } = draft;
  let legacy: LegacyProduct | undefined;
  let matchedBy: SupplierCatalogEntry["matchedBy"] = null;

  if (decision?.legacySlug) {
    legacy = legacyBySlug.get(decision.legacySlug);
    if (!legacy) throw new Error(`Decision for rows ${draft.sourceRows} names unknown slug ${decision.legacySlug}`);
    matchedBy = "decision";
  } else if (!decision?.newSlug) {
    if (!decision?.blockCodeMatch) {
      const codeSpellings = draft.codes.flatMap((code) => [code, ...code.split("/")]);
      for (const code of codeSpellings.map((code) => code.trim()).filter(Boolean)) {
        const candidates = legacyByCode.get(code.toUpperCase()) ?? [];
        if (candidates.length === 1) {
          legacy = candidates[0];
          matchedBy = "code";
          break;
        }
      }
    }
    if (!legacy) {
      legacy = legacyByName.get(equivalent(draft.title));
      if (legacy) matchedBy = "name";
    }
    if (legacy) {
      const previous = legacyStrength(legacy.name);
      if (previous && strengthKey(previous) !== strengthKey(draft.strength)) {
        strengthMismatches.push({ rows: draft.sourceRows, title: draft.title, legacy: legacy.name });
        legacy = undefined;
        matchedBy = null;
      }
    }
  }

  if (legacy && usedLegacy.has(legacy.id)) {
    throw new Error(`Legacy product ${legacy.id} matched twice (rows ${draft.sourceRows})`);
  }
  if (legacy) usedLegacy.add(legacy.id);

  const slug = decision?.renameTo ?? decision?.newSlug ?? legacy?.id ?? slugify(draft.title);
  const previousSlug = decision?.renameTo && legacy ? legacy.id : null;
  const image = legacy && !previousSlug ? legacy.image : `/products/${slug}.jpg`;
  const codeList = draft.codes.join(" / ");
  const availabilityNote = draft.available
    ? ""
    : " Marked temporarily out of stock on the current supplier list.";

  entries.push({
    slug,
    previousSlug,
    ...rest,
    image,
    shortDescription: `${draft.title} catalog listing. Supplier presentation: ${draft.presentation}. Product code: ${codeList}.`,
    description:
      `${draft.title} catalog listing for laboratory procurement. Supplier presentation: ${draft.presentation}; the listed price is per box of ${draft.packCount} vials. ` +
      `Reference product code ${codeList} when ordering on WhatsApp.${availabilityNote} ` +
      "Confirm current composition, documentation and handling instructions before ordering.",
    legacySlug: legacy?.id ?? null,
    matchedBy,
  });

  if (decision) {
    flags.push({ rows: draft.sourceRows, codes: draft.codes, title: draft.title, reason: decision.reason });
  }
}

// Integrity checks the storefront relies on.
const slugs = new Set<string>();
const titles = new Set<string>();
const images = new Set<string>();
const representedRows = new Set<number>();
for (const entry of entries) {
  if (slugs.has(entry.slug)) throw new Error(`Duplicate slug ${entry.slug}`);
  if (titles.has(entry.title)) throw new Error(`Duplicate title ${entry.title}`);
  if (images.has(entry.image)) throw new Error(`Duplicate image ${entry.image}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.slug)) throw new Error(`Invalid slug ${entry.slug}`);
  slugs.add(entry.slug);
  titles.add(entry.title);
  images.add(entry.image);
  for (const row of entry.sourceRows) {
    if (representedRows.has(row)) throw new Error(`Row ${row} represented twice`);
    representedRows.add(row);
  }
}
if (representedRows.size + excludedRows.length !== priceList.products.length) {
  throw new Error(
    `Represented ${representedRows.size} + excluded ${excludedRows.length} rows, expected ${priceList.products.length}`,
  );
}
const freedSlugs = new Set(entries.flatMap((entry) => (entry.previousSlug ? [entry.previousSlug] : [])));
for (const entry of entries) {
  if (entry.previousSlug && legacyBySlug.has(entry.slug)) {
    throw new Error(`Rename target ${entry.slug} already exists as a legacy slug`);
  }
  if (!entry.legacySlug && legacyBySlug.has(entry.slug) && !freedSlugs.has(entry.slug)) {
    throw new Error(`New product ${entry.slug} collides with an existing legacy slug`);
  }
}

const retired = legacyProducts
  .filter((product) => !usedLegacy.has(product.id))
  .map((product) => ({ slug: product.id, name: product.name, code: product.catalogNumber ?? null }));
const priceChanges = entries
  .filter((entry) => entry.legacySlug)
  .map((entry) => ({
    slug: entry.slug,
    title: entry.title,
    previousUsd: legacyBySlug.get(entry.legacySlug!)!.price,
    priceUsd: entry.priceUsd,
  }))
  .filter((change) => change.previousUsd !== change.priceUsd);

mkdirSync(resolve(root, "output"), { recursive: true });
writeFileSync(
  resolve(root, "src/data/supplier-catalog.json"),
  JSON.stringify(
    {
      source: priceList.source,
      sheet: priceList.sheet,
      priceColumn: priceList.priceColumn,
      priceTier: priceList.priceTier,
      currency: "USD",
      priceUnit: "box",
      generatedFrom: "scripts/build-supplier-catalog.ts",
      excludedRows,
      products: entries,
    },
    null,
    2,
  ) + "\n",
);
const reconciliation = {
  sourceRows: priceList.products.length,
  published: entries.length,
  excluded: excludedRows,
  merged: entries
    .filter((entry) => entry.sourceRows.length > 1)
    .map((entry) => ({ title: entry.title, rows: entry.sourceRows, codes: entry.codes })),
  matched: {
    byCode: entries.filter((entry) => entry.matchedBy === "code").length,
    byName: entries.filter((entry) => entry.matchedBy === "name").length,
    byDecision: entries.filter((entry) => entry.matchedBy === "decision").length,
  },
  added: entries
    .filter((entry) => !entry.legacySlug)
    .map((entry) => ({ slug: entry.slug, title: entry.title, codes: entry.codes, priceUsd: entry.priceUsd })),
  renamed: entries
    .filter((entry) => entry.previousSlug)
    .map((entry) => ({ from: entry.previousSlug, to: entry.slug, title: entry.title })),
  retitled: entries
    .filter((entry) => entry.legacySlug && legacyBySlug.get(entry.legacySlug)!.name !== entry.title)
    .map((entry) => ({ slug: entry.slug, from: legacyBySlug.get(entry.legacySlug!)!.name, to: entry.title })),
  retired,
  unavailable: entries.filter((entry) => !entry.available).map((entry) => entry.title),
  strengthMismatchesTreatedAsNew: strengthMismatches,
  priceChanges,
  flags,
  sheetNotes: priceList.notes,
};
writeFileSync(
  resolve(root, "output/supplier-catalog-reconciliation.json"),
  JSON.stringify(reconciliation, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      sourceRows: reconciliation.sourceRows,
      published: reconciliation.published,
      matched: reconciliation.matched,
      added: reconciliation.added.length,
      renamed: reconciliation.renamed.length,
      retitled: reconciliation.retitled.length,
      retired: reconciliation.retired.length,
      unavailable: reconciliation.unavailable.length,
      priceChanges: reconciliation.priceChanges.length,
      flags: reconciliation.flags.length,
    },
    null,
    2,
  ),
);
