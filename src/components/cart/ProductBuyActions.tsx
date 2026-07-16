"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CartProductSnapshot } from "./CartProvider";
import { useCart } from "./CartProvider";
import { WhatsAppIntentButton } from "@/components/whatsapp/WhatsAppIntentButton";
import { MAXIMUM_DIRECT_CHECKOUT_QUANTITY } from "@/domain/minimum-order-quantity";

export function ProductBuyActions({
  product,
  directPurchaseAvailable = true,
  productSlug,
  whatsappEnabled,
}: {
  product: CartProductSnapshot | null;
  directPurchaseAvailable?: boolean;
  productSlug: string;
  whatsappEnabled: boolean;
}) {
  const router = useRouter();
  const { add, buyNow, close } = useCart();
  const [qty, setQty] = useState(product?.minimumOrderQuantity ?? 1);

  if (!product) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row">
        <a
          href="/contact"
          className="inline-flex items-center justify-center rounded-full bg-ink-900 px-8 py-4 text-[0.95rem] font-semibold text-cream-50 transition-colors hover:bg-sage-600"
        >
          Request a Quote
        </a>
        {whatsappEnabled ? (
          <WhatsAppIntentButton
            intent={{ templateKey: "product", productSlug }}
            className="inline-flex items-center justify-center rounded-full border border-ink-900/15 px-8 py-4 text-[0.95rem] font-semibold text-strong transition-colors hover:bg-surface-alt disabled:cursor-wait disabled:opacity-70"
          >
            Ask on WhatsApp
          </WhatsAppIntentButton>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      {!directPurchaseAvailable ? (
        <p
          className="mb-3 rounded-lg bg-clay-50 px-4 py-3 text-sm text-clay-600"
          role="status"
        >
          This variant is temporarily unavailable for direct purchase. You can
          still discuss requirements with us.
        </p>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center rounded-full ring-1 ring-ink-900/15">
          <button
            onClick={() =>
              setQty((q) => Math.max(product.minimumOrderQuantity, q - 1))
            }
            disabled={
              !directPurchaseAvailable ||
              qty <= product.minimumOrderQuantity
            }
            aria-label="Decrease quantity"
            className="grid h-12 w-12 place-items-center text-body hover:text-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            −
          </button>
          <span className="w-8 text-center text-sm tabular-nums">{qty}</span>
          <button
            onClick={() =>
              setQty((q) =>
                Math.min(MAXIMUM_DIRECT_CHECKOUT_QUANTITY, q + 1),
              )
            }
            disabled={!directPurchaseAvailable}
            aria-label="Increase quantity"
            className="grid h-12 w-12 place-items-center text-body hover:text-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
        </div>

        <button
          onClick={() => add(product, qty)}
          disabled={!directPurchaseAvailable}
          className="inline-flex flex-1 items-center justify-center rounded-full border border-ink-900/15 px-8 py-4 text-[0.95rem] font-semibold text-strong transition-colors hover:border-ink-900/30 hover:bg-ink-900/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add to cart
        </button>
        <button
          onClick={() => {
            if (!directPurchaseAvailable) return;
            buyNow(product, qty);
            close();
            router.push("/checkout");
          }}
          disabled={!directPurchaseAvailable}
          className="inline-flex flex-1 items-center justify-center rounded-full bg-ink-900 px-8 py-4 text-[0.95rem] font-semibold text-cream-50 transition-colors hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Buy now
        </button>
      </div>
      {product.minimumOrderQuantity > 1 ? (
        <p className="mt-3 text-sm text-muted">
          Minimum direct-purchase quantity: {product.minimumOrderQuantity}.
        </p>
      ) : null}
      {whatsappEnabled ? (
        <div className="mt-3 flex flex-col items-start gap-2">
          <WhatsAppIntentButton
            intent={{ templateKey: "product", productSlug }}
            className="text-sm font-semibold text-sage-700 underline underline-offset-4 disabled:cursor-wait disabled:opacity-70"
          >
            Ask about this product on WhatsApp
          </WhatsAppIntentButton>
        </div>
      ) : null}
    </div>
  );
}
