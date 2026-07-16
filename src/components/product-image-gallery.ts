import type { PublicImageDto } from "@/domain/public";
import {
  isRemotePublicAssetUrl,
  sanitizePublicAssetUrl,
} from "@/lib/public-asset-url";

export const MAX_PUBLIC_PRODUCT_GALLERY_IMAGES = 12;

export function isSafePublicImageSource(value: string): boolean {
  return sanitizePublicAssetUrl(value) !== null;
}

export function isRemotePublicImageSource(value: string): boolean {
  return isRemotePublicAssetUrl(value);
}

export function getNextProductGalleryIndex(
  key: string,
  activeIndex: number,
  imageCount: number,
): number | null {
  if (imageCount < 1) return null;

  switch (key) {
    case "ArrowLeft":
    case "ArrowUp":
      return (activeIndex - 1 + imageCount) % imageCount;
    case "ArrowRight":
    case "ArrowDown":
      return (activeIndex + 1) % imageCount;
    case "Home":
      return 0;
    case "End":
      return imageCount - 1;
    default:
      return null;
  }
}

export function preparePublicProductGallery(
  primaryImage: PublicImageDto | null,
  gallery: readonly PublicImageDto[],
): PublicImageDto[] {
  const prepared: PublicImageDto[] = [];
  const seen = new Set<string>();

  for (const image of primaryImage ? [primaryImage, ...gallery] : gallery) {
    const url = sanitizePublicAssetUrl(image.url);
    if (
      prepared.length >= MAX_PUBLIC_PRODUCT_GALLERY_IMAGES ||
      seen.has(image.publicId) ||
      !url
    ) {
      continue;
    }

    seen.add(image.publicId);
    prepared.push(url === image.url ? image : { ...image, url });
  }

  return prepared;
}
