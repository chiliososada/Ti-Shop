import { categories } from "@/data/categories";
import { company } from "@/data/company";
import type { PublicBlogBlockDto } from "@/domain/content";
import type { OrderMode } from "@/domain/order-mode";
import {
  formatDate,
  formatPerMg,
  formatPerVial,
  formatUsd,
  groupMaterials,
  hasHub,
  hubFaqs,
  hubIntro,
  hubPath,
  nounName,
  pricesCheckedOn,
  productFaqs,
  strengthRange,
  type MaterialGroup,
  type MaterialListing,
} from "@/lib/material-hubs";

/**
 * /llms.txt and /llms-full.txt (https://llmstxt.org): a plain-markdown map of
 * the catalog for AI assistants and answer engines. Every listing, price and
 * availability comes from the database at request time.
 */
export type LlmsBlogPost = {
  slug: string;
  title: string;
  excerpt: string | null;
  updatedAt?: string | null;
  body?: readonly PublicBlogBlockDto[];
  takeaways?: readonly string[];
  faqs?: readonly { question: string; answer: string }[];
};

export type LlmsInput = {
  origin: string;
  listings: readonly MaterialListing[];
  posts: readonly LlmsBlogPost[];
  faqs: readonly { question: string; answer: string }[];
  orderMode: OrderMode;
  /** ISO date the file was generated. */
  generatedOn: string;
};

const POLICY_PAGES = [
  ["Research use policy", "/research-use", "Materials are supplied for laboratory research only."],
  ["Shipping", "/shipping", "Supported US destinations and shipping terms."],
  ["Returns", "/returns", "Return and replacement conditions."],
  ["Payment policy", "/payment-policy", "Accepted payment methods and when payment is due."],
  ["Terms", "/terms", "Terms of sale and use."],
  ["Privacy", "/privacy", "How order and contact data is handled."],
  ["FAQ", "/faq", "Ordering, documents, shipping and research-use questions."],
  ["Contact", "/contact", `Order and product questions (${company.email}).`],
  ["About", "/about", `About ${company.name}.`],
] as const;

function url(origin: string, path: string) {
  return new URL(path, `${origin}/`).toString();
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function materialHref(group: MaterialGroup) {
  return hasHub(group) ? hubPath(group) : `/products/${group.listings[0].slug}`;
}

function priceSpan(listings: readonly MaterialListing[]) {
  const prices = listings
    .map((listing) => listing.priceMinor)
    .filter((price): price is number => price !== null);
  if (!prices.length) return null;
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  return low === high ? formatUsd(low) : `${formatUsd(low)}–${formatUsd(high)}`;
}

function orderingFact(orderMode: OrderMode) {
  return orderMode === "checkout"
    ? "- Ordering: add strengths to the cart and pay through the site checkout. Quote product codes in any question."
    : "- Ordering: each product page opens a prefilled WhatsApp order for that strength; the product code identifies the exact presentation.";
}

function header(input: LlmsInput, groups: readonly MaterialGroup[]) {
  const span = priceSpan(input.listings)?.replace("–", " to ");
  const checked = pricesCheckedOn(input.listings);
  const unavailable = input.listings.filter((listing) => !listing.available).length;
  return [
    `# ${company.name}`,
    "",
    `> ${company.name} lists research-use peptides and laboratory materials for procurement in the United States, with a USD price per box for every listed strength, a product code for each presentation and a comparison page for every material sold in several strengths.`,
    "",
    `- Catalog: ${plural(input.listings.length, "published presentation")} across ${plural(groups.length, "material")}${unavailable ? `; ${unavailable} temporarily unavailable` : ""}.`,
    `- Prices: USD per box${span ? `, from ${span}` : ""}${checked ? `; catalog last updated ${formatDate(checked)}` : ""}. Boxes hold 10 vials unless a listing says otherwise.`,
    "- Market: supported United States addresses only.",
    orderingFact(input.orderMode),
    `- Contact: ${company.email}.`,
    "- Use: laboratory research only. Not for human or veterinary use; not a drug, supplement or medical product.",
    `- This file was generated on ${input.generatedOn} from the live catalog.`,
  ];
}

function categoryLines(input: LlmsInput) {
  return categories.flatMap((category) => {
    const listings = input.listings.filter((listing) => listing.categorySlug === category.slug);
    const span = priceSpan(listings);
    return listings.length
      ? [`- [${category.name}](${url(input.origin, `/categories/${category.slug}`)}): ${plural(listings.length, "presentation")}${span ? `, ${span} per box` : ""}.`]
      : [];
  });
}

function materialLine(input: LlmsInput, group: MaterialGroup) {
  const span = priceSpan(group.listings);
  const classification = group.facts ? ` ${group.facts.classification}.` : "";
  return `- [${nounName(group)}](${url(input.origin, materialHref(group))}):${classification} ${strengthRange(group)} per vial; ${plural(group.listings.length, "strength")}${span ? `; ${span} per box` : ""}.`;
}

export function buildLlmsText(input: LlmsInput) {
  const groups = groupMaterials(input.listings);
  const posts = input.posts.map(
    (post) =>
      `- [${post.title}](${url(input.origin, `/blog/${post.slug}`)})${post.excerpt ? `: ${post.excerpt}` : ""}`,
  );
  return [
    ...header(input, groups),
    "",
    "## Catalog",
    "",
    `- [All products](${url(input.origin, "/products")}): search and filter every published presentation.`,
    `- [Research materials A–Z](${url(input.origin, "/research-materials")}): every material with its strengths, box prices and product codes.`,
    ...categoryLines(input),
    "",
    "## Materials",
    "",
    ...groups.map((group) => materialLine(input, group)),
    ...(posts.length ? ["", "## Guides", "", ...posts] : []),
    "",
    "## Policies",
    "",
    ...POLICY_PAGES.map(([name, path, note]) => `- [${name}](${url(input.origin, path)}): ${note}`),
    "",
    "## Optional",
    "",
    `- [Full text](${url(input.origin, "/llms-full.txt")}): every presentation with price, per-vial and per-mg figures, availability and FAQs, plus guides and the site FAQ.`,
    "",
  ].join("\n");
}

function listingLine(input: LlmsInput, listing: MaterialListing, group: MaterialGroup) {
  const price =
    listing.priceMinor === null
      ? "price on request"
      : `${formatUsd(listing.priceMinor)} per box (${[formatPerVial(listing) && `${formatPerVial(listing)} per vial`, formatPerMg(listing, group) && `${formatPerMg(listing, group)} per mg`].filter(Boolean).join(", ")})`;
  return `- [${listing.title}](${url(input.origin, `/products/${listing.slug}`)}): ${listing.strength} per vial, ${listing.packCount} vials per box, product code ${listing.codes.join(" / ")}, ${price}, ${listing.available ? "available" : "temporarily unavailable"}.`;
}

function materialSection(input: LlmsInput, group: MaterialGroup) {
  const faqs = hasHub(group) ? hubFaqs(group) : productFaqs(group.listings[0], group);
  return [
    `## ${nounName(group)}`,
    "",
    `URL: ${url(input.origin, materialHref(group))}`,
    "",
    hubIntro(group),
    "",
    ...(group.facts
      ? [
          `- Material type: ${group.facts.materialType}`,
          `- Classification: ${group.facts.classification}`,
          ...(group.facts.aliases.length ? [`- Also known as: ${group.facts.aliases.join("; ")}`] : []),
        ]
      : []),
    ...(group.listings[0].categoryName ? [`- Catalog category: ${group.listings[0].categoryName}`] : []),
    "",
    "### Listed strengths",
    "",
    ...group.listings.map((listing) => listingLine(input, listing, group)),
    "",
    "### Questions",
    "",
    ...faqs.flatMap((faq) => [`**${faq.question}**`, faq.answer, ""]),
  ];
}

function blockLines(blocks: readonly PublicBlogBlockDto[]) {
  return blocks.flatMap((block) => {
    if (block.type === "h2") return ["", `#### ${block.text}`, ""];
    if (block.type === "ul") return block.items.map((item) => `- ${item}`);
    return [block.text, ""];
  });
}

export function buildLlmsFullText(input: LlmsInput) {
  const groups = groupMaterials(input.listings);
  const guides = input.posts.flatMap((post) => [
    `## ${post.title}`,
    "",
    `URL: ${url(input.origin, `/blog/${post.slug}`)}${post.updatedAt ? ` (updated ${post.updatedAt.slice(0, 10)})` : ""}`,
    "",
    ...(post.excerpt ? [post.excerpt, ""] : []),
    ...(post.takeaways?.length ? ["Key takeaways:", ...post.takeaways.map((item) => `- ${item}`), ""] : []),
    ...blockLines(post.body ?? []),
    ...(post.faqs ?? []).flatMap((faq) => [`**${faq.question}**`, faq.answer, ""]),
  ]);
  return [
    ...header(input, groups),
    "",
    "The sections below repeat the public pages in plain text. Per-vial and per-mg figures are the box price divided out; the linked page is the authoritative, current version.",
    "",
    "# Materials and prices",
    "",
    ...groups.flatMap((group) => materialSection(input, group)),
    ...(guides.length ? ["# Guides", "", ...guides] : []),
    ...(input.faqs.length
      ? [
          "# Frequently asked questions",
          "",
          `Source: ${url(input.origin, "/faq")}`,
          "",
          ...input.faqs.flatMap((faq) => [`**${faq.question}**`, faq.answer, ""]),
        ]
      : []),
    "# Research use",
    "",
    `All materials listed by ${company.name} are supplied for laboratory research only. They are not drugs, supplements or medical products and are not for human or veterinary use. Policy: ${url(input.origin, "/research-use")}`,
    "",
  ].join("\n");
}
