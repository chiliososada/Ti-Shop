"use client";

import Image from "next/image";
import Link from "next/link";
import { formatUsdMinor, useCart } from "./CartProvider";
import { WhatsAppIntentButton } from "@/components/whatsapp/WhatsAppIntentButton";

export function CartDrawer({ whatsappEnabled }: { whatsappEnabled: boolean }) {
  const {
    items,
    isOpen,
    close,
    setQty,
    remove,
    subtotalDisplay,
  } = useCart();

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        className={`fixed inset-0 z-[60] bg-ink-900/40 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden
      />

      {/* Panel */}
      <aside
        className={`fixed right-0 top-0 z-[70] flex h-full w-full max-w-md flex-col bg-base shadow-xl transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-label="Shopping cart"
      >
        <div className="flex items-center justify-between border-b border-ink-900/[0.08] px-6 py-5">
          <h2 className="text-h6 text-strong">Your cart</h2>
          <button
            onClick={close}
            aria-label="Close cart"
            className="grid h-9 w-9 place-items-center rounded-full text-ink-500 hover:bg-surface-alt"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-body">Your cart is empty.</p>
            <Link
              href="/products"
              onClick={close}
              className="rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-cream-50 hover:bg-sage-600"
            >
              Browse products
            </Link>
          </div>
        ) : (
          <>
            <div className="flex-1 divide-y divide-ink-900/[0.06] overflow-y-auto px-6">
              {items.map((line) => {
                const product = line.product;
                return (
                  <div key={line.key} className="flex gap-4 py-5">
                    <Link
                      href={`/products/${product.slug}`}
                      onClick={close}
                      className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-cream-50 ring-1 ring-ink-900/[0.06]"
                    >
                      {product.imageUrl ? (
                        <Image
                          src={product.imageUrl}
                          alt={product.imageAlt}
                          unoptimized={
                            product.imageUrl.startsWith("https://") ||
                            product.imageUrl.startsWith("http://")
                          }
                          fill
                          sizes="80px"
                          className="object-contain p-1 mix-blend-multiply"
                        />
                      ) : (
                        <span className="grid h-full place-items-center text-caption text-muted">
                          No image
                        </span>
                      )}
                    </Link>
                    <div className="flex flex-1 flex-col">
                      <div className="flex justify-between gap-2">
                        <Link
                          href={`/products/${product.slug}`}
                          onClick={close}
                          className="text-sm font-semibold text-strong hover:text-sage-600"
                        >
                          {product.title}
                        </Link>
                        <button
                          onClick={() => remove(line.key)}
                          aria-label="Remove"
                          className="text-caption text-muted hover:text-error"
                        >
                          Remove
                        </button>
                      </div>
                      {product.variantTitle || product.sku ? (
                        <span className="mt-0.5 text-caption text-muted">
                          {product.variantTitle ?? "Selected variant"}
                          {product.sku ? ` · SKU ${product.sku}` : ""}
                        </span>
                      ) : null}
                      <span className="mt-0.5 text-caption text-muted">
                        {formatUsdMinor(product.unitAmountMinor)} / vial
                      </span>
                      <div className="mt-auto flex items-center gap-3 pt-2">
                        <div className="flex items-center rounded-full ring-1 ring-ink-900/15">
                          <button
                            onClick={() => setQty(line.key, line.qty - 1)}
                            aria-label="Decrease quantity"
                            disabled={line.qty <= product.minimumOrderQuantity}
                            className="grid h-8 w-8 place-items-center text-body hover:text-strong disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            −
                          </button>
                          <span className="w-8 text-center text-sm tabular-nums">
                            {line.qty}
                          </span>
                          <button
                            onClick={() => setQty(line.key, line.qty + 1)}
                            aria-label="Increase quantity"
                            className="grid h-8 w-8 place-items-center text-body hover:text-strong"
                          >
                            +
                          </button>
                        </div>
                        <span className="ml-auto text-sm font-semibold text-strong">
                          {formatUsdMinor(
                            (
                              BigInt(product.unitAmountMinor) * BigInt(line.qty)
                            ).toString(),
                          )}
                        </span>
                      </div>
                      {product.minimumOrderQuantity > 1 ? (
                        <span className="mt-1 text-caption text-muted">
                          Minimum {product.minimumOrderQuantity}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-ink-900/[0.08] px-6 py-5">
              <div className="flex items-center justify-between text-strong">
                <span className="text-sm text-muted">Subtotal</span>
                <span className="text-h5">{subtotalDisplay}</span>
              </div>
              <p className="mt-1 text-caption text-muted">
                Displayed product subtotal only. The server rechecks current USD
                prices when an order is created.
              </p>
              <p className="mt-3 rounded-lg bg-surface-alt px-3 py-2 text-caption text-body">
                Checkout requires an email/password account. Creating an order
                does not mark a payment as paid; payment status is confirmed
                separately.
              </p>
              <Link
                href="/checkout"
                onClick={close}
                className="mt-4 flex w-full items-center justify-center rounded-full bg-ink-900 px-6 py-3.5 text-sm font-semibold text-cream-50 transition-colors hover:bg-sage-600"
              >
                Continue to checkout
              </Link>
              {whatsappEnabled ? (
                <WhatsAppIntentButton
                  intent={{
                    templateKey: "cart",
                    lines: items.map((line) => ({
                      productSlug: line.product.slug,
                      variantPublicId: line.product.variantPublicId,
                      quantity: line.qty,
                    })),
                  }}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-ink-900/15 px-6 py-3.5 text-sm font-semibold text-strong transition-colors hover:bg-surface-alt disabled:cursor-wait disabled:opacity-70"
                  fallbackClassName="mt-2 block text-center text-caption font-semibold text-strong underline"
                >
                  Ask about this cart on WhatsApp
                </WhatsAppIntentButton>
              ) : (
                <p className="mt-3 text-center text-caption text-muted">
                  WhatsApp contact is currently unavailable.
                </p>
              )}
              <p className="mt-3 text-center text-caption text-muted">
                Research use only · not for human consumption
              </p>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
