"use client";

import type { FormEvent } from "react";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { formatUsdMinor, useCart } from "@/components/cart/CartProvider";
import { WhatsAppIntentButton } from "@/components/whatsapp/WhatsAppIntentButton";
import type {
  CheckoutPaymentMethod,
  EnabledPaymentMethodDto,
} from "@/domain/order";

type CheckoutResponse = {
  nextAction?: { orderUrl?: string };
  order?: { publicId?: string };
  payment?: { publicId?: string; method?: CheckoutPaymentMethod };
  error?: string;
  contactWhatsApp?: boolean;
};

type PaymentInitializationResponse = {
  checkoutUrl?: string;
};

function requiredValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function optionalValue(formData: FormData, name: string) {
  const value = requiredValue(formData, name);
  return value || undefined;
}

export function CheckoutForm({
  customerEmail,
  paymentMethods,
  checkoutCharges,
  defaultShippingAddress,
  whatsappEnabled,
}: {
  customerEmail: string;
  paymentMethods: EnabledPaymentMethodDto[];
  checkoutCharges: {
    shippingFlatMinor: string;
    taxRateBps: number;
  } | null;
  defaultShippingAddress: {
    recipientName: string;
    company: string | null;
    line1: string;
    line2: string | null;
    city: string;
    region: string;
    postalCode: string;
    phone: string | null;
  } | null;
  whatsappEnabled: boolean;
}) {
  const router = useRouter();
  const { items, subtotalDisplay, clear } = useCart();
  const idempotencyKey = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerWhatsApp, setOfferWhatsApp] = useState(false);
  const displayedSubtotalMinor = items.reduce(
    (sum, line) =>
      sum + BigInt(line.product.unitAmountMinor) * BigInt(line.qty),
    BigInt(0),
  );
  const displayedShippingMinor = checkoutCharges
    ? BigInt(checkoutCharges.shippingFlatMinor)
    : BigInt(0);
  const displayedTaxMinor = checkoutCharges
    ? (displayedSubtotalMinor * BigInt(checkoutCharges.taxRateBps) +
        BigInt(5_000)) /
      BigInt(10_000)
    : BigInt(0);
  const displayedTotalMinor =
    displayedSubtotalMinor + displayedShippingMinor + displayedTaxMinor;

  function resetRetryKey() {
    idempotencyKey.current = null;
    setError(null);
    setOfferWhatsApp(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      items.length === 0 ||
      paymentMethods.length === 0 ||
      !checkoutCharges
    )
      return;

    setPending(true);
    setError(null);
    setOfferWhatsApp(false);
    idempotencyKey.current ??= crypto.randomUUID();

    const formData = new FormData(event.currentTarget);
    const payload = {
      idempotencyKey: idempotencyKey.current,
      items: items.map((line) => ({
        variantPublicId: line.product.variantPublicId,
        quantity: line.qty,
      })),
      shippingAddress: {
        recipientName: requiredValue(formData, "recipientName"),
        company: optionalValue(formData, "company"),
        line1: requiredValue(formData, "line1"),
        line2: optionalValue(formData, "line2"),
        city: requiredValue(formData, "city"),
        region: requiredValue(formData, "region").toUpperCase(),
        postalCode: requiredValue(formData, "postalCode"),
        countryCode: "US" as const,
        phone: optionalValue(formData, "phone"),
      },
      paymentMethod: requiredValue(
        formData,
        "paymentMethod",
      ) as CheckoutPaymentMethod,
    };

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as CheckoutResponse;

      if (!response.ok || !result.nextAction?.orderUrl) {
        setError(
          result.error ??
            "The order could not be created. No payment has been confirmed.",
        );
        setOfferWhatsApp(
          whatsappEnabled && result.contactWhatsApp === true,
        );
        return;
      }

      clear();

      if (
        result.payment?.method === "NOWPAYMENTS" &&
        result.order?.publicId &&
        result.payment.publicId
      ) {
        try {
          const paymentResponse = await fetch(
            `/api/orders/${encodeURIComponent(result.order.publicId)}/payments/${encodeURIComponent(result.payment.publicId)}/nowpayments`,
            {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
            },
          );
          const paymentResult =
            (await paymentResponse.json()) as PaymentInitializationResponse;
          if (paymentResponse.ok && paymentResult.checkoutUrl) {
            window.location.assign(paymentResult.checkoutUrl);
            return;
          }
        } catch {
          // The order already exists. Its authenticated detail page provides a
          // safe retry path without creating another order.
        }
      }

      router.push(result.nextAction.orderUrl);
      router.refresh();
    } catch {
      setError(
        "The checkout service could not be reached. Retry without changing the form; the same retry key will be used.",
      );
      setOfferWhatsApp(whatsappEnabled);
    } finally {
      setPending(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-ink-900/[0.08] bg-surface p-8 text-center">
        <h2 className="text-h4 text-strong">Your cart is empty</h2>
        <p className="mt-3 text-body">Add a fixed-price product before checkout.</p>
        <Link
          href="/products"
          className="mt-6 inline-flex rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-cream-50 hover:bg-sage-600"
        >
          Browse products
        </Link>
      </div>
    );
  }

  return (
    <form
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]"
      onSubmit={handleSubmit}
      onChange={resetRetryKey}
    >
      <div className="space-y-6">
        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <p className="font-mono text-eyebrow uppercase text-sage-600">
            Signed-in customer
          </p>
          <h2 className="mt-3 text-h4 text-strong">Shipping address</h2>
          <p className="mt-2 text-sm text-muted">
            Order updates will be associated with {customerEmail}. United States
            addresses and USD are currently supported.
          </p>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="text-sm font-semibold text-strong">Recipient name</span>
              <input
                name="recipientName"
                required
                maxLength={255}
                autoComplete="name"
                defaultValue={defaultShippingAddress?.recipientName ?? ""}
                className="mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 outline-none focus:border-sage-500"
              />
            </label>
            <label className="sm:col-span-2">
              <span className="text-sm font-semibold text-strong">Company (optional)</span>
              <input
                name="company"
                maxLength={255}
                autoComplete="organization"
                defaultValue={defaultShippingAddress?.company ?? ""}
                className="mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 outline-none focus:border-sage-500"
              />
            </label>
            <label className="sm:col-span-2">
              <span className="text-sm font-semibold text-strong">Street address</span>
              <input
                name="line1"
                required
                maxLength={255}
                autoComplete="address-line1"
                defaultValue={defaultShippingAddress?.line1 ?? ""}
                className="mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 outline-none focus:border-sage-500"
              />
            </label>
            <label className="sm:col-span-2">
              <span className="text-sm font-semibold text-strong">Unit / suite (optional)</span>
              <input
                name="line2"
                maxLength={255}
                autoComplete="address-line2"
                defaultValue={defaultShippingAddress?.line2 ?? ""}
                className="mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 outline-none focus:border-sage-500"
              />
            </label>
            <label>
              <span className="text-sm font-semibold text-strong">City</span>
              <input
                name="city"
                required
                maxLength={120}
                autoComplete="address-level2"
                defaultValue={defaultShippingAddress?.city ?? ""}
                className="mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 outline-none focus:border-sage-500"
              />
            </label>
            <label>
              <span className="text-sm font-semibold text-strong">State code</span>
              <input
                name="region"
                required
                minLength={2}
                maxLength={2}
                pattern="[A-Za-z]{2}"
                placeholder="CA"
                autoComplete="address-level1"
                defaultValue={defaultShippingAddress?.region ?? ""}
                className="mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 uppercase outline-none focus:border-sage-500"
              />
            </label>
            <label>
              <span className="text-sm font-semibold text-strong">ZIP code</span>
              <input
                name="postalCode"
                required
                pattern="[0-9]{5}(-[0-9]{4})?"
                maxLength={10}
                autoComplete="postal-code"
                defaultValue={defaultShippingAddress?.postalCode ?? ""}
                className="mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 outline-none focus:border-sage-500"
              />
            </label>
            <label>
              <span className="text-sm font-semibold text-strong">Phone (optional)</span>
              <input
                name="phone"
                type="tel"
                maxLength={32}
                autoComplete="tel"
                defaultValue={defaultShippingAddress?.phone ?? ""}
                className="mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 outline-none focus:border-sage-500"
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <h2 className="text-h4 text-strong">Payment arrangement</h2>
          {paymentMethods.length ? (
            <div className="mt-5 space-y-3">
              {paymentMethods.map((method, index) => (
                <label
                  key={method.method}
                  className="flex cursor-pointer gap-3 rounded-xl border border-ink-900/10 p-4"
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={method.method}
                    defaultChecked={index === 0}
                    required
                    className="mt-1 accent-sage-600"
                  />
                  <span>
                    <span className="block font-semibold text-strong">
                      {method.displayName}
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted">
                      {method.method === "NOWPAYMENTS"
                        ? "After the order is validated, you will be sent to NOWPayments. The order is paid only after the provider reports a finished status."
                        : whatsappEnabled
                          ? "Instructions are shown only on your authenticated order page and may be discussed through the configured WhatsApp handoff."
                          : "Instructions are shown only on your authenticated order page."}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="mt-5 rounded-xl bg-clay-50 p-4 text-sm leading-relaxed text-clay-600">
              No payment method is currently enabled. An order cannot be created
              until an administrator enables a configured method.
            </p>
          )}
        </section>
      </div>

      <aside className="h-fit rounded-2xl border border-ink-900/[0.08] bg-surface p-6 lg:sticky lg:top-24">
        <h2 className="text-h4 text-strong">Order review</h2>
        <div className="mt-5 divide-y divide-ink-900/[0.06]">
          {items.map((line) => (
            <div key={line.key} className="flex justify-between gap-4 py-4 text-sm">
              <span className="text-body">
                {line.qty} × {line.product.title}
                {line.product.variantTitle
                  ? ` — ${line.product.variantTitle}`
                  : ""}
                {line.product.sku ? ` · SKU ${line.product.sku}` : ""}
                {line.product.minimumOrderQuantity > 1
                  ? ` (minimum ${line.product.minimumOrderQuantity})`
                  : ""}
              </span>
              <span className="shrink-0 font-semibold text-strong">
                {formatUsdMinor(
                  (BigInt(line.product.unitAmountMinor) * BigInt(line.qty)).toString(),
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-between border-t border-ink-900/10 pt-5">
          <span className="text-sm text-muted">Merchandise subtotal</span>
          <span className="text-h5 text-strong">{subtotalDisplay}</span>
        </div>
        {checkoutCharges ? (
          <div className="mt-4 space-y-2 border-t border-ink-900/10 pt-4 text-sm">
            <div className="flex justify-between gap-4 text-body">
              <span>Configured US shipping</span>
              <span>{formatUsdMinor(displayedShippingMinor.toString())}</span>
            </div>
            <div className="flex justify-between gap-4 text-body">
              <span>
                Configured tax ({(checkoutCharges.taxRateBps / 100).toFixed(2)}%)
              </span>
              <span>{formatUsdMinor(displayedTaxMinor.toString())}</span>
            </div>
            <div className="flex justify-between gap-4 border-t border-ink-900/10 pt-3 font-semibold text-strong">
              <span>Displayed total</span>
              <span>{formatUsdMinor(displayedTotalMinor.toString())}</span>
            </div>
            <p className="pt-1 text-caption leading-relaxed text-muted">
              The configured tax rate applies to the merchandise subtotal. The
              server rechecks prices and recomputes every amount before creating
              the order.
            </p>
          </div>
        ) : (
          <p className="mt-4 rounded-xl bg-clay-50 p-4 text-sm leading-relaxed text-clay-600">
            Checkout is paused until an administrator explicitly configures US
            shipping and tax charges. No zero charge is assumed.
          </p>
        )}

        {error ? (
          <div className="mt-5 rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error" role="alert">
            <p>{error}</p>
            {offerWhatsApp ? (
              <span className="mt-3 flex flex-col items-start gap-2">
                <WhatsAppIntentButton
                  intent={{
                    templateKey: "cart",
                    lines: items.map((line) => ({
                      productSlug: line.product.slug,
                      variantPublicId: line.product.variantPublicId,
                      quantity: line.qty,
                    })),
                  }}
                  className="font-semibold underline disabled:cursor-wait disabled:opacity-70"
                >
                  Discuss this cart on WhatsApp
                </WhatsAppIntentButton>
              </span>
            ) : null}
          </div>
        ) : null}

        <label className="mt-5 flex gap-3 text-sm leading-relaxed text-body">
          <input type="checkbox" required className="mt-1 accent-sage-600" />
          <span>I confirm these products are for research use only.</span>
        </label>
        <button
          type="submit"
          disabled={
            pending || paymentMethods.length === 0 || !checkoutCharges
          }
          className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-ink-900 px-6 py-3.5 text-sm font-semibold text-cream-50 transition hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Creating order…" : "Create pending order"}
        </button>
        <p className="mt-3 text-center text-caption text-muted">
          This button does not mark any payment as paid.
        </p>
      </aside>
    </form>
  );
}
