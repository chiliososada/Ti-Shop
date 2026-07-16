import type { Prisma } from "@/generated/prisma/client";
import {
  publicImageSelect,
  publicSeoSelect,
} from "@/server/catalog/query-contracts";

export function buildPublishedBlogPostWhere(
  now: Date,
): Prisma.BlogPostWhereInput {
  return {
    status: "PUBLISHED",
    deletedAt: null,
    publishedAt: { not: null, lte: now },
  };
}

export function buildPublicBlogSummarySelect() {
  return {
    publicId: true,
    slug: true,
    title: true,
    category: true,
    authorDisplayName: true,
    readingMinutes: true,
    excerpt: true,
    publishedAt: true,
    heroMedia: {
      select: publicImageSelect,
    },
  } as const satisfies Prisma.BlogPostSelect;
}

export function buildPublicBlogDetailSelect() {
  return {
    ...buildPublicBlogSummarySelect(),
    body: true,
    contentData: true,
    format: true,
    updatedAt: true,
    seo: {
      select: publicSeoSelect,
    },
  } as const satisfies Prisma.BlogPostSelect;
}

export const publicBlogSitemapSelect = {
  slug: true,
  updatedAt: true,
  seo: {
    select: {
      canonicalUrl: true,
      updatedAt: true,
    },
  },
} as const satisfies Prisma.BlogPostSelect;

export const publicPageSitemapSelect = {
  slug: true,
  updatedAt: true,
  seo: {
    select: {
      canonicalUrl: true,
      updatedAt: true,
    },
  },
} as const satisfies Prisma.PageSelect;

export type PublicBlogSummaryRow = Prisma.BlogPostGetPayload<{
  select: ReturnType<typeof buildPublicBlogSummarySelect>;
}>;

export type PublicBlogDetailRow = Prisma.BlogPostGetPayload<{
  select: ReturnType<typeof buildPublicBlogDetailSelect>;
}>;

export type PublicBlogSitemapRow = Prisma.BlogPostGetPayload<{
  select: typeof publicBlogSitemapSelect;
}>;

export type PublicPageSitemapRow = Prisma.PageGetPayload<{
  select: typeof publicPageSitemapSelect;
}>;
