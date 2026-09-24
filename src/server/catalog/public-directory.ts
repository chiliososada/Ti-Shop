import "server-only";

import { cache } from "react";

import type { PublicProductSummaryDto } from "@/domain/catalog";
import { getDb } from "@/server/db/client";

import { normalizePublicSlug } from "./inputs";
import { mapPublicProductSummary } from "./mappers";
import {
  buildPublicProductSummarySelect,
  buildPublishedProductWhere,
} from "./query-contracts";

const MAX_SLUG_LOOKUP = 50;

const getDirectoryCached = cache(
  async (): Promise<PublicProductSummaryDto[]> => {
    const now = new Date();
    const rows = await getDb().product.findMany({
      where: buildPublishedProductWhere(now),
      orderBy: [{ position: "asc" }, { title: "asc" }, { id: "asc" }],
      select: buildPublicProductSummarySelect(now),
    });
    return rows.map((row) => mapPublicProductSummary(row, now));
  },
);

/** Every published listing, for the A–Z material directory. */
export function getPublicProductDirectory(): Promise<PublicProductSummaryDto[]> {
  return getDirectoryCached();
}

const getBySlugsCached = cache(
  async (serializedSlugs: string): Promise<PublicProductSummaryDto[]> => {
    const slugs = serializedSlugs.split(",").filter(Boolean);
    if (!slugs.length) return [];
    const now = new Date();
    const rows = await getDb().product.findMany({
      where: { ...buildPublishedProductWhere(now), slug: { in: slugs } },
      select: buildPublicProductSummarySelect(now),
    });
    const bySlug = new Map(
      rows.map((row) => [row.slug, mapPublicProductSummary(row, now)]),
    );
    return slugs.flatMap((slug) => {
      const product = bySlug.get(slug);
      return product ? [product] : [];
    });
  },
);

/** Published listings for the given slugs, in the requested order. */
export function getPublicProductsBySlugs(
  slugs: readonly string[],
): Promise<PublicProductSummaryDto[]> {
  const normalized = [
    ...new Set(
      slugs
        .map((slug) => normalizePublicSlug(slug, 220))
        .filter((slug): slug is string => slug !== null),
    ),
  ].slice(0, MAX_SLUG_LOOKUP);
  return getBySlugsCached(normalized.join(","));
}
