import Image from "next/image";
import Link from "next/link";
import type { PublicProductSummaryDto } from "@/domain/catalog";
import {
  isRemotePublicAssetUrl,
  sanitizePublicAssetUrl,
} from "@/lib/public-asset-url";

export function ProductCard({
  product,
}: {
  product: PublicProductSummaryDto;
}) {
  // Storage-backed images ship a card-sized rendition; legacy media falls
  // back to the single original URL.
  const imageUrl = sanitizePublicAssetUrl(
    product.primaryImage?.renditions?.card ?? product.primaryImage?.url ?? null,
  );

  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl bg-surface-warm ring-1 ring-ink-900/[0.06] transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
    >
      <div className="relative aspect-square overflow-hidden bg-cream-50 p-3">
        {product.primaryImage && imageUrl ? (
          <Image
            src={imageUrl}
            alt={product.primaryImage.alt}
            unoptimized={isRemotePublicAssetUrl(imageUrl)}
            fill
            sizes="(max-width: 768px) 50vw, 25vw"
            className="object-contain mix-blend-multiply transition-transform duration-700 group-hover:scale-[1.05]"
          />
        ) : (
          <div className="grid h-full place-items-center text-center text-caption text-muted">
            Product image coming soon
          </div>
        )}
        {product.purity ? (
          <span className="absolute left-3.5 top-3.5 rounded-full bg-cream-50/90 px-2.5 py-1 text-caption font-semibold text-sage-700 backdrop-blur-sm ring-1 ring-sage-500/20">
            Catalog: {product.purity}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-h6 text-strong">{product.title}</h3>
        <p className="mt-1.5 line-clamp-2 flex-1 text-sm leading-relaxed text-muted">
          {product.shortDescription ?? product.subtitle}
        </p>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-strong">
            {product.price ? (
              <>
                {product.price.display}
                <span className="font-normal text-muted"> / vial</span>
              </>
            ) : (
              <span className="text-sage-600">Request quote</span>
            )}
          </span>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-ink-900 text-cream-50 transition-all duration-300 group-hover:bg-sage-600">
            <svg
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
        </div>
      </div>
    </Link>
  );
}
