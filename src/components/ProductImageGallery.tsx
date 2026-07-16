"use client";

import Image from "next/image";
import {
  type KeyboardEvent,
  useId,
  useRef,
  useState,
} from "react";

import type { PublicImageDto } from "@/domain/public";
import {
  getNextProductGalleryIndex,
  isRemotePublicImageSource,
  preparePublicProductGallery,
} from "@/components/product-image-gallery";

export function ProductImageGallery({
  images: unboundedImages,
  productTitle,
}: {
  images: readonly PublicImageDto[];
  productTitle: string;
}) {
  const images = preparePublicProductGallery(null, unboundedImages);
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedImageIds, setFailedImageIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const thumbnailRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const galleryId = useId();
  const activeImage = images[activeIndex] ?? images[0] ?? null;

  const markFailed = (publicId: string) =>
    setFailedImageIds((current) => {
      if (current.has(publicId)) return current;
      const next = new Set(current);
      next.add(publicId);
      return next;
    });

  function handleThumbnailKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const nextIndex = getNextProductGalleryIndex(
      event.key,
      index,
      images.length,
    );
    if (nextIndex === null) return;

    event.preventDefault();
    setActiveIndex(nextIndex);
    thumbnailRefs.current[nextIndex]?.focus();
  }

  if (!activeImage) {
    return (
      <div className="grid aspect-square place-items-center rounded-2xl bg-cream-50 text-muted ring-1 ring-ink-900/[0.06]">
        Product image coming soon
      </div>
    );
  }

  const activeTabId = `${galleryId}-tab-${activeIndex}`;
  const panelId = `${galleryId}-panel`;

  return (
    <div aria-label={`${productTitle} image gallery`} role="group">
      <div
        id={panelId}
        role={images.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={images.length > 1 ? activeTabId : undefined}
        className="relative aspect-square overflow-hidden rounded-2xl bg-cream-50 p-6 ring-1 ring-ink-900/[0.06]"
      >
        {failedImageIds.has(activeImage.publicId) ? (
          <div
            role="img"
            aria-label={activeImage.alt}
            className="grid h-full place-items-center text-center text-sm text-muted"
          >
            Image unavailable
          </div>
        ) : (
          <Image
            key={activeImage.publicId}
            src={activeImage.renditions?.detail ?? activeImage.url}
            alt={activeImage.alt}
            unoptimized={isRemotePublicImageSource(
              activeImage.renditions?.detail ?? activeImage.url,
            )}
            fill
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-contain mix-blend-multiply"
            preload={activeIndex === 0}
            onError={() => markFailed(activeImage.publicId)}
          />
        )}
      </div>

      {images.length > 1 ? (
        <div
          role="tablist"
          aria-label={`${productTitle} gallery thumbnails`}
          className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-6"
        >
          {images.map((image, index) => {
            const selected = index === activeIndex;
            return (
              <button
                key={image.publicId}
                ref={(element) => {
                  thumbnailRefs.current[index] = element;
                }}
                id={`${galleryId}-tab-${index}`}
                type="button"
                role="tab"
                aria-controls={panelId}
                aria-selected={selected}
                aria-label={`View image ${index + 1} of ${images.length}: ${image.alt}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveIndex(index)}
                onKeyDown={(event) => handleThumbnailKeyDown(event, index)}
                className={`relative aspect-square overflow-hidden rounded-lg bg-cream-50 ring-2 ring-offset-2 ring-offset-surface transition-colors focus-visible:outline-none focus-visible:ring-sage-500 ${
                  selected
                    ? "ring-sage-500"
                    : "ring-transparent hover:ring-sage-300"
                }`}
              >
                <Image
                  src={image.renditions?.thumb ?? image.url}
                  alt=""
                  unoptimized={isRemotePublicImageSource(
                    image.renditions?.thumb ?? image.url,
                  )}
                  fill
                  sizes="96px"
                  className="object-contain mix-blend-multiply"
                  onError={() => markFailed(image.publicId)}
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
