import "server-only";

import { cache } from "react";

import type {
  PublicBlogPostDto,
  PublicBlogSitemapEntryDto,
  PublicBlogSummaryDto,
} from "@/domain/content";
import {
  buildPagination,
  normalizePageOption,
  type Pagination,
} from "@/lib/pagination";
import { normalizePublicLimit, normalizePublicSlug } from "@/server/catalog/inputs";
import { getDb } from "@/server/db/client";
import {
  mapPublicBlogDetail,
  mapPublicBlogSitemapRows,
  mapPublicBlogSummary,
} from "@/server/content/mappers";
import {
  buildPublishedBlogPostWhere,
  buildPublicBlogDetailSelect,
  buildPublicBlogSummarySelect,
  publicBlogSitemapSelect,
} from "@/server/content/query-contracts";

export type PublicBlogListOptions = {
  category?: string;
  limit?: number;
};

export type PublicBlogPageOptions = {
  category?: string;
  page?: number;
  pageSize?: number;
};

export type PublicBlogPageResult = {
  posts: PublicBlogSummaryDto[];
  pagination: Omit<Pagination, "skip">;
};

function normalizeBlogCategory(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 160 ? normalized : null;
}

const getBlogListCached = cache(
  async (
    category: string | null,
    limit: number,
  ): Promise<PublicBlogSummaryDto[]> => {
    const now = new Date();
    const rows = await getDb().blogPost.findMany({
      where: {
        ...buildPublishedBlogPostWhere(now),
        ...(category ? { category } : {}),
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: limit,
      select: buildPublicBlogSummarySelect(),
    });

    return rows
      .map(mapPublicBlogSummary)
      .filter((post) => post !== null);
  },
);

export function getPublicBlogPosts(
  options: PublicBlogListOptions = {},
): Promise<PublicBlogSummaryDto[]> {
  const category = normalizeBlogCategory(options.category);
  if (options.category !== undefined && !category) {
    return Promise.resolve([]);
  }

  return getBlogListCached(
    category,
    normalizePublicLimit(options.limit, 50, 100),
  );
}

const getBlogPageCached = cache(
  async (
    category: string | null,
    requestedPage: number,
    pageSize: number,
  ): Promise<PublicBlogPageResult> => {
    const now = new Date();
    const where = {
      ...buildPublishedBlogPostWhere(now),
      ...(category ? { category } : {}),
    };
    const total = await getDb().blogPost.count({ where });
    const pagination = buildPagination(total, requestedPage, pageSize);
    const rows = await getDb().blogPost.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      skip: pagination.skip,
      take: pagination.pageSize,
      select: buildPublicBlogSummarySelect(),
    });

    return {
      posts: rows
        .map(mapPublicBlogSummary)
        .filter((post) => post !== null),
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        pageCount: pagination.pageCount,
        total: pagination.total,
      },
    };
  },
);

export function getPublicBlogPage(
  options: PublicBlogPageOptions = {},
): Promise<PublicBlogPageResult> {
  const category = normalizeBlogCategory(options.category);
  const requestedPage = normalizePageOption(options.page);
  const pageSize = normalizePublicLimit(options.pageSize, 12, 48);
  if (options.category !== undefined && !category) {
    const pagination = buildPagination(0, requestedPage, pageSize);
    return Promise.resolve({
      posts: [],
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        pageCount: pagination.pageCount,
        total: pagination.total,
      },
    });
  }

  return getBlogPageCached(category, requestedPage, pageSize);
}

const getBlogPostBySlugCached = cache(
  async (slug: string): Promise<PublicBlogPostDto | null> => {
    const now = new Date();
    const row = await getDb().blogPost.findFirst({
      where: {
        ...buildPublishedBlogPostWhere(now),
        slug,
      },
      select: buildPublicBlogDetailSelect(),
    });

    return row ? mapPublicBlogDetail(row) : null;
  },
);

export function getPublicBlogPostBySlug(
  slug: string,
): Promise<PublicBlogPostDto | null> {
  const normalized = normalizePublicSlug(slug);
  return normalized ? getBlogPostBySlugCached(normalized) : Promise.resolve(null);
}

export async function getPublicBlogPostMetadataData(slug: string) {
  const post = await getPublicBlogPostBySlug(slug);
  if (!post) {
    return null;
  }

  return {
    title: post.seo?.title ?? post.title,
    description: post.seo?.description ?? post.excerpt,
    canonicalUrl: post.seo?.canonicalUrl ?? `/blog/${post.slug}`,
    noIndex: post.seo?.noIndex ?? false,
    noFollow: post.seo?.noFollow ?? false,
    openGraphImage: post.seo?.openGraphImage ?? post.heroImage,
    structuredData: post.seo?.structuredData ?? null,
  };
}

const getBlogSitemapEntriesCached = cache(
  async (): Promise<PublicBlogSitemapEntryDto[]> => {
    const now = new Date();
    const rows = await getDb().blogPost.findMany({
      where: {
        ...buildPublishedBlogPostWhere(now),
        OR: [{ seo: { is: null } }, { seo: { is: { noIndex: false } } }],
      },
      orderBy: [{ slug: "asc" }],
      select: publicBlogSitemapSelect,
    });

    return mapPublicBlogSitemapRows(rows);
  },
);

export function getPublicBlogSitemapEntries(): Promise<
  PublicBlogSitemapEntryDto[]
> {
  return getBlogSitemapEntriesCached();
}
