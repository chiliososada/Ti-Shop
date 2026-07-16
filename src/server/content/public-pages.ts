import "server-only";

import { cache } from "react";

import type {
  PublicFaqDto,
  PublicPageDto,
  PublicPageSitemapEntryDto,
} from "@/domain/content";
import { normalizePublicSlug } from "@/server/catalog/inputs";
import { publicSeoSelect } from "@/server/catalog/query-contracts";
import { mapPublicSeo, toIsoString } from "@/server/catalog/shared-mappers";
import { mapPublicPageSitemapRows } from "@/server/content/mappers";
import { publicPageSitemapSelect } from "@/server/content/query-contracts";
import { getDb } from "@/server/db/client";

function mapFormat(value: string): PublicPageDto["format"] {
  if (value === "HTML") return "html";
  if (value === "RICH_TEXT") return "rich-text";
  return "markdown";
}

export const getPublicFaqs = cache(async (): Promise<PublicFaqDto[]> => {
  const now = new Date();
  const rows = await getDb().faq.findMany({
    where: {
      status: "PUBLISHED",
      deletedAt: null,
      publishedAt: { not: null, lte: now },
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: 500,
    select: {
      publicId: true,
      slug: true,
      question: true,
      answer: true,
      category: true,
      position: true,
      publishedAt: true,
      updatedAt: true,
    },
  });

  return rows.flatMap((row): PublicFaqDto[] => {
    const publishedAt = toIsoString(row.publishedAt);
    const updatedAt = toIsoString(row.updatedAt);
    if (!publishedAt || !updatedAt) return [];
    return [{ ...row, publishedAt, updatedAt }];
  });
});

export const getPublicPageBySlug = cache(
  async (rawSlug: string): Promise<PublicPageDto | null> => {
    const slug = normalizePublicSlug(rawSlug);
    if (!slug) return null;

    const row = await getDb().page.findFirst({
      where: {
        slug,
        managedRoute: null,
        status: "PUBLISHED",
        deletedAt: null,
        publishedAt: { not: null, lte: new Date() },
      },
      select: {
        publicId: true,
        slug: true,
        title: true,
        body: true,
        format: true,
        publishedAt: true,
        updatedAt: true,
        seo: { select: publicSeoSelect },
      },
    });
    if (!row) return null;

    const publishedAt = toIsoString(row.publishedAt);
    const updatedAt = toIsoString(row.updatedAt);
    if (!publishedAt || !updatedAt) return null;

    return {
      publicId: row.publicId,
      slug: row.slug,
      title: row.title,
      body: row.body,
      format: mapFormat(row.format),
      publishedAt,
      updatedAt,
      seo: mapPublicSeo(row.seo),
    };
  },
);

export async function getPublicPageSitemapEntries(): Promise<
  PublicPageSitemapEntryDto[]
> {
  const rows = await getDb().page.findMany({
    where: {
      managedRoute: null,
      status: "PUBLISHED",
      deletedAt: null,
      publishedAt: { not: null, lte: new Date() },
      OR: [{ seo: { is: null } }, { seo: { is: { noIndex: false } } }],
    },
    orderBy: [{ slug: "asc" }],
    select: publicPageSitemapSelect,
  });

  return mapPublicPageSitemapRows(rows);
}
