import materialFacts from "@/data/material-facts.json";
import { compareStrengths } from "@/lib/catalog-specifications";

/**
 * Material hubs: one page per material with at least two published strengths.
 * Every number on a hub (strengths, codes, prices, availability) comes from
 * the published catalog, so the answer-ready sentences below stay true after
 * each price-list sync. The short identity labels in material-facts.json are
 * exported from the reviewed PureForm material profiles (2026-09-24).
 */
export type MaterialNoun =
  | "Research Peptide"
  | "Peptide Blend"
  | "Research Protein"
  | "Research Compound"
  | "Research Material"
  | "Laboratory Solution";

export type MaterialFacts = {
  name: string;
  noun: MaterialNoun;
  materialType: string;
  classification: string;
  aliases: readonly string[];
  licensedActive: boolean;
};

export type MaterialListing = {
  slug: string;
  title: string;
  family: string;
  strength: string;
  codes: readonly string[];
  packCount: number;
  categorySlug: string | null;
  categoryName: string | null;
  /** USD cents per box, or null when no current price is published. */
  priceMinor: number | null;
  available: boolean;
  updatedAt: string | null;
  image: string | null;
};

export type MaterialGroup = {
  slug: string;
  family: string;
  facts: MaterialFacts | null;
  listings: MaterialListing[];
};

export type MaterialFaq = { question: string; answer: string };

export const HUB_MIN_LISTINGS = 2;

const facts = materialFacts as Record<string, MaterialFacts>;

export function getMaterialFacts(family: string): MaterialFacts | null {
  return facts[family] ?? null;
}

export function materialSlug(family: string) {
  return family
    .toLowerCase()
    .replace(/α/gu, "alpha")
    .replace(/\+/gu, " plus ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function groupMaterials(listings: readonly MaterialListing[]): MaterialGroup[] {
  const byFamily = new Map<string, MaterialListing[]>();
  for (const listing of listings) {
    byFamily.set(listing.family, [...(byFamily.get(listing.family) ?? []), listing]);
  }
  return [...byFamily.entries()]
    .map(([family, items]) => ({
      slug: materialSlug(family),
      family,
      facts: getMaterialFacts(family),
      listings: items.sort((a, b) => compareStrengths(a.strength, b.strength)),
    }))
    .sort((a, b) => a.family.localeCompare(b.family, "en", { numeric: true }));
}

export function hasHub(group: MaterialGroup) {
  return group.listings.length >= HUB_MIN_LISTINGS;
}

export function hubPath(group: MaterialGroup) {
  return `/research-materials/${group.slug}`;
}

/** The storefront's own material name (several families can share one profile). */
export function displayName(group: MaterialGroup) {
  return group.family;
}

/** Acronyms read as words, which take "a" whatever their first letter. */
const WORD_ACRONYMS = ["SNARE", "FOXO4", "GLOW", "TREK"];
/** Names that keep their capital in running text. */
const PROPER_NOUNS = new Set(["Semax"]);

/**
 * "a dual GIP and GLP-1 receptor agonist", "an AMPK activator": the
 * classification label as a noun phrase with its indefinite article.
 */
export function classificationPhrase(classification: string) {
  const first = classification.split(/[\s(,/]/u)[0];
  const acronym = /^[A-Z]{2}/u.test(first) || /[A-Z]/u.test(first.slice(1));
  const phrase =
    !acronym && !PROPER_NOUNS.has(first) && /^[A-Z]/u.test(first)
      ? `${classification[0].toLowerCase()}${classification.slice(1)}`
      : classification;
  let article: "a" | "an";
  if (phrase.startsWith("α")) article = "an";
  else if (phrase.startsWith("μ")) article = "a";
  else if (acronym) {
    article =
      !WORD_ACRONYMS.some((word) => first.startsWith(word)) && /^[AEFHILMNORSX]/u.test(first)
        ? "an"
        : "a";
  } else article = /^[aeiou]/iu.test(phrase) ? "an" : "a";
  return `${article} ${phrase}`;
}

/** "BPC-157 Research Peptide", but "GLOW Blend" rather than "GLOW Blend Peptide Blend". */
export function nounName(group: MaterialGroup) {
  const name = displayName(group);
  const noun = group.facts?.noun;
  if (!noun || (noun === "Peptide Blend" && /\bblend\b/iu.test(name))) return name;
  return `${name} ${noun}`;
}

export function formatUsd(minor: number) {
  const cents = Math.round(minor);
  return `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function formatUsdFraction(minor: number) {
  const dollars = minor / 100;
  return `$${dollars.toFixed(dollars >= 1 ? 2 : 3)}`;
}

function strengthAmount(strength: string) {
  const match = /^([\d.]+)\s*(mcg|mg|iu|ml)$/iu.exec(strength);
  if (!match) return null;
  const unit = match[2].toLowerCase();
  return { amount: Number(match[1]), unit, mg: unit === "mcg" ? Number(match[1]) / 1000 : unit === "mg" ? Number(match[1]) : null };
}

export function pricePerVialMinor(listing: MaterialListing) {
  return listing.priceMinor === null ? null : listing.priceMinor / listing.packCount;
}

/**
 * Price per mg of material, only for single materials measured in mg or mcg.
 * A blend's stated total mixes components, so a per-mg price would mislead.
 */
export function pricePerMgMinor(listing: MaterialListing, group: MaterialGroup) {
  if (listing.priceMinor === null || group.facts?.noun === "Peptide Blend") return null;
  // "A + B" names a combination; a trailing "+" (NAD+) is part of the name.
  if (/\s\+\s|\bblend\b/iu.test(group.family)) return null;
  const parsed = strengthAmount(listing.strength);
  if (!parsed?.mg) return null;
  return listing.priceMinor / (parsed.mg * listing.packCount);
}

export function formatPerVial(listing: MaterialListing) {
  const value = pricePerVialMinor(listing);
  return value === null ? null : formatUsdFraction(value);
}

export function formatPerMg(listing: MaterialListing, group: MaterialGroup) {
  const value = pricePerMgMinor(listing, group);
  return value === null ? null : formatUsdFraction(value);
}

function priced(group: MaterialGroup) {
  return group.listings.filter(
    (listing): listing is MaterialListing & { priceMinor: number } => listing.priceMinor !== null,
  );
}

function list(items: readonly string[]) {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function strengthRange(group: MaterialGroup) {
  const first = group.listings[0]?.strength;
  const last = group.listings[group.listings.length - 1]?.strength;
  if (!first) return "";
  return first === last ? first : `${first}–${last}`;
}

function packText(group: MaterialGroup) {
  const packs = [...new Set(group.listings.map((listing) => listing.packCount))];
  return packs.length === 1 ? `${packs[0]} vials per box` : "box quantities as listed";
}

/** "10 vials", for sentences that already say "box". */
function vialsText(group: MaterialGroup) {
  const packs = [...new Set(group.listings.map((listing) => listing.packCount))];
  return packs.length === 1 ? `${packs[0]} vials` : "the listed number of vials";
}

/** ISO date of the newest listing update (price, stock or text) in the group. */
export function pricesCheckedOn(listings: readonly MaterialListing[]) {
  const dates = listings.map((listing) => listing.updatedAt).filter((date): date is string => Boolean(date));
  return dates.length ? dates.sort().at(-1)!.slice(0, 10) : null;
}

export function formatDate(isoDate: string) {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function priceRangeSentence(group: MaterialGroup) {
  const items = priced(group);
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => a.priceMinor - b.priceMinor);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  return low.priceMinor === high.priceMinor
    ? `Each box is priced at ${formatUsd(low.priceMinor)} (USD).`
    : `Box prices run from ${formatUsd(low.priceMinor)} for ${low.strength} to ${formatUsd(high.priceMinor)} for ${high.strength} (USD).`;
}

function unavailable(group: MaterialGroup) {
  return group.listings.filter((listing) => !listing.available);
}

/** The answer-first lead sentence of a hub page. */
export function hubIntro(group: MaterialGroup) {
  const name = displayName(group);
  const count = group.listings.length;
  const parts = [
    ...(group.facts ? [`${name} is ${classificationPhrase(group.facts.classification)}.`] : []),
    count === 1
      ? `Flintmarrow lists it at ${group.listings[0].strength} per vial, packed ${packText(group)}.`
      : `Flintmarrow lists it in ${count} strengths, from ${strengthRange(group).replace("–", " to ")} per vial, packed ${packText(group)}.`,
  ];
  const range = priceRangeSentence(group);
  if (range) parts.push(range);
  const out = unavailable(group);
  if (out.length) {
    parts.push(`${list(out.map((listing) => listing.strength))} ${out.length === 1 ? "is" : "are"} temporarily unavailable.`);
  }
  return parts.join(" ");
}

export function hubTitle(group: MaterialGroup) {
  return `${displayName(group)} ${strengthRange(group)}: Strengths & Box Prices`;
}

export function hubMetaDescription(group: MaterialGroup) {
  const items = priced(group);
  const low = items.length ? Math.min(...items.map((item) => item.priceMinor)) : null;
  const base = `Compare ${group.listings.length} ${displayName(group)} strengths (${strengthRange(group)} per vial, ${packText(group)})`;
  const withPrice = low === null ? `${base} with product codes and availability.` : `${base} from ${formatUsd(low)} per box, with product codes and availability.`;
  return withPrice.length <= 160 ? withPrice : `${base}.`;
}

/** Strength with the lowest price per mg, when per-mg prices are comparable. */
function lowestPerMg(group: MaterialGroup) {
  const rows = group.listings
    .map((listing) => ({ listing, value: pricePerMgMinor(listing, group) }))
    .filter((row): row is { listing: MaterialListing; value: number } => row.value !== null);
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => a.value - b.value);
  return { lowest: sorted[0], highest: sorted[sorted.length - 1] };
}

const ORDERING =
  "Open the product page for the strength you need and use its ordering option. Quote the product code in any message so the exact presentation is identified.";

export function hubFaqs(group: MaterialGroup): MaterialFaq[] {
  const name = displayName(group);
  const listed = group.listings
    .map((listing) => `${listing.strength} (${listing.codes.join(" / ")}${listing.priceMinor === null ? "" : `, ${formatUsd(listing.priceMinor)} per box`})`)
    .join(", ");
  const faqs: MaterialFaq[] = [
    {
      question: `Which ${name} strengths does Flintmarrow list?`,
      answer: `${group.listings.length} strengths are listed: ${listed}. Each strength has its own product page and product code.`,
    },
  ];
  const range = priceRangeSentence(group);
  if (range) {
    const perVial = priced(group).map((listing) => pricePerVialMinor(listing)!);
    faqs.push({
      question: `How much does ${name} cost?`,
      answer: `${range} A box holds ${vialsText(group)}, which works out to ${formatUsdFraction(Math.min(...perVial))}–${formatUsdFraction(Math.max(...perVial))} per vial. Prices are for laboratory research supply and are confirmed with each order.`,
    });
  }
  const perMg = lowestPerMg(group);
  if (perMg && perMg.lowest.listing.slug !== perMg.highest.listing.slug) {
    faqs.push({
      question: `Which ${name} strength has the lowest price per mg?`,
      answer: `${perMg.lowest.listing.strength} has the lowest price per mg of material, about ${formatUsdFraction(perMg.lowest.value)} per mg, against ${formatUsdFraction(perMg.highest.value)} per mg for ${perMg.highest.listing.strength}. The right strength depends on the amount per vial your protocol calls for.`,
    });
  }
  faqs.push(
    {
      question: `What is in one ${name} box?`,
      answer: `One box contains ${vialsText(group)} of the same strength. Listed prices are per box and order quantities are counted in boxes.`,
    },
    {
      question: `How do I order ${name}?`,
      answer: ORDERING,
    },
  );
  const out = unavailable(group);
  if (out.length) {
    faqs.push({
      question: `Are all ${name} strengths available?`,
      answer: `${list(out.map((listing) => listing.strength))} ${out.length === 1 ? "is" : "are"} temporarily unavailable; the other listed strengths can be ordered. Availability is confirmed for each order.`,
    });
  }
  return faqs;
}

/** Questions answered on a single product page. */
export function productFaqs(listing: MaterialListing, group: MaterialGroup): MaterialFaq[] {
  const faqs: MaterialFaq[] = [];
  if (listing.priceMinor !== null) {
    const perMg = formatPerMg(listing, group);
    faqs.push({
      question: `What is the price of ${listing.title}?`,
      answer: `${formatUsd(listing.priceMinor)} (USD) per box of ${listing.packCount} vials, about ${formatPerVial(listing)} per vial${perMg ? ` or ${perMg} per mg` : ""}. The price is confirmed with each order.`,
    });
  }
  faqs.push({
    question: `What is the product code for ${listing.title}?`,
    answer: `${listing.codes.join(" / ")}. Quote it when you order so the ${listing.strength} presentation is identified.`,
  });
  if (group.listings.length > 1) {
    const others = group.listings.filter((item) => item.slug !== listing.slug).map((item) => item.strength);
    faqs.push({
      question: `Which other ${displayName(group)} strengths are listed?`,
      answer: `${list(others)} per vial. All ${group.listings.length} strengths, with prices and codes, are compared on the ${displayName(group)} overview page.`,
    });
  }
  faqs.push({
    question: `Is ${listing.title} available?`,
    answer: listing.available
      ? "It is listed as available. Current availability and lot documents are confirmed for each order."
      : "It is temporarily unavailable. Other listed strengths may be available; availability is confirmed for each order.",
  });
  return faqs;
}

/** Catalog questions for a research-area category page. */
export function categoryFaqs(categoryName: string, groups: readonly MaterialGroup[]): MaterialFaq[] {
  if (!groups.length) return [];
  const listings = groups.flatMap((group) => group.listings);
  const named = groups
    .map((group) => {
      const prices = priced(group).map((item) => item.priceMinor);
      const low = prices.length ? Math.min(...prices) : null;
      const price =
        low === null ? "" : `, ${low === Math.max(...prices) ? "" : "from "}${formatUsd(low)}`;
      return `${displayName(group)} (${group.listings.length} ${group.listings.length === 1 ? "strength" : "strengths"}${price})`;
    })
    .join(", ");
  return [
    {
      question: `Which research materials are listed in ${categoryName}?`,
      answer: `${groups.length} ${groups.length === 1 ? "material is" : "materials are"} listed across ${listings.length} ${listings.length === 1 ? "presentation" : "presentations"}: ${named}. Prices are USD per box.`,
    },
    {
      question: `How are ${categoryName} prices shown?`,
      answer:
        "Every price is the USD price per box of the listed strength. The product page shows the amount per vial, the vials per box, the product code and current availability.",
    },
    {
      question: "How do I order several materials at once?",
      answer: `${ORDERING} Several strengths and materials can be combined in one order.`,
    },
  ];
}
