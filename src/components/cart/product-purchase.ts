import type { CartProductSnapshot } from "@/components/cart/CartProvider";
import type { PublicProductVariantDto } from "@/domain/catalog";
import type { PublicImageDto } from "@/domain/public";

export function selectInitialPurchaseVariant(
  variants: readonly PublicProductVariantDto[],
) {
  return (
    variants.find((variant) => variant.directPurchaseAvailable) ??
    variants[0] ??
    null
  );
}

export function buildVariantCartSnapshot(
  product: {
    publicId: string;
    slug: string;
    title: string;
  },
  variant: PublicProductVariantDto,
  image: PublicImageDto | null,
): CartProductSnapshot {
  return {
    publicId: product.publicId,
    variantPublicId: variant.publicId,
    slug: product.slug,
    title: product.title,
    variantTitle: variant.title,
    sku: variant.sku,
    // Cart tiles are small; prefer the thumb rendition when available.
    imageUrl: image?.renditions?.thumb ?? image?.url ?? null,
    imageAlt: image?.alt ?? product.title,
    unitAmountMinor: variant.price.amountMinor,
    currency: variant.price.currency,
    minimumOrderQuantity: variant.minimumOrderQuantity,
  };
}
