import { describe, expect, it } from "vitest";

import {
  allProductImageKeys,
  isProductImageKey,
  newProductImageKeyPrefix,
  productImageKey,
  productImageKeyPrefixOf,
  productPublicIdOfKey,
} from "@/server/storage/keys";

const PRODUCT_ID = "386e8555-b8f9-4ea7-a080-8ccf72357963";

describe("newProductImageKeyPrefix", () => {
  it("builds an immutable per-upload prefix under the product", () => {
    const prefix = newProductImageKeyPrefix(PRODUCT_ID);
    expect(prefix).toMatch(
      new RegExp(
        `^products/${PRODUCT_ID}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
        "u",
      ),
    );
  });

  it("never repeats a prefix", () => {
    const prefixes = new Set(
      Array.from({ length: 64 }, () => newProductImageKeyPrefix(PRODUCT_ID)),
    );
    expect(prefixes.size).toBe(64);
  });

  it("normalizes uppercase UUIDs and rejects everything else", () => {
    expect(newProductImageKeyPrefix(PRODUCT_ID.toUpperCase())).toContain(
      `products/${PRODUCT_ID}/`,
    );
    for (const invalid of [
      "",
      "not-a-uuid",
      "../escape",
      `${PRODUCT_ID}/extra`,
      `${PRODUCT_ID} `,
    ]) {
      expect(() => newProductImageKeyPrefix(invalid)).toThrow(/UUID/u);
    }
  });
});

describe("productImageKey", () => {
  const prefix = newProductImageKeyPrefix(PRODUCT_ID);

  it("appends the variant file name", () => {
    expect(productImageKey(prefix, "thumb")).toBe(`${prefix}/thumb.webp`);
  });

  it("rejects tampered prefixes", () => {
    for (const invalid of [
      "products/x/y",
      `products/${PRODUCT_ID}/../secrets`,
      `${prefix}/nested`,
      `other/${PRODUCT_ID}/${PRODUCT_ID}`,
    ]) {
      expect(() => productImageKey(invalid, "thumb")).toThrow(/invalid/u);
    }
  });
});

describe("key predicates", () => {
  const prefix = newProductImageKeyPrefix(PRODUCT_ID);
  const key = productImageKey(prefix, "detail");

  it("recognizes generated keys and their parts", () => {
    expect(isProductImageKey(key)).toBe(true);
    expect(productImageKeyPrefixOf(key)).toBe(prefix);
    expect(productPublicIdOfKey(key)).toBe(PRODUCT_ID);
  });

  it("rejects foreign keys", () => {
    for (const invalid of [
      "",
      "products/a/b/original.webp",
      `${prefix}/original.png`,
      `${prefix}/ORIGINAL.webp`,
      `/${key}`,
      `${key}?query=1`,
    ]) {
      expect(isProductImageKey(invalid)).toBe(false);
      expect(productImageKeyPrefixOf(invalid)).toBeNull();
      expect(productPublicIdOfKey(invalid)).toBeNull();
    }
  });

  it("enumerates all four variant keys", () => {
    expect(allProductImageKeys(prefix)).toEqual([
      `${prefix}/original.webp`,
      `${prefix}/thumb.webp`,
      `${prefix}/card.webp`,
      `${prefix}/detail.webp`,
    ]);
  });
});
