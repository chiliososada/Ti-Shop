import "server-only";

import { cache } from "react";

import type { PublicProductDetailDto } from "@/domain/catalog";
import {
  familyFromTitle,
  getCatalogSpecification,
} from "@/lib/catalog-specifications";
import type { MaterialListing } from "@/lib/material-hubs";
import { getDb } from "@/server/db/client";

import { mapPublicProductDetail } from "./mappers";
import {
  buildPublicProductDetailSelect,
  buildPublishedProductWhere,
} from "./query-contracts";

/**
 * Published listings with price and availability for material hubs and
 * /llms-full.txt. Publication, price and stock come from the database; the
 * reviewed price list supplies family, strength, pack size and codes.
 */
export function toMaterialListing(product: PublicProductDetailDto): MaterialListing {
  const specification = getCatalogSpecification(product.slug);
  const category = product.primaryCategory ?? product.categories[0] ?? null;
  const amountMinor = product.price?.amountMinor;
  return {
    slug: product.slug,
    title: product.title,
    family: specification?.family ?? familyFromTitle(product.title),
    strength: specification?.strength ?? "",
    codes: specification?.codes ?? [],
    packCount: specification?.packCount ?? 10,
    categorySlug: category?.slug ?? null,
    categoryName: category?.name ?? null,
    priceMinor: amountMinor && /^\d+$/u.test(amountMinor) ? Number(amountMinor) : null,
    available: product.variants.some((variant) => variant.directPurchaseAvailable),
    updatedAt: product.updatedAt,
    image: product.primaryImage?.url ?? null,
  };
}

const getListingsCached = cache(
  async (serializedSlugs: string | null): Promise<MaterialListing[]> => {
    const now = new Date();
    const slugs = serializedSlugs?.split(",").filter(Boolean) ?? null;
    if (slugs && !slugs.length) return [];
    const rows = await getDb().product.findMany({
      where: {
        ...buildPublishedProductWhere(now),
        ...(slugs ? { slug: { in: slugs } } : {}),
      },
      orderBy: [{ position: "asc" }, { title: "asc" }, { id: "asc" }],
      select: buildPublicProductDetailSelect(now),
    });
    return rows
      .map((row) => mapPublicProductDetail(row, now))
      .filter((product): product is PublicProductDetailDto => product !== null)
      .map(toMaterialListing);
  },
);

/** Every published listing, or only the given slugs. */
export function getPublicMaterialListings(
  slugs?: readonly string[],
): Promise<MaterialListing[]> {
  return getListingsCached(slugs ? [...new Set(slugs)].sort().join(",") : null);
}
