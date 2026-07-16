import { randomUUID } from "node:crypto";

export const PRODUCT_IMAGE_VARIANTS = ["original", "thumb", "card", "detail"] as const;

export type ProductImageVariant = (typeof PRODUCT_IMAGE_VARIANTS)[number];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

// Whole-key grammar: fixed prefix, two UUID path segments, a known variant
// file name, and a webp extension. Anything else is rejected, which rules out
// traversal, encoded separators, and injected delimiters by construction.
const PRODUCT_IMAGE_KEY_PATTERN =
  /^products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(original|thumb|card|detail)\.webp$/u;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Immutable, non-guessable object key prefix for one uploaded image. A new
 * upload always gets a fresh UUID directory, so keys are never overwritten
 * and stale CDN entries can never shadow a replacement image.
 */
export function newProductImageKeyPrefix(productPublicId: string): string {
  const normalizedProduct = productPublicId.toLowerCase();
  if (!isUuid(normalizedProduct)) {
    throw new Error("productPublicId must be a UUID");
  }
  return `products/${normalizedProduct}/${randomUUID()}`;
}

export function productImageKey(
  prefix: string,
  variant: ProductImageVariant,
): string {
  const key = `${prefix}/${variant}.webp`;
  if (!PRODUCT_IMAGE_KEY_PATTERN.test(key)) {
    throw new Error("invalid product image key prefix");
  }
  return key;
}

export function isProductImageKey(key: string): boolean {
  return PRODUCT_IMAGE_KEY_PATTERN.test(key);
}

/** products/<productId>/<imageId>/original.webp -> products/<productId>/<imageId> */
export function productImageKeyPrefixOf(key: string): string | null {
  if (!PRODUCT_IMAGE_KEY_PATTERN.test(key)) {
    return null;
  }
  return key.slice(0, key.lastIndexOf("/"));
}

export function productPublicIdOfKey(key: string): string | null {
  if (!PRODUCT_IMAGE_KEY_PATTERN.test(key)) {
    return null;
  }
  return key.split("/")[1] ?? null;
}

export function allProductImageKeys(prefix: string): string[] {
  return PRODUCT_IMAGE_VARIANTS.map((variant) => productImageKey(prefix, variant));
}
