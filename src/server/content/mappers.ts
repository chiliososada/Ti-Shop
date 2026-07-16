import type {
  PublicBlogPostDto,
  PublicBlogSitemapEntryDto,
  PublicBlogSummaryDto,
  PublicPageSitemapEntryDto,
} from "@/domain/content";
import { normalizeCanonicalUrl } from "@/lib/canonical-url";
import {
  mapPublicImage,
  mapPublicSeo,
  toIsoString,
} from "@/server/catalog/shared-mappers";
import type {
  PublicBlogDetailRow,
  PublicBlogSitemapRow,
  PublicBlogSummaryRow,
  PublicPageSitemapRow,
} from "@/server/content/query-contracts";
import { parseLegacyBlogContent } from "@/server/content/legacy-content";

function mapBlogFormat(
  value: string,
): PublicBlogPostDto["format"] {
  if (value === "HTML") {
    return "html";
  }
  if (value === "RICH_TEXT") {
    return "rich-text";
  }
  return "markdown";
}

export function mapPublicBlogSummary(
  row: PublicBlogSummaryRow,
): PublicBlogSummaryDto | null {
  const publishedAt = toIsoString(row.publishedAt);
  if (!publishedAt) {
    return null;
  }

  return {
    publicId: row.publicId,
    slug: row.slug,
    title: row.title,
    category: row.category,
    author: row.authorDisplayName,
    readingMinutes: row.readingMinutes,
    excerpt: row.excerpt,
    heroImage: mapPublicImage(row.heroMedia, row.title),
    publishedAt,
  };
}

export function mapPublicBlogDetail(
  row: PublicBlogDetailRow,
): PublicBlogPostDto | null {
  const summary = mapPublicBlogSummary(row);
  const updatedAt = toIsoString(row.updatedAt);
  if (!summary || !updatedAt) {
    return null;
  }

  return {
    ...summary,
    body: row.body,
    format: mapBlogFormat(row.format),
    structuredContent: parseLegacyBlogContent(row.contentData),
    updatedAt,
    seo: mapPublicSeo(row.seo),
  };
}

export function mapPublicBlogSitemapRows(
  rows: readonly PublicBlogSitemapRow[],
): PublicBlogSitemapEntryDto[] {
  return rows
    .map((row): PublicBlogSitemapEntryDto | null => {
      const lastModified = toIsoString(
        row.seo && row.seo.updatedAt > row.updatedAt
          ? row.seo.updatedAt
          : row.updatedAt,
      );
      if (!lastModified) {
        return null;
      }
      return {
        kind: "blog",
        slug: row.slug,
        path: `/blog/${encodeURIComponent(row.slug)}`,
        canonicalUrl: row.seo?.canonicalUrl
          ? normalizeCanonicalUrl(row.seo.canonicalUrl)
          : null,
        lastModified,
      };
    })
    .filter((entry) => entry !== null);
}

export function mapPublicPageSitemapRows(
  rows: readonly PublicPageSitemapRow[],
): PublicPageSitemapEntryDto[] {
  return rows
    .map((row): PublicPageSitemapEntryDto | null => {
      const lastModified = toIsoString(
        row.seo && row.seo.updatedAt > row.updatedAt
          ? row.seo.updatedAt
          : row.updatedAt,
      );
      if (!lastModified) return null;

      return {
        kind: "page",
        slug: row.slug,
        path: `/pages/${encodeURIComponent(row.slug)}`,
        canonicalUrl: row.seo?.canonicalUrl
          ? normalizeCanonicalUrl(row.seo.canonicalUrl)
          : null,
        lastModified,
      };
    })
    .filter((entry) => entry !== null);
}
