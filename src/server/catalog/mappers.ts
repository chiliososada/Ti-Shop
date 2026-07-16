import type {
  PublicCatalogSitemapEntryDto,
  PublicCategoryDetailDto,
  PublicCategoryListItemDto,
  PublicHomePlacementsDto,
  PublicMoneyDto,
  PublicPriceMode,
  PublicProductDetailDto,
  PublicProductSummaryDto,
  PublicProductVariantDto,
} from "@/domain/catalog";
import { normalizeCanonicalUrl } from "@/lib/canonical-url";
import { minimumOrderQuantityFromOptionValues } from "@/domain/minimum-order-quantity";
import { z } from "zod";
import type {
  PublicCategoryDetailRow,
  PublicCategoryListRow,
  PublicCategorySitemapRow,
  PublicPlacementRow,
  PublicProductDetailRow,
  PublicProductSitemapRow,
  PublicProductSummaryRow,
} from "@/server/catalog/query-contracts";
import {
  mapPrimitiveRecord,
  mapPublicDocument,
  mapPublicImage,
  mapPublicSeo,
  sanitizePublicImageUrl,
  toIsoString,
} from "@/server/catalog/shared-mappers";

type PublicPriceRow = {
  amountMinor: bigint;
  currency: string;
  kind: string;
  countryCode: string | null;
  taxInclusive: boolean;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
};

type ProductMediaRow =
  | PublicProductDetailRow["media"][number]
  | PublicProductSummaryRow["media"][number];

const categorySignatureMetadataSchema = z
  .object({
    source: z.string().trim().min(1).max(500),
    categorySlug: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    index: z.string().trim().min(1).max(20),
    image: z.string().trim().min(1).max(2_048),
    productName: z.string().trim().min(1).max(255),
    benefit: z.string().trim().min(1).max(2_000),
  })
  .strict();

function mapPlacementPresentation(
  key: string,
  metadata: unknown,
) {
  if (key !== "legacy-category-signatures") {
    return null;
  }

  const parsed = categorySignatureMetadataSchema.safeParse(metadata);
  if (!parsed.success) {
    return null;
  }

  const imageUrl = sanitizePublicImageUrl(parsed.data.image);
  if (!imageUrl) {
    return null;
  }

  return {
    categorySlug: parsed.data.categorySlug,
    index: parsed.data.index,
    imageUrl,
    productName: parsed.data.productName,
    benefit: parsed.data.benefit,
  };
}

function mapPriceMode(value: string): PublicPriceMode {
  return value === "FIXED" ? "fixed" : "on-request";
}

function formatUsdMinor(amountMinor: bigint): string {
  const zero = BigInt(0);
  const oneHundred = BigInt(100);
  const isNegative = amountMinor < zero;
  const absolute = isNegative ? -amountMinor : amountMinor;
  const dollars = absolute / oneHundred;
  const cents = (absolute % oneHundred).toString().padStart(2, "0");
  return `${isNegative ? "-" : ""}$${dollars.toString()}.${cents}`;
}

function isCurrentUsdPrice(price: PublicPriceRow, now: Date): boolean {
  return (
    price.currency === "USD" &&
    (price.countryCode === "US" || price.countryCode === null) &&
    price.isActive &&
    price.deletedAt === null &&
    price.amountMinor >= BigInt(0) &&
    (price.startsAt === null || price.startsAt.getTime() <= now.getTime()) &&
    (price.endsAt === null || price.endsAt.getTime() > now.getTime())
  );
}

function pricePriority(price: PublicPriceRow): [number, number, number, number] {
  return [
    price.countryCode === "US" ? 1 : 0,
    price.kind === "SALE" ? 1 : 0,
    price.startsAt?.getTime() ?? Number.MIN_SAFE_INTEGER,
    price.createdAt.getTime(),
  ];
}

function comparePricePriority(a: PublicPriceRow, b: PublicPriceRow): number {
  const left = pricePriority(a);
  const right = pricePriority(b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return right[index] - left[index];
    }
  }
  return 0;
}

export function selectCurrentUsdPrice(
  prices: readonly PublicPriceRow[],
  now: Date,
): PublicMoneyDto | null {
  const price = prices
    .filter((candidate) => isCurrentUsdPrice(candidate, now))
    .sort(comparePricePriority)[0];

  if (!price) {
    return null;
  }

  return {
    amountMinor: price.amountMinor.toString(),
    currency: "USD",
    display: formatUsdMinor(price.amountMinor),
    kind: price.kind === "SALE" ? "sale" : "regular",
    taxInclusive: price.taxInclusive,
  };
}

function mapPrimaryImage(
  media: readonly ProductMediaRow[],
  productPublicId: string,
  productTitle: string,
) {
  const primary = [...media]
    .filter(
      (item) =>
        item.role === "PRIMARY" &&
        (item.variant === null ||
          item.variant.product.publicId === productPublicId),
    )
    .sort((a, b) => a.position - b.position)[0];

  return mapPublicImage(primary?.media ?? null, productTitle);
}

function mapProductVariant(
  row: PublicProductDetailRow["variants"][number],
  now: Date,
): PublicProductVariantDto | null {
  const directSale = mapDirectSaleVariant(row, now);
  if (!directSale) return null;

  return {
    publicId: row.publicId,
    sku: row.sku,
    title: row.title,
    optionValues: mapPrimitiveRecord(row.optionValues),
    minimumOrderQuantity: directSale.minimumOrderQuantity,
    requiresShipping: row.requiresShipping,
    priceMode: "fixed",
    price: directSale.price,
    directPurchaseAvailable: isConservativelyAvailableForMinimum({
      trackInventory: row.trackInventory,
      minimumOrderQuantity: directSale.minimumOrderQuantity,
      levels: row.inventoryLevels,
    }),
  };
}

function mapDirectSaleVariant(
  row: {
    priceMode: string;
    optionValues: unknown;
    prices: readonly PublicPriceRow[];
  },
  now: Date,
) {
  if (mapPriceMode(row.priceMode) !== "fixed") return null;
  const minimumOrderQuantity =
    minimumOrderQuantityFromOptionValues(row.optionValues);
  const price = selectCurrentUsdPrice(row.prices, now);
  return minimumOrderQuantity !== null && price
    ? { minimumOrderQuantity, price }
    : null;
}

export function isConservativelyAvailableForMinimum({
  trackInventory,
  minimumOrderQuantity,
  levels,
}: {
  trackInventory: boolean;
  minimumOrderQuantity: number;
  levels: ReadonlyArray<{
    onHandQuantity: number;
    reservedQuantity: number;
    safetyStockQuantity: number;
  }>;
}) {
  if (!trackInventory) return true;

  let remaining = minimumOrderQuantity;
  for (const level of levels) {
    remaining -= Math.max(
      0,
      level.onHandQuantity -
        level.reservedQuantity -
        level.safetyStockQuantity,
    );
    if (remaining <= 0) return true;
  }
  return false;
}

export function mapPublicProductSummary(
  row: PublicProductSummaryRow,
  now: Date,
): PublicProductSummaryDto {
  const defaultVariant = row.variants
    .map((variant) => ({
      row: variant,
      directSale: mapDirectSaleVariant(variant, now),
    }))
    .find((candidate) => candidate.directSale !== null) ?? null;

  return {
    publicId: row.publicId,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    shortDescription: row.shortDescription,
    brand: row.brand,
    purity: row.purity,
    isFeatured: row.isFeatured,
    primaryImage: mapPrimaryImage(row.media, row.publicId, row.title),
    primaryCategory: row.categories[0]?.category ?? null,
    defaultVariantPublicId: defaultVariant?.row.publicId ?? null,
    minimumOrderQuantity:
      defaultVariant?.directSale?.minimumOrderQuantity ?? null,
    priceMode: defaultVariant ? "fixed" : null,
    price: defaultVariant?.directSale?.price ?? null,
  };
}

export function mapPublicProductDetail(
  row: PublicProductDetailRow,
  now: Date,
): PublicProductDetailDto | null {
  const publishedAt = toIsoString(row.publishedAt);
  const updatedAt = toIsoString(row.updatedAt);
  if (!publishedAt || !updatedAt) {
    return null;
  }

  const gallery = [...row.media]
    .filter(
      (item) =>
        item.variant === null ||
        item.variant.product.publicId === row.publicId,
    )
    .sort((a, b) => {
      if (a.role !== b.role) {
        return a.role === "PRIMARY" ? -1 : 1;
      }
      return a.position - b.position;
    })
    .map((item) => mapPublicImage(item.media, row.title))
    .filter((image) => image !== null)
    .filter(
      (image, index, images) =>
        images.findIndex((candidate) => candidate.publicId === image.publicId) ===
        index,
    );
  const variants = row.variants.flatMap((variant) => {
    const mapped = mapProductVariant(variant, now);
    return mapped ? [mapped] : [];
  });
  const documents = row.media
    .filter(
      (item) =>
        item.role === "DOCUMENT" &&
        (item.variant === null ||
          item.variant.product.publicId === row.publicId),
    )
    .map((item) => mapPublicDocument(item.media, `${row.title} document`))
    .filter((document) => document !== null)
    .filter(
      (document, index, all) =>
        all.findIndex(
          (candidate) => candidate.publicId === document.publicId,
        ) === index,
    );

  return {
    ...mapPublicProductSummary(row, now),
    description: row.description,
    casNumber: row.casNumber,
    appearance: row.appearance,
    storageInstructions: row.storageInstructions,
    publishedAt,
    updatedAt,
    categories: row.categories.map(({ category }) => category),
    tags: row.tags.map(({ tag }) => tag),
    gallery,
    documents,
    variants,
    seo: mapPublicSeo(row.seo),
  };
}

export function mapPublicCategoryListItem(
  row: PublicCategoryListRow,
): PublicCategoryListItemDto {
  return {
    publicId: row.publicId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    productCount: row._count.products,
  };
}

export function mapPublicCategoryDetail(
  row: PublicCategoryDetailRow,
  now: Date,
): PublicCategoryDetailDto | null {
  const publishedAt = toIsoString(row.publishedAt);
  const updatedAt = toIsoString(row.updatedAt);
  if (!publishedAt || !updatedAt) {
    return null;
  }

  return {
    ...mapPublicCategoryListItem(row),
    publishedAt,
    updatedAt,
    products: row.products.map(({ product }) =>
      mapPublicProductSummary(product, now),
    ),
    seo: mapPublicSeo(row.seo),
  };
}

export function mapPublicPlacements(
  rows: readonly PublicPlacementRow[],
  keys: readonly string[],
  perPlacementLimit: number,
  now: Date,
): PublicHomePlacementsDto {
  const result: PublicHomePlacementsDto = Object.fromEntries(
    keys.map((key) => [key, []]),
  );

  for (const row of rows) {
    const placement = result[row.key];
    if (!placement || placement.length >= perPlacementLimit) {
      continue;
    }
    placement.push({
      position: row.position,
      product: mapPublicProductSummary(row.product, now),
      presentation: mapPlacementPresentation(row.key, row.metadata),
    });
  }

  return result;
}

function mapSitemapRow(
  kind: "product" | "category",
  row: PublicProductSitemapRow | PublicCategorySitemapRow,
): PublicCatalogSitemapEntryDto | null {
  const lastModified = toIsoString(
    row.seo && row.seo.updatedAt > row.updatedAt
      ? row.seo.updatedAt
      : row.updatedAt,
  );
  if (!lastModified) {
    return null;
  }

  return {
    kind,
    slug: row.slug,
    path:
      kind === "product"
        ? `/products/${encodeURIComponent(row.slug)}`
        : `/categories/${encodeURIComponent(row.slug)}`,
    canonicalUrl: row.seo?.canonicalUrl
      ? normalizeCanonicalUrl(row.seo.canonicalUrl)
      : null,
    lastModified,
  };
}

export function mapPublicCatalogSitemapRows(
  products: readonly PublicProductSitemapRow[],
  categories: readonly PublicCategorySitemapRow[],
): PublicCatalogSitemapEntryDto[] {
  return [
    ...products.map((row) => mapSitemapRow("product", row)),
    ...categories.map((row) => mapSitemapRow("category", row)),
  ].filter((entry) => entry !== null);
}
