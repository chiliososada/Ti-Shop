"use client";

import { useState } from "react";

import { ProductBuyActions } from "@/components/cart/ProductBuyActions";
import {
  buildVariantCartSnapshot,
  selectInitialPurchaseVariant,
} from "@/components/cart/product-purchase";
import type {
  PublicProductDetailDto,
  PublicProductVariantDto,
} from "@/domain/catalog";
import type { PublicImageDto } from "@/domain/public";

type PurchaseProduct = Pick<
  PublicProductDetailDto,
  "publicId" | "slug" | "title" | "subtitle" | "variants"
>;

function variantOptionLabel(variant: PublicProductVariantDto) {
  return [
    variant.title,
    variant.sku ? `SKU ${variant.sku}` : null,
    variant.price.display,
    variant.directPurchaseAvailable ? null : "temporarily unavailable",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ProductPurchasePanel({
  product,
  primaryImage,
  whatsappEnabled,
}: {
  product: PurchaseProduct;
  primaryImage: PublicImageDto | null;
  whatsappEnabled: boolean;
}) {
  const initialVariant = selectInitialPurchaseVariant(product.variants);
  const [selectedPublicId, setSelectedPublicId] = useState(
    initialVariant?.publicId ?? "",
  );
  const selectedVariant =
    product.variants.find(
      (variant) => variant.publicId === selectedPublicId,
    ) ?? initialVariant;

  if (!selectedVariant) {
    return (
      <div>
        <div className="flex items-end gap-4">
          <span className="text-h4 text-sage-600">Pricing on request</span>
        </div>
        <div className="mt-6">
          <ProductBuyActions
            product={null}
            productSlug={product.slug}
            whatsappEnabled={whatsappEnabled}
          />
        </div>
      </div>
    );
  }

  const cartProduct = buildVariantCartSnapshot(
    product,
    selectedVariant,
    primaryImage,
  );
  const selectorId = `variant-${product.publicId}`;

  return (
    <div>
      {product.variants.length > 1 ? (
        <label
          htmlFor={selectorId}
          className="mb-5 block text-sm font-semibold text-strong"
        >
          Select variant
          <select
            id={selectorId}
            value={selectedVariant.publicId}
            onChange={(event) => setSelectedPublicId(event.target.value)}
            className="mt-2 block w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 font-normal text-strong outline-none focus:border-sage-500"
          >
            {product.variants.map((variant) => (
              <option key={variant.publicId} value={variant.publicId}>
                {variantOptionLabel(variant)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div aria-live="polite">
        <div className="flex items-end gap-4">
          <span className="text-h2 text-strong">
            {selectedVariant.price.display}
          </span>
        </div>
        {product.subtitle ? (
          <p className="mt-2 text-sm text-muted">
            Price applies to the listed supplier presentation: {product.subtitle}.
          </p>
        ) : null}
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-surface-alt px-3 py-2">
            <dt className="text-caption text-muted">SKU</dt>
            <dd className="mt-0.5 font-mono text-strong">
              {selectedVariant.sku ?? "Not listed"}
            </dd>
          </div>
          <div className="rounded-lg bg-surface-alt px-3 py-2">
            <dt className="text-caption text-muted">Minimum order</dt>
            <dd className="mt-0.5 font-semibold text-strong">
              {selectedVariant.minimumOrderQuantity}
            </dd>
          </div>
          <div className="rounded-lg bg-surface-alt px-3 py-2">
            <dt className="text-caption text-muted">Availability</dt>
            <dd
              className={`mt-0.5 font-semibold ${
                selectedVariant.directPurchaseAvailable
                  ? "text-sage-700"
                  : "text-clay-600"
              }`}
            >
              {selectedVariant.directPurchaseAvailable
                ? "Available to order"
                : "Temporarily unavailable"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-6">
        <ProductBuyActions
          key={selectedVariant.publicId}
          product={cartProduct}
          directPurchaseAvailable={
            selectedVariant.directPurchaseAvailable
          }
          productSlug={product.slug}
          whatsappEnabled={whatsappEnabled}
        />
      </div>
      <p className="mt-3 text-caption leading-relaxed text-muted">
        Availability is a conservative minimum-order indication. Current
        price and reservable inventory are checked again by the server for the
        selected quantity when the order is created.
      </p>
    </div>
  );
}
