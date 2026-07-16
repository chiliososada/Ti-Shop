import type { PublicProductSort } from "@/domain/catalog";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PLACEMENT_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;

export const DEFAULT_PUBLIC_PRODUCT_SORT: PublicProductSort = "recommended";

const PUBLIC_PRODUCT_SORTS = new Set<PublicProductSort>([
  DEFAULT_PUBLIC_PRODUCT_SORT,
  "name-asc",
  "name-desc",
  "newest",
]);

export function normalizePublicProductSort(value: unknown): PublicProductSort {
  return typeof value === "string" &&
    PUBLIC_PRODUCT_SORTS.has(value as PublicProductSort)
    ? (value as PublicProductSort)
    : DEFAULT_PUBLIC_PRODUCT_SORT;
}

export function normalizePublicSlug(
  value: string,
  maximumLength = 220,
): string | null {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > maximumLength ||
    !SLUG_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function normalizePlacementKeys(
  values: readonly string[],
): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()))]
    .filter(
      (value) =>
        value.length > 0 &&
        value.length <= 100 &&
        PLACEMENT_KEY_PATTERN.test(value),
    )
    .sort()
    .slice(0, 20);
}

export function normalizePublicLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(maximum, Math.trunc(value ?? fallback)));
}
