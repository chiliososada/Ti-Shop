import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProductImageGallery } from "@/components/ProductImageGallery";
import type { PublicImageDto } from "@/domain/public";
import {
  getNextProductGalleryIndex,
  isRemotePublicImageSource,
  isSafePublicImageSource,
  MAX_PUBLIC_PRODUCT_GALLERY_IMAGES,
  preparePublicProductGallery,
} from "@/components/product-image-gallery";

function image(index: number, url = `/products/image-${index}.jpg`): PublicImageDto {
  return {
    publicId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    url,
    alt: `Product view ${index}`,
    width: 800,
    height: 800,
    renditions: null,
  };
}

describe("public product gallery client boundary", () => {
  it("puts the primary image first, deduplicates, and sends a bounded list", () => {
    const primary = image(99);
    const gallery = [primary, ...Array.from({ length: 30 }, (_, index) => image(index))];
    const prepared = preparePublicProductGallery(primary, gallery);

    expect(prepared).toHaveLength(MAX_PUBLIC_PRODUCT_GALLERY_IMAGES);
    expect(prepared[0]).toEqual(primary);
    expect(new Set(prepared.map(({ publicId }) => publicId)).size).toBe(
      MAX_PUBLIC_PRODUCT_GALLERY_IMAGES,
    );
  });

  it("renders an accessible thumbnail tab set and preloads only the initial main image", () => {
    const markup = renderToStaticMarkup(
      createElement(ProductImageGallery, {
        images: [image(1), image(2)],
        productTitle: "Example catalog item",
      }),
    );

    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Example catalog item gallery thumbnails"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('rel="preload"');
    expect(markup).not.toContain("priority");
  });

  it("supports wrapped arrow navigation plus Home and End keyboard controls", () => {
    expect(getNextProductGalleryIndex("ArrowRight", 2, 3)).toBe(0);
    expect(getNextProductGalleryIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(getNextProductGalleryIndex("ArrowDown", 0, 3)).toBe(1);
    expect(getNextProductGalleryIndex("ArrowUp", 1, 3)).toBe(0);
    expect(getNextProductGalleryIndex("Home", 2, 3)).toBe(0);
    expect(getNextProductGalleryIndex("End", 0, 3)).toBe(2);
    expect(getNextProductGalleryIndex("Enter", 0, 3)).toBeNull();
    expect(getNextProductGalleryIndex("ArrowRight", 0, 0)).toBeNull();
  });

  it("renders an allowed HTTPS source directly instead of proxying it through the optimizer", () => {
    const markup = renderToStaticMarkup(
      createElement(ProductImageGallery, {
        images: [image(1, "https://cdn.example/product.jpg")],
        productTitle: "Remote catalog item",
      }),
    );

    expect(markup).toContain('src="https://cdn.example/product.jpg"');
    expect(markup).not.toContain("/_next/image?url=");
  });

  it("allows local paths and HTTPS only, with remote sources marked unoptimized", () => {
    expect(isSafePublicImageSource("/products/local.jpg")).toBe(true);
    expect(isRemotePublicImageSource("/products/local.jpg")).toBe(false);
    expect(isSafePublicImageSource("https://cdn.example/image.jpg")).toBe(true);
    expect(isRemotePublicImageSource("https://cdn.example/image.jpg")).toBe(true);

    for (const unsafe of [
      "http://cdn.example/image.jpg",
      "//cdn.example/image.jpg",
      "javascript:alert(1)",
      "data:image/svg+xml,<svg />",
      "/products/image.jpg\nscript",
    ]) {
      expect(isSafePublicImageSource(unsafe)).toBe(false);
      expect(isRemotePublicImageSource(unsafe)).toBe(false);
    }

    const prepared = preparePublicProductGallery(null, [
      image(1, "http://cdn.example/private-transport.jpg"),
      image(2, "https://cdn.example/public.jpg"),
    ]);
    expect(prepared.map(({ publicId }) => publicId)).toEqual([image(2).publicId]);
  });
});
