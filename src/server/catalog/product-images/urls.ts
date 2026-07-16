import "server-only";

import { getStorageConfigState } from "@/server/storage/config";
import { isProductImageKey, type ProductImageVariant } from "@/server/storage/keys";

export type ProductImageRenditionUrls = {
  original: string;
  thumb: string;
  card: string;
  detail: string;
};

type StoredVariantRecord = Partial<
  Record<ProductImageVariant, { key?: unknown; width?: unknown; height?: unknown }>
>;

function storedKey(record: StoredVariantRecord, variant: ProductImageVariant): string | null {
  const key = record[variant]?.key;
  return typeof key === "string" && isProductImageKey(key) ? key : null;
}

export function storedVariantDimensions(
  variants: unknown,
  variant: ProductImageVariant,
): { width: number; height: number } | null {
  const record = (variants ?? null) as StoredVariantRecord | null;
  const entry = record?.[variant];
  const width = Number(entry?.width);
  const height = Number(entry?.height);
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0
    ? { width, height }
    : null;
}

/**
 * Resolves the rendition URL set for a media row.
 *
 * - Storage-backed rows derive URLs from the immutable object keys and the
 *   runtime public base URL, so a future CDN/base change needs no data fix.
 * - Legacy rows (no variants) fall back to the single stored publicUrl for
 *   every rendition, preserving existing behavior.
 */
export function productImageRenditionUrls(input: {
  publicUrl: string | null;
  variants: unknown;
}): ProductImageRenditionUrls | null {
  const record = (input.variants ?? null) as StoredVariantRecord | null;
  if (record) {
    const state = getStorageConfigState();
    if (state.configured) {
      const base = state.env.publicBaseUrl;
      const original = storedKey(record, "original");
      const thumb = storedKey(record, "thumb");
      const card = storedKey(record, "card");
      const detail = storedKey(record, "detail");
      if (original && thumb && card && detail) {
        return {
          original: `${base}/${original}`,
          thumb: `${base}/${thumb}`,
          card: `${base}/${card}`,
          detail: `${base}/${detail}`,
        };
      }
    }
  }

  if (input.publicUrl) {
    return {
      original: input.publicUrl,
      thumb: input.publicUrl,
      card: input.publicUrl,
      detail: input.publicUrl,
    };
  }
  return null;
}
