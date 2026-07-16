import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

import { posts, type BlogBlock, type BlogPost } from "../../src/data/blog";
import { categories, type Category } from "../../src/data/categories";
import { company } from "../../src/data/company";
import { categoryIntros, faqs as publicFaqs } from "../../src/data/content";
import { featured as categorySignatures } from "../../src/data/featured";
import rawProducts from "../../src/data/products.json";

export const LEGACY_IMPORT_VERSION = 1;
export const LEGACY_PUBLISHED_AT = new Date("2026-01-01T00:00:00.000Z");
export const STATIC_PUBLIC_PATHS = [
  "/",
  "/products",
  "/about",
  "/blog",
  "/faq",
  "/contact",
] as const;

export type AssetMode = "primary-only" | "strict-assets";

export type LegacyProduct = {
  id: string;
  name: string;
  category: string;
  price: number | null;
  purity: string;
  cas?: string;
  appearance: string;
  storage: string;
  image: string;
  gallery?: string[];
  shortDescription: string;
  description: string;
  featured?: boolean;
};

export type LegacyFaq = {
  slug: string;
  question: string;
  answer: string;
};

const LEGACY_FAQ_SLUGS = [
  "research-use-only",
  "confirm-current-specification",
  "certificate-of-analysis-availability",
  "united-states-shipping",
  "research-material-storage",
  "custom-requirements",
  "accepted-payment-methods",
  "returns-and-support",
] as const;

export type AssetRecord = {
  path: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: bigint;
  checksum: string;
};

export type MissingAsset = {
  ownerType: "product" | "category" | "blog";
  ownerId: string;
  role: "primary" | "gallery" | "hero" | "cover";
  path: string;
  reason: "missing" | "invalid_path" | "not_a_file";
};

export type AssetAudit = {
  productPrimary: {
    referenced: number;
    verified: AssetRecord[];
    missing: MissingAsset[];
  };
  categoryHeroes: {
    referenced: number;
    verified: AssetRecord[];
    missing: MissingAsset[];
  };
  blogCovers: {
    referenced: number;
    verified: AssetRecord[];
    missing: MissingAsset[];
  };
  gallery: {
    referenced: number;
    verified: Array<AssetRecord & { productId: string }>;
    missing: MissingAsset[];
  };
};

export type DuplicateCasGroup = {
  casNumber: string;
  products: Array<{ id: string; name: string }>;
};

export type LegacyCommerceSource = {
  categories: readonly Category[];
  products: readonly LegacyProduct[];
  blogs: readonly BlogPost[];
  faqs: readonly LegacyFaq[];
  categoryIntros: Readonly<Record<string, string>>;
  placements: {
    featuredProducts: string[];
    homeBestsellers: string[];
    categorySignatures: Array<{
      categorySlug: string;
      productId: string;
      index: string;
      image: string;
      productName: string;
      benefit: string;
    }>;
  };
};

export class LegacySourceError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "LegacySourceError";
    this.code = code;
    this.details = details;
  }
}

function normalizeForStableJson(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(normalizeForStableJson);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => [key, normalizeForStableJson(nested)]),
    );
  }

  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value));
}

export function sourceHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

/** Converts an exact USD value to integer cents without allowing silent rounding. */
export function usdToMinor(value: number | null): bigint | null {
  if (value === null) {
    return null;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new LegacySourceError(
      "INVALID_USD_AMOUNT",
      `USD amount must be a finite, non-negative number: ${String(value)}`,
    );
  }

  const scaled = value * 100;
  const rounded = Math.round(scaled);

  if (Math.abs(scaled - rounded) > 1e-8 || !Number.isSafeInteger(rounded)) {
    throw new LegacySourceError(
      "INVALID_USD_PRECISION",
      `USD amount must have at most two decimal places and fit safely in cents: ${value}`,
    );
  }

  return BigInt(rounded);
}

export function parseReadingMinutes(value: string): number {
  const match = /^(\d+)\s+min$/.exec(value.trim());
  const minutes = match ? Number(match[1]) : Number.NaN;

  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new LegacySourceError(
      "INVALID_READING_TIME",
      `Expected readingTime in \"N min\" form, received: ${value}`,
    );
  }

  return minutes;
}

export function parseLegacyDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new LegacySourceError(
      "INVALID_BLOG_DATE",
      `Expected an ISO date-only blog date, received: ${value}`,
    );
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new LegacySourceError("INVALID_BLOG_DATE", `Invalid blog date: ${value}`);
  }

  return parsed;
}

export function blogBlocksToMarkdown(blocks: readonly BlogBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "h2":
          return `## ${block.text}`;
        case "p":
          return block.text;
        case "ul":
          return block.items.map((item) => `- ${item}`).join("\n");
      }
    })
    .join("\n\n");
}

export function findDuplicateCasGroups(
  products: readonly LegacyProduct[],
): DuplicateCasGroup[] {
  const groups = new Map<string, Array<{ id: string; name: string }>>();

  for (const product of products) {
    if (!product.cas) {
      continue;
    }
    const group = groups.get(product.cas) ?? [];
    group.push({ id: product.id, name: product.name });
    groups.set(product.cas, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([casNumber, groupedProducts]) => ({
      casNumber,
      products: groupedProducts,
    }));
}

function homeBestsellerIds(products: readonly LegacyProduct[]): string[] {
  const curated = [
    "bpc157-500mcg",
    "cjc-1295-without-dac-5mg-ipa-5mg",
    "fst-344",
    "ghrp-2",
  ];
  const picked = products.filter((product) => curated.includes(product.id));
  if (picked.length >= 8) {
    return picked.slice(0, 8).map((product) => product.id);
  }

  const extras = products.filter(
    (product) => product.price !== null && !curated.includes(product.id),
  );
  return [...picked, ...extras].slice(0, 8).map((product) => product.id);
}

export function loadLegacyCommerceSource(): LegacyCommerceSource {
  const products = rawProducts as LegacyProduct[];

  if (publicFaqs.length !== LEGACY_FAQ_SLUGS.length) {
    throw new LegacySourceError(
      "FAQ_SOURCE_COUNT_MISMATCH",
      "The public FAQ source and stable FAQ slug list must have equal lengths.",
    );
  }

  return {
    categories,
    products,
    blogs: posts,
    faqs: publicFaqs.map((faq, index) => ({
      slug: LEGACY_FAQ_SLUGS[index]!,
      question: faq.q,
      answer: faq.a,
    })),
    categoryIntros,
    placements: {
      featuredProducts: products
        .filter((product) => product.featured === true)
        .map((product) => product.id),
      homeBestsellers: homeBestsellerIds(products),
      categorySignatures: categorySignatures.map((placement) => ({ ...placement })),
    },
  };
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }

  if (duplicates.size > 0) {
    throw new LegacySourceError(
      "DUPLICATE_SOURCE_ID",
      `${label} contains duplicate identifiers.`,
      [...duplicates],
    );
  }
}

export function publicUrls(source: LegacyCommerceSource): string[] {
  return [
    ...STATIC_PUBLIC_PATHS,
    ...source.categories.map((category) => `/categories/${category.slug}`),
    ...source.products.map((product) => `/products/${product.id}`),
    ...source.blogs.map((post) => `/blog/${post.slug}`),
  ];
}

export function validateLegacySource(source: LegacyCommerceSource): void {
  assertUnique(source.categories.map((category) => category.slug), "categories");
  assertUnique(source.products.map((product) => product.id), "products");
  assertUnique(source.blogs.map((post) => post.slug), "blogs");
  assertUnique(source.faqs.map((faq) => faq.slug), "faqs");

  if (
    source.categories.length !== 6 ||
    source.products.length !== 75 ||
    source.blogs.length !== 4 ||
    source.faqs.length !== 8
  ) {
    throw new LegacySourceError(
      "SOURCE_COUNT_MISMATCH",
      "Legacy source must contain exactly 6 categories, 75 products, 4 blogs, and 8 FAQs.",
      {
        categories: source.categories.length,
        products: source.products.length,
        blogs: source.blogs.length,
        faqs: source.faqs.length,
      },
    );
  }

  const categorySlugs = new Set(source.categories.map((category) => category.slug));
  const productIds = new Set(source.products.map((product) => product.id));
  const blogSlugs = new Set(source.blogs.map((post) => post.slug));

  for (const product of source.products) {
    if (!categorySlugs.has(product.category)) {
      throw new LegacySourceError(
        "UNKNOWN_PRODUCT_CATEGORY",
        `Product ${product.id} references unknown category ${product.category}.`,
      );
    }
    usdToMinor(product.price);
  }

  for (const post of source.blogs) {
    parseLegacyDate(post.date);
    parseReadingMinutes(post.readingTime);
    for (const relatedSlug of post.related ?? []) {
      if (!blogSlugs.has(relatedSlug)) {
        throw new LegacySourceError(
          "UNKNOWN_RELATED_BLOG",
          `Blog ${post.slug} references unknown related blog ${relatedSlug}.`,
        );
      }
    }
  }

  for (const faq of source.faqs) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(faq.slug) ||
      faq.question.trim().length === 0 ||
      faq.question.length > 500 ||
      faq.answer.trim().length === 0
    ) {
      throw new LegacySourceError(
        "INVALID_FAQ_SOURCE",
        `FAQ source is invalid: ${faq.slug}`,
      );
    }
  }

  for (const productId of [
    ...source.placements.featuredProducts,
    ...source.placements.homeBestsellers,
    ...source.placements.categorySignatures.map((placement) => placement.productId),
  ]) {
    if (!productIds.has(productId)) {
      throw new LegacySourceError(
        "UNKNOWN_PLACEMENT_PRODUCT",
        `Merchandising placement references unknown product ${productId}.`,
      );
    }
  }

  for (const placement of source.placements.categorySignatures) {
    if (!categorySlugs.has(placement.categorySlug)) {
      throw new LegacySourceError(
        "UNKNOWN_PLACEMENT_CATEGORY",
        `Signature placement references unknown category ${placement.categorySlug}.`,
      );
    }
  }

  const urls = publicUrls(source);
  if (urls.length !== 91 || new Set(urls).size !== 91) {
    throw new LegacySourceError(
      "PUBLIC_URL_COMPATIBILITY_FAILED",
      "Legacy source must retain exactly 91 unique public URLs.",
      { count: urls.length, unique: new Set(urls).size },
    );
  }

  const selank = source.products.filter((product) =>
    ["selank", "selank-1"].includes(product.id),
  );
  if (
    selank.length !== 2 ||
    selank[0]?.name !== "Selank 5mg" ||
    selank[1]?.name !== "Selank 5mg" ||
    selank[0]?.cas !== "129954-34-3" ||
    selank[1]?.cas !== "129954-34-3" ||
    selank[0]?.price !== 46 ||
    selank[1]?.price !== 75
  ) {
    throw new LegacySourceError(
      "SELANK_COMPATIBILITY_FAILED",
      "The two distinct Selank legacy records must be preserved by ID and price.",
      selank,
    );
  }
}

function mimeTypeForPath(pathname: string): string {
  switch (extname(pathname).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function inspectAsset(
  publicDir: string,
  publicPath: string,
): { asset?: AssetRecord; reason?: MissingAsset["reason"] } {
  if (!publicPath.startsWith("/") || publicPath.includes("\0")) {
    return { reason: "invalid_path" };
  }

  const root = resolve(publicDir);
  const absolutePath = resolve(root, `.${publicPath}`);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
    return { reason: "invalid_path" };
  }

  try {
    const stats = statSync(absolutePath);
    if (!stats.isFile()) {
      return { reason: "not_a_file" };
    }
    const bytes = readFileSync(absolutePath);
    return {
      asset: {
        path: publicPath,
        storageKey: publicPath.slice(1),
        mimeType: mimeTypeForPath(publicPath),
        sizeBytes: BigInt(stats.size),
        checksum: createHash("sha256").update(bytes).digest("hex"),
      },
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { reason: "missing" };
    }
    throw error;
  }
}

export function auditLegacyAssets(
  source: LegacyCommerceSource,
  publicDir: string,
): AssetAudit {
  const audit: AssetAudit = {
    productPrimary: { referenced: 0, verified: [], missing: [] },
    categoryHeroes: { referenced: 0, verified: [], missing: [] },
    blogCovers: { referenced: 0, verified: [], missing: [] },
    gallery: { referenced: 0, verified: [], missing: [] },
  };

  for (const product of source.products) {
    audit.productPrimary.referenced += 1;
    const primary = inspectAsset(publicDir, product.image);
    if (primary.asset) {
      audit.productPrimary.verified.push(primary.asset);
    } else {
      audit.productPrimary.missing.push({
        ownerType: "product",
        ownerId: product.id,
        role: "primary",
        path: product.image,
        reason: primary.reason ?? "missing",
      });
    }

    for (const galleryPath of product.gallery ?? []) {
      audit.gallery.referenced += 1;
      const galleryAsset = inspectAsset(publicDir, galleryPath);
      if (galleryAsset.asset) {
        audit.gallery.verified.push({ ...galleryAsset.asset, productId: product.id });
      } else {
        audit.gallery.missing.push({
          ownerType: "product",
          ownerId: product.id,
          role: "gallery",
          path: galleryPath,
          reason: galleryAsset.reason ?? "missing",
        });
      }
    }
  }

  for (const category of source.categories) {
    audit.categoryHeroes.referenced += 1;
    const hero = inspectAsset(publicDir, category.hero);
    if (hero.asset) {
      audit.categoryHeroes.verified.push(hero.asset);
    } else {
      audit.categoryHeroes.missing.push({
        ownerType: "category",
        ownerId: category.slug,
        role: "hero",
        path: category.hero,
        reason: hero.reason ?? "missing",
      });
    }
  }

  for (const post of source.blogs) {
    audit.blogCovers.referenced += 1;
    const cover = inspectAsset(publicDir, post.cover);
    if (cover.asset) {
      audit.blogCovers.verified.push(cover.asset);
    } else {
      audit.blogCovers.missing.push({
        ownerType: "blog",
        ownerId: post.slug,
        role: "cover",
        path: post.cover,
        reason: cover.reason ?? "missing",
      });
    }
  }

  return audit;
}

export function assertAssetsForMode(audit: AssetAudit, mode: AssetMode): void {
  const requiredMissing = [
    ...audit.productPrimary.missing,
    ...audit.categoryHeroes.missing,
    ...audit.blogCovers.missing,
  ];

  if (requiredMissing.length > 0) {
    throw new LegacySourceError(
      "REQUIRED_ASSET_VALIDATION_FAILED",
      "One or more required primary/hero/cover assets are invalid.",
      requiredMissing,
    );
  }

  if (mode === "strict-assets" && audit.gallery.missing.length > 0) {
    throw new LegacySourceError(
      "STRICT_ASSET_VALIDATION_FAILED",
      `Strict asset validation rejected ${audit.gallery.missing.length} missing gallery references.`,
      audit.gallery.missing,
    );
  }
}

export function productAssetMap(audit: AssetAudit): Map<string, AssetRecord> {
  const byPath = new Map(audit.productPrimary.verified.map((asset) => [asset.path, asset]));
  return byPath;
}

export function allAssetMap(audit: AssetAudit): Map<string, AssetRecord> {
  const records = [
    ...audit.productPrimary.verified,
    ...audit.categoryHeroes.verified,
    ...audit.blogCovers.verified,
    ...audit.gallery.verified,
  ];
  return new Map(records.map((asset) => [asset.path, asset]));
}

export function categoryCanonicalUrl(slug: string): string {
  return `${company.url}/categories/${slug}`;
}

export function productCanonicalUrl(slug: string): string {
  return `${company.url}/products/${slug}`;
}

export function blogCanonicalUrl(slug: string): string {
  return `${company.url}/blog/${slug}`;
}
