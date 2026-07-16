import "server-only";

import { cache } from "react";

import type {
  PublicCatalogSitemapEntryDto,
  PublicCategoryDetailDto,
  PublicCategoryListItemDto,
  PublicHomePlacementsDto,
  PublicProductDetailDto,
  PublicProductSort,
  PublicProductSummaryDto,
} from "@/domain/catalog";
import { CORE_MERCHANDISING_PLACEMENT_KEYS } from "@/domain/merchandising";
import {
  buildPagination,
  normalizePageOption,
  normalizeSearchText,
  type Pagination,
} from "@/lib/pagination";
import { getDb } from "@/server/db/client";
import {
  normalizePlacementKeys,
  normalizePublicProductSort,
  normalizePublicLimit,
  normalizePublicSlug,
} from "@/server/catalog/inputs";
import {
  mapPublicCatalogSitemapRows,
  mapPublicCategoryDetail,
  mapPublicCategoryListItem,
  mapPublicPlacements,
  mapPublicProductDetail,
  mapPublicProductSummary,
} from "@/server/catalog/mappers";
import {
  buildPublishedCategoryWhere,
  buildPublishedProductWhere,
  buildPublicProductOrderBy,
  buildPublicCategoryDetailSelect,
  buildPublicCategoryListSelect,
  buildPublicPlacementSelect,
  buildPublicProductDetailSelect,
  buildPublicProductListWhere,
  buildPublicProductSummarySelect,
  publicCatalogSitemapSelect,
} from "@/server/catalog/query-contracts";

export const DEFAULT_HOME_PLACEMENT_KEYS = CORE_MERCHANDISING_PLACEMENT_KEYS;

export type PublicProductListOptions = {
  categorySlug?: string;
  limit?: number;
};

export type PublicProductPageOptions = {
  categorySlug?: string;
  query?: string;
  page?: number;
  pageSize?: number;
  sort?: PublicProductSort;
};

export type PublicProductPageResult = {
  products: PublicProductSummaryDto[];
  pagination: Omit<Pagination, "skip">;
};

export type PublicCategoryDetailOptions = {
  productLimit?: number;
};

const getProductListCached = cache(
  async (
    categorySlug: string | null,
    limit: number,
  ): Promise<PublicProductSummaryDto[]> => {
    const now = new Date();
    const rows = await getDb().product.findMany({
      where: buildPublicProductListWhere(now, categorySlug),
      orderBy: [{ position: "asc" }, { title: "asc" }, { id: "asc" }],
      take: limit,
      select: buildPublicProductSummarySelect(now),
    });

    return rows.map((row) => mapPublicProductSummary(row, now));
  },
);

export function getPublicProductList(
  options: PublicProductListOptions = {},
): Promise<PublicProductSummaryDto[]> {
  const categorySlug = options.categorySlug
    ? normalizePublicSlug(options.categorySlug, 180)
    : null;
  if (options.categorySlug && !categorySlug) {
    return Promise.resolve([]);
  }

  return getProductListCached(
    categorySlug,
    normalizePublicLimit(options.limit, 100, 200),
  );
}

const getProductPageCached = cache(
  async (
    categorySlug: string | null,
    query: string,
    requestedPage: number,
    pageSize: number,
    sort: PublicProductSort,
  ): Promise<PublicProductPageResult> => {
    const now = new Date();
    const where = buildPublicProductListWhere(
      now,
      categorySlug,
      query || null,
    );
    const total = await getDb().product.count({ where });
    const pagination = buildPagination(total, requestedPage, pageSize);
    const rows = await getDb().product.findMany({
      where,
      orderBy: buildPublicProductOrderBy(sort),
      skip: pagination.skip,
      take: pagination.pageSize,
      select: buildPublicProductSummarySelect(now),
    });

    return {
      products: rows.map((row) => mapPublicProductSummary(row, now)),
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        pageCount: pagination.pageCount,
        total: pagination.total,
      },
    };
  },
);

export function getPublicProductPage(
  options: PublicProductPageOptions = {},
): Promise<PublicProductPageResult> {
  const categorySlug = options.categorySlug
    ? normalizePublicSlug(options.categorySlug, 180)
    : null;
  const requestedPage = normalizePageOption(options.page);
  const pageSize = normalizePublicLimit(options.pageSize, 24, 48);

  if (options.categorySlug && !categorySlug) {
    const pagination = buildPagination(0, requestedPage, pageSize);
    return Promise.resolve({
      products: [],
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        pageCount: pagination.pageCount,
        total: pagination.total,
      },
    });
  }

  return getProductPageCached(
    categorySlug,
    normalizeSearchText(options.query),
    requestedPage,
    pageSize,
    normalizePublicProductSort(options.sort),
  );
}

const getProductBySlugCached = cache(
  async (slug: string): Promise<PublicProductDetailDto | null> => {
    const now = new Date();
    const row = await getDb().product.findFirst({
      where: {
        ...buildPublishedProductWhere(now),
        slug,
      },
      select: buildPublicProductDetailSelect(now),
    });

    return row ? mapPublicProductDetail(row, now) : null;
  },
);

export function getPublicProductBySlug(
  slug: string,
): Promise<PublicProductDetailDto | null> {
  const normalized = normalizePublicSlug(slug);
  return normalized ? getProductBySlugCached(normalized) : Promise.resolve(null);
}

export async function getPublicProductMetadataData(slug: string) {
  const product = await getPublicProductBySlug(slug);
  if (!product) {
    return null;
  }

  return {
    title: product.seo?.title ?? product.title,
    description: product.seo?.description ?? product.shortDescription,
    canonicalUrl: product.seo?.canonicalUrl ?? `/products/${product.slug}`,
    noIndex: product.seo?.noIndex ?? false,
    noFollow: product.seo?.noFollow ?? false,
    openGraphImage: product.seo?.openGraphImage ?? product.primaryImage,
    structuredData: product.seo?.structuredData ?? null,
  };
}

const getCategoriesCached = cache(
  async (): Promise<PublicCategoryListItemDto[]> => {
    const now = new Date();
    const rows = await getDb().category.findMany({
      where: buildPublishedCategoryWhere(now),
      orderBy: [{ position: "asc" }, { name: "asc" }, { id: "asc" }],
      take: 200,
      select: buildPublicCategoryListSelect(now),
    });

    return rows.map(mapPublicCategoryListItem);
  },
);

export function getPublicCategories(): Promise<PublicCategoryListItemDto[]> {
  return getCategoriesCached();
}

const getCategoryBySlugCached = cache(
  async (
    slug: string,
    productLimit: number,
  ): Promise<PublicCategoryDetailDto | null> => {
    const now = new Date();
    const row = await getDb().category.findFirst({
      where: {
        ...buildPublishedCategoryWhere(now),
        slug,
      },
      select: buildPublicCategoryDetailSelect(now, productLimit),
    });

    return row ? mapPublicCategoryDetail(row, now) : null;
  },
);

export function getPublicCategoryBySlug(
  slug: string,
  options: PublicCategoryDetailOptions = {},
): Promise<PublicCategoryDetailDto | null> {
  const normalized = normalizePublicSlug(slug, 180);
  if (!normalized) {
    return Promise.resolve(null);
  }

  return getCategoryBySlugCached(
    normalized,
    normalizePublicLimit(options.productLimit, 100, 200),
  );
}

export async function getPublicCategoryMetadataData(slug: string) {
  const category = await getPublicCategoryBySlug(slug);
  if (!category) {
    return null;
  }

  return {
    title: category.seo?.title ?? category.name,
    description: category.seo?.description ?? category.description,
    canonicalUrl: category.seo?.canonicalUrl ?? `/categories/${category.slug}`,
    noIndex: category.seo?.noIndex ?? false,
    noFollow: category.seo?.noFollow ?? false,
    openGraphImage: category.seo?.openGraphImage ?? null,
    structuredData: category.seo?.structuredData ?? null,
  };
}

const getHomePlacementsCached = cache(
  async (
    serializedKeys: string,
    perPlacementLimit: number,
  ): Promise<PublicHomePlacementsDto> => {
    const keys = serializedKeys.split(",").filter(Boolean);
    if (keys.length === 0) {
      return {};
    }

    const now = new Date();
    const rows = await getDb().merchandisingPlacement.findMany({
      where: {
        key: { in: keys },
        isActive: true,
        product: buildPublishedProductWhere(now),
      },
      orderBy: [{ key: "asc" }, { position: "asc" }, { id: "asc" }],
      select: buildPublicPlacementSelect(now),
    });

    return mapPublicPlacements(rows, keys, perPlacementLimit, now);
  },
);

export function getPublicHomePlacements(
  keys: readonly string[] = DEFAULT_HOME_PLACEMENT_KEYS,
  perPlacementLimit = 8,
): Promise<PublicHomePlacementsDto> {
  const normalizedKeys = normalizePlacementKeys(keys);
  if (normalizedKeys.length === 0) {
    return Promise.resolve({});
  }

  return getHomePlacementsCached(
    normalizedKeys.join(","),
    normalizePublicLimit(perPlacementLimit, 8, 24),
  );
}

const getCatalogSitemapEntriesCached = cache(
  async (): Promise<PublicCatalogSitemapEntryDto[]> => {
    const now = new Date();
    const [products, categories] = await Promise.all([
      getDb().product.findMany({
        where: {
          ...buildPublishedProductWhere(now),
          OR: [{ seo: { is: null } }, { seo: { is: { noIndex: false } } }],
        },
        orderBy: [{ slug: "asc" }],
        select: publicCatalogSitemapSelect,
      }),
      getDb().category.findMany({
        where: {
          ...buildPublishedCategoryWhere(now),
          OR: [{ seo: { is: null } }, { seo: { is: { noIndex: false } } }],
        },
        orderBy: [{ slug: "asc" }],
        select: publicCatalogSitemapSelect,
      }),
    ]);

    return mapPublicCatalogSitemapRows(products, categories);
  },
);

export function getPublicCatalogSitemapEntries(): Promise<
  PublicCatalogSitemapEntryDto[]
> {
  return getCatalogSitemapEntriesCached();
}
