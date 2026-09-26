import type { PublicProductSummaryDto } from "@/domain/catalog";
import { HUB_MIN_LISTINGS, materialSlug } from "@/lib/material-hubs";
import {
  compareStrengths,
  familyFromTitle,
  getCatalogSpecification,
} from "@/lib/catalog-specifications";

export type MaterialDirectoryItem = {
  title: string;
  href: string;
  strength: string | null;
  code: string | null;
  packCount: number | null;
  price: string | null;
};

export type MaterialDirectoryGroup = {
  family: string;
  letter: string;
  /** Hub page URL when the material has several published strengths. */
  hubHref: string | null;
  items: MaterialDirectoryItem[];
};

/**
 * Groups published listings by material family for the A–Z directory. The
 * database decides what is published and at which price; the reviewed price
 * list supplies family names, strengths and product codes.
 */
export function materialDirectory(
  products: readonly PublicProductSummaryDto[],
): MaterialDirectoryGroup[] {
  const groups = new Map<string, MaterialDirectoryItem[]>();
  for (const product of products) {
    const specification = getCatalogSpecification(product.slug);
    const family = specification?.family ?? familyFromTitle(product.title);
    const items = groups.get(family) ?? [];
    items.push({
      title: product.title,
      href: `/products/${product.slug}`,
      strength: specification?.strength ?? null,
      code: specification?.codes.join(" / ") ?? null,
      packCount: specification?.packCount ?? null,
      price: product.price?.display ?? null,
    });
    groups.set(family, items);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
    .map(([family, items]) => ({
      family,
      letter: /^[a-z]/iu.test(family) ? family[0].toUpperCase() : "0–9",
      hubHref:
        items.length >= HUB_MIN_LISTINGS
          ? `/research-materials/${materialSlug(family)}`
          : null,
      items: items.sort((a, b) =>
        a.strength && b.strength
          ? compareStrengths(a.strength, b.strength)
          : a.title.localeCompare(b.title, "en", { numeric: true }),
      ),
    }));
}
