import supplierCatalog from "@/data/supplier-catalog.json";

/**
 * Presentation facts from the reviewed supplier price list (family, strength,
 * pack size, product codes). Publication state and prices always come from the
 * database; this file only groups published listings into material families.
 */
export type CatalogSpecification = {
  slug: string;
  family: string;
  strength: string;
  packCount: number;
  codes: string[];
};

const specifications: CatalogSpecification[] = supplierCatalog.products.map(
  (product) => ({
    slug: product.slug,
    family: product.family,
    strength: product.strength,
    packCount: product.packCount,
    codes: product.codes,
  }),
);

const bySlug = new Map(specifications.map((spec) => [spec.slug, spec]));

export const catalogFamilyCount = new Set(
  specifications.map((spec) => spec.family),
).size;

const UNIT_ORDER: Record<string, number> = { mcg: 0, mg: 1, iu: 2, ml: 3 };

function strengthParts(strength: string) {
  const match = /^([\d.]+)\s*(mcg|mg|iu|ml)$/iu.exec(strength);
  if (!match) return { unit: 9, amount: Number.POSITIVE_INFINITY };
  const unit = match[2].toLowerCase();
  const amount = Number(match[1]) * (unit === "mcg" ? 0.001 : 1);
  return { unit: UNIT_ORDER[unit === "mcg" ? "mg" : unit] ?? 9, amount };
}

/** Sort presentations of one family by unit family, then ascending amount. */
export function compareStrengths(left: string, right: string) {
  const a = strengthParts(left);
  const b = strengthParts(right);
  return a.unit - b.unit || a.amount - b.amount || left.localeCompare(right);
}

export function getCatalogSpecification(slug: string) {
  return bySlug.get(slug) ?? null;
}

/** Every listed presentation of the same material, including the given slug. */
export function getSiblingPresentations(slug: string) {
  const product = bySlug.get(slug);
  if (!product) return [];
  return specifications
    .filter((candidate) => candidate.family === product.family)
    .sort((a, b) => compareStrengths(a.strength, b.strength));
}

/** Fallback family name for listings the price list does not describe. */
export function familyFromTitle(title: string) {
  return title.replace(/\s\d+(?:\.\d+)?(?:mcg|mg|ml|iu)$/iu, "").trim();
}

/** Material family names described by the reviewed price list. */
export const catalogFamilies: readonly string[] = [
  ...new Set(specifications.map((spec) => spec.family)),
];

/** Every listed presentation of one material family, by ascending strength. */
export function getFamilyPresentations(family: string) {
  return specifications
    .filter((candidate) => candidate.family === family)
    .sort((a, b) => compareStrengths(a.strength, b.strength));
}
