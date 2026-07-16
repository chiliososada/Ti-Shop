import type { Prisma } from "@/generated/prisma/client";
import type { PublicProductSort } from "@/domain/catalog";

export const PUBLIC_CURRENCY = "USD" as const;
export const PUBLIC_COUNTRY = "US" as const;

export function buildPublicProductOrderBy(
  sort: PublicProductSort,
): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "name-asc":
      return [{ title: "asc" }, { id: "asc" }];
    case "name-desc":
      return [{ title: "desc" }, { id: "asc" }];
    case "newest":
      return [{ publishedAt: "desc" }, { id: "asc" }];
    case "recommended":
    default:
      return [{ position: "asc" }, { title: "asc" }, { id: "asc" }];
  }
}

export function buildPublishedProductWhere(
  now: Date,
): Prisma.ProductWhereInput {
  return {
    status: "ACTIVE",
    deletedAt: null,
    publishedAt: { not: null, lte: now },
  };
}

export function buildPublishedCategoryWhere(
  now: Date,
): Prisma.CategoryWhereInput {
  return {
    status: "ACTIVE",
    deletedAt: null,
    publishedAt: { not: null, lte: now },
  };
}

export function buildPublishedVariantWhere(
  now: Date,
): Prisma.ProductVariantWhereInput {
  return {
    status: "ACTIVE",
    deletedAt: null,
    publishedAt: { not: null, lte: now },
  };
}

export function buildPublicDirectSaleVariantWhere(
  now: Date,
): Prisma.ProductVariantWhereInput {
  return {
    AND: [
      buildPublishedVariantWhere(now),
      { priceMode: "FIXED" },
      { prices: { some: buildCurrentUsdPriceWhere(now) } },
    ],
  };
}

export function buildCurrentUsdPriceWhere(now: Date): Prisma.PriceWhereInput {
  return {
    currency: PUBLIC_CURRENCY,
    isActive: true,
    deletedAt: null,
    AND: [
      {
        OR: [{ countryCode: PUBLIC_COUNTRY }, { countryCode: null }],
      },
      {
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      },
      {
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
    ],
  };
}

export function buildPublicProductListWhere(
  now: Date,
  categorySlug: string | null,
  searchQuery: string | null = null,
): Prisma.ProductWhereInput {
  const published = buildPublishedProductWhere(now);
  const filters: Prisma.ProductWhereInput[] = [published];

  if (categorySlug) {
    filters.push({
      categories: {
        some: {
          category: {
            ...buildPublishedCategoryWhere(now),
            slug: categorySlug,
          },
        },
      },
    });
  }

  if (searchQuery) {
    const contains = { contains: searchQuery, mode: "insensitive" as const };
    filters.push({
      OR: [
        { title: contains },
        { slug: contains },
        { subtitle: contains },
        { shortDescription: contains },
        { brand: contains },
        { purity: contains },
        { casNumber: contains },
      ],
    });
  }

  return filters.length === 1 ? published : { AND: filters };
}

export const publicImageSelect = {
  publicId: true,
  kind: true,
  publicUrl: true,
  altText: true,
  width: true,
  height: true,
  variants: true,
  uploadStatus: true,
  isPrivate: true,
  deletedAt: true,
} as const satisfies Prisma.MediaSelect;

const publicProductMediaSelect = {
  ...publicImageSelect,
  mimeType: true,
} as const satisfies Prisma.MediaSelect;

export const publicSeoSelect = {
  title: true,
  description: true,
  canonicalUrl: true,
  noIndex: true,
  noFollow: true,
  structuredData: true,
  openGraphMedia: {
    select: publicImageSelect,
  },
} as const satisfies Prisma.SeoMetadataSelect;

function buildPublicPriceSelect() {
  return {
    amountMinor: true,
    currency: true,
    kind: true,
    countryCode: true,
    taxInclusive: true,
    isActive: true,
    startsAt: true,
    endsAt: true,
    createdAt: true,
    deletedAt: true,
  } as const satisfies Prisma.PriceSelect;
}

function buildPublicVariantSummarySelect(now: Date) {
  return {
    publicId: true,
    title: true,
    priceMode: true,
    optionValues: true,
    position: true,
    prices: {
      where: buildCurrentUsdPriceWhere(now),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: buildPublicPriceSelect(),
    },
  } as const satisfies Prisma.ProductVariantSelect;
}

function buildPublicVariantDetailSelect(now: Date) {
  return {
    ...buildPublicVariantSummarySelect(now),
    sku: true,
    optionValues: true,
    requiresShipping: true,
    trackInventory: true,
    inventoryLevels: {
      where: {
        location: {
          is: { isActive: true, countryCode: PUBLIC_COUNTRY },
        },
      },
      select: {
        onHandQuantity: true,
        reservedQuantity: true,
        safetyStockQuantity: true,
      },
    },
  } as const satisfies Prisma.ProductVariantSelect;
}

function buildPublicPrimaryMediaRelation() {
  return {
    where: {
      role: "PRIMARY",
      media: {
        kind: "IMAGE",
        publicUrl: { not: null },
        isPrivate: false,
        deletedAt: null,
      },
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: {
      role: true,
      position: true,
      variant: {
        select: {
          product: { select: { publicId: true } },
        },
      },
      media: { select: publicImageSelect },
    },
  } as const satisfies Prisma.Product$mediaArgs;
}

function buildPublicGalleryMediaRelation() {
  return {
    where: {
      OR: [
        {
          role: { in: ["PRIMARY", "GALLERY"] },
          media: {
            kind: "IMAGE",
            publicUrl: { not: null },
            isPrivate: false,
            deletedAt: null,
          },
        },
        {
          role: "DOCUMENT",
          media: {
            kind: "DOCUMENT",
            publicUrl: { not: null },
            isPrivate: false,
            deletedAt: null,
          },
        },
      ],
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: {
      role: true,
      position: true,
      variant: {
        select: {
          product: { select: { publicId: true } },
        },
      },
      media: { select: publicProductMediaSelect },
    },
  } as const satisfies Prisma.Product$mediaArgs;
}

function buildPublicProductCategoriesRelation(now: Date) {
  return {
    where: {
      category: buildPublishedCategoryWhere(now),
    },
    orderBy: [{ position: "asc" }, { categoryId: "asc" }],
    select: {
      position: true,
      category: {
        select: {
          publicId: true,
          slug: true,
          name: true,
        },
      },
    },
  } as const satisfies Prisma.Product$categoriesArgs;
}

export function buildPublicProductSummarySelect(now: Date) {
  return {
    publicId: true,
    slug: true,
    title: true,
    subtitle: true,
    shortDescription: true,
    brand: true,
    purity: true,
    isFeatured: true,
    variants: {
      where: buildPublicDirectSaleVariantWhere(now),
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: buildPublicVariantSummarySelect(now),
    },
    media: buildPublicPrimaryMediaRelation(),
    categories: {
      ...buildPublicProductCategoriesRelation(now),
      take: 1,
    },
  } as const satisfies Prisma.ProductSelect;
}

export function buildPublicProductDetailSelect(now: Date) {
  return {
    ...buildPublicProductSummarySelect(now),
    description: true,
    casNumber: true,
    appearance: true,
    storageInstructions: true,
    publishedAt: true,
    updatedAt: true,
    variants: {
      where: buildPublicDirectSaleVariantWhere(now),
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: buildPublicVariantDetailSelect(now),
    },
    media: buildPublicGalleryMediaRelation(),
    categories: buildPublicProductCategoriesRelation(now),
    tags: {
      where: {
        tag: {
          status: "ACTIVE",
          deletedAt: null,
        },
      },
      orderBy: [{ tagId: "asc" }],
      select: {
        tag: {
          select: {
            slug: true,
            name: true,
          },
        },
      },
    },
    seo: {
      select: publicSeoSelect,
    },
  } as const satisfies Prisma.ProductSelect;
}

export function buildPublicCategoryListSelect(now: Date) {
  return {
    publicId: true,
    slug: true,
    name: true,
    description: true,
    _count: {
      select: {
        products: {
          where: {
            product: buildPublishedProductWhere(now),
          },
        },
      },
    },
  } as const satisfies Prisma.CategorySelect;
}

export function buildPublicCategoryDetailSelect(now: Date, limit: number) {
  return {
    ...buildPublicCategoryListSelect(now),
    publishedAt: true,
    updatedAt: true,
    products: {
      where: {
        product: buildPublishedProductWhere(now),
      },
      orderBy: [{ position: "asc" }, { productId: "asc" }],
      take: limit,
      select: {
        product: {
          select: buildPublicProductSummarySelect(now),
        },
      },
    },
    seo: {
      select: publicSeoSelect,
    },
  } as const satisfies Prisma.CategorySelect;
}

export function buildPublicPlacementSelect(now: Date) {
  return {
    key: true,
    position: true,
    metadata: true,
    product: {
      select: buildPublicProductSummarySelect(now),
    },
  } as const satisfies Prisma.MerchandisingPlacementSelect;
}

export const publicCatalogSitemapSelect = {
  slug: true,
  updatedAt: true,
  seo: {
    select: {
      canonicalUrl: true,
      updatedAt: true,
    },
  },
} as const;

export type PublicProductSummaryRow = Prisma.ProductGetPayload<{
  select: ReturnType<typeof buildPublicProductSummarySelect>;
}>;

export type PublicProductDetailRow = Prisma.ProductGetPayload<{
  select: ReturnType<typeof buildPublicProductDetailSelect>;
}>;

export type PublicCategoryListRow = Prisma.CategoryGetPayload<{
  select: ReturnType<typeof buildPublicCategoryListSelect>;
}>;

export type PublicCategoryDetailRow = Prisma.CategoryGetPayload<{
  select: ReturnType<typeof buildPublicCategoryDetailSelect>;
}>;

export type PublicPlacementRow = Prisma.MerchandisingPlacementGetPayload<{
  select: ReturnType<typeof buildPublicPlacementSelect>;
}>;

export type PublicProductSitemapRow = Prisma.ProductGetPayload<{
  select: typeof publicCatalogSitemapSelect;
}>;

export type PublicCategorySitemapRow = Prisma.CategoryGetPayload<{
  select: typeof publicCatalogSitemapSelect;
}>;
