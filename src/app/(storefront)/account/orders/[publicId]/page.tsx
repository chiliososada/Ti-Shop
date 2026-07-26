import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { formatUsdMinor } from "@/domain/money";
import {
  humanizeCommerceStatus,
  PAYMENT_METHOD_LABELS,
} from "@/domain/order";
import { WhatsAppIntentButton } from "@/components/whatsapp/WhatsAppIntentButton";
import { getCurrentUserOrder } from "@/server/orders/queries";
import { getPublicWhatsAppPresentation } from "@/server/whatsapp/config";

import { NowPaymentsCheckoutButton } from "./NowPaymentsCheckoutButton";
import { DISPLAY_TIME_ZONE } from "@/lib/display-timezone";

export const metadata: Metadata = {
  title: "Order details",
  robots: { index: false, follow: false },
};

function formatDate(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

function displayMoney(value: string, currency: string) {
  return currency === "USD" ? formatUsdMinor(value) : `${currency} ${value}`;
}

export default async function CustomerOrderDetailPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const [order, whatsapp] = await Promise.all([
    getCurrentUserOrder(publicId),
    getPublicWhatsAppPresentation(),
  ]);
  if (!order) notFound();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x">
        <Link href="/account/orders" className="text-sm font-semibold text-sage-700 hover:underline">
          ← Back to orders
        </Link>
        <div className="mt-6 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <p className="font-mono text-eyebrow uppercase text-sage-600">
              Public order reference
            </p>
            <h1 className="mt-4 text-h2 text-strong">{order.orderNumber}</h1>
            <p className="mt-3 text-body">
              Created {formatDate(order.createdAt)} for {order.customerEmail}
            </p>
          </div>
          {whatsapp ? (
            <WhatsAppIntentButton
              intent={{
                templateKey: "order",
                orderPublicId: order.publicId,
              }}
              className="inline-flex rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-cream-50 hover:bg-sage-600 disabled:cursor-wait disabled:opacity-70"
            >
              Discuss this order on WhatsApp
            </WhatsAppIntentButton>
          ) : null}
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            ["Order", order.status],
            ["Payment", order.paymentStatus],
            ["Fulfillment", order.fulfillmentStatus],
          ].map(([label, value]) => (
            <article key={label} className="rounded-2xl border border-ink-900/[0.08] bg-surface p-5">
              <p className="text-caption uppercase tracking-wider text-muted">{label}</p>
              <p className="mt-2 text-h5 text-strong">{humanizeCommerceStatus(value)}</p>
            </article>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
              <h2 className="text-h4 text-strong">Items</h2>
              <div className="mt-5 divide-y divide-ink-900/[0.06]">
                {order.items.map((item, index) => (
                  <div key={`${item.sku ?? item.productName}-${index}`} className="grid gap-3 py-5 sm:grid-cols-[1fr_auto]">
                    <div>
                      {item.productSlug ? (
                        <Link href={`/products/${item.productSlug}`} className="font-semibold text-strong hover:text-sage-700">
                          {item.productName}
                        </Link>
                      ) : (
                        <p className="font-semibold text-strong">{item.productName}</p>
                      )}
                      <p className="mt-1 text-sm text-muted">
                        {item.variantName ?? "Default variant"}
                        {item.sku ? ` · SKU ${item.sku}` : ""}
                      </p>
                      <p className="mt-1 text-caption text-muted">
                        Fulfilled {item.fulfilledQuantity} of {item.quantity}
                      </p>
                    </div>
                    <div className="sm:text-right">
                      <p className="font-semibold text-strong">
                        {displayMoney(item.lineTotalMinor, item.currency)}
                      </p>
                      <p className="mt-1 text-caption text-muted">
                        {item.quantity} × {displayMoney(item.unitPriceMinor, item.currency)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2 border-t border-ink-900/10 pt-5 text-sm">
                <div className="flex justify-between gap-4 text-body">
                  <span>Merchandise subtotal</span>
                  <span>{displayMoney(order.subtotalMinor, order.currency)}</span>
                </div>
                {order.discountMinor !== "0" ? (
                  <div className="flex justify-between gap-4 text-body">
                    <span>Discount</span>
                    <span>−{displayMoney(order.discountMinor, order.currency)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between gap-4 text-body">
                  <span>Shipping</span>
                  <span>{displayMoney(order.shippingMinor, order.currency)}</span>
                </div>
                <div className="flex justify-between gap-4 text-body">
                  <span>Tax</span>
                  <span>{displayMoney(order.taxMinor, order.currency)}</span>
                </div>
                <div className="flex justify-between gap-4 border-t border-ink-900/10 pt-3">
                  <span className="font-semibold text-strong">Order total</span>
                  <span className="text-h5 text-strong">
                    {displayMoney(order.totalMinor, order.currency)}
                  </span>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
              <h2 className="text-h4 text-strong">Payment</h2>
              <div className="mt-5 space-y-4">
                {order.payments.map((payment) => (
                  <article key={payment.publicId} className="rounded-xl bg-surface-alt p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-strong">
                          {PAYMENT_METHOD_LABELS[payment.method]}
                        </p>
                        <p className="mt-1 text-sm text-muted">
                          {humanizeCommerceStatus(payment.status)} · {displayMoney(payment.amountMinor, payment.currency)}
                        </p>
                      </div>
                      <span className="rounded-full bg-cream-50 px-3 py-1 text-caption font-semibold text-ink-500 ring-1 ring-ink-900/10">
                        Updated {formatDate(payment.updatedAt)}
                      </span>
                    </div>

                    {payment.method === "NOWPAYMENTS" &&
                    ["CREATED", "PENDING", "AWAITING_CONFIRMATION"].includes(
                      payment.status,
                    ) ? (
                      <div className="mt-4 rounded-lg bg-clay-50 p-4 text-sm leading-relaxed text-clay-600">
                        <p>
                          Provider checkout is separate from this order record.
                          Payment is complete only after NOWPayments reports a
                          finished status.
                        </p>
                        <NowPaymentsCheckoutButton
                          orderPublicId={order.publicId}
                          paymentPublicId={payment.publicId}
                        />
                      </div>
                    ) : null}

                    {payment.publicInstructions ? (
                      <div className="mt-4">
                        <p className="text-caption font-semibold uppercase tracking-wider text-muted">
                          Current payment instructions
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-body">
                          {payment.publicInstructions}
                        </p>
                        {/* The instructions ask the customer to reach us before
                            paying, so the handoff belongs here rather than only
                            at the top of the page. Provider checkouts have their
                            own button above. */}
                        {whatsapp && payment.method !== "NOWPAYMENTS" ? (
                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            <WhatsAppIntentButton
                              intent={{
                                templateKey: "order",
                                orderPublicId: order.publicId,
                              }}
                              className="inline-flex items-center gap-2 rounded-full bg-[#176b4d] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#12563e] disabled:cursor-wait disabled:opacity-70"
                              fallbackClassName="text-sm font-semibold text-sage-700 underline"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                aria-hidden
                                className="h-4 w-4"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                              >
                                <path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4.1A8 8 0 1 1 20 11.5Z" />
                                <path d="M9.2 8.4c.4 2.4 2 4 4.4 4.8l1.2-1.1 1.8.9c.2.1.3.4.2.7-.4 1.1-1.5 1.7-2.7 1.5-3.8-.7-6.6-3.5-7.3-7.3-.2-1.2.4-2.3 1.5-2.7.3-.1.6 0 .7.2l.9 1.8-1 1.2Z" />
                              </svg>
                              Message us about this payment
                            </WhatsAppIntentButton>
                            {whatsapp.displayValue ? (
                              <span className="text-caption text-muted">
                                {whatsapp.displayValue}
                                {whatsapp.businessHours
                                  ? ` · ${whatsapp.businessHours}`
                                  : ""}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : payment.method !== "NOWPAYMENTS" ? (
                      <p className="mt-4 text-sm leading-relaxed text-muted">
                        Payment instructions are unavailable for this order state. Contact support with the public order reference for assistance.
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
              <h2 className="text-h4 text-strong">Shipments and tracking</h2>
              {order.shipments.length === 0 ? (
                <p className="mt-4 text-body">No shipment has been created yet.</p>
              ) : (
                <div className="mt-5 space-y-5">
                  {order.shipments.map((shipment) => (
                    <article key={shipment.publicId} className="rounded-xl border border-ink-900/10 p-5">
                      <div className="flex flex-wrap justify-between gap-3">
                        <div>
                          <p className="font-mono text-caption text-sage-700">{shipment.shipmentNumber}</p>
                          <p className="mt-2 font-semibold text-strong">
                            {shipment.carrierName ?? "Carrier pending"}
                            {shipment.serviceLevel ? ` · ${shipment.serviceLevel}` : ""}
                          </p>
                          {shipment.trackingNumber ? (
                            <p className="mt-1 text-sm text-muted">
                              Tracking {shipment.trackingNumber}
                              {shipment.trackingUrl ? (
                                <>
                                  {" · "}
                                  <a
                                    href={shipment.trackingUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-semibold text-sage-700 underline underline-offset-4"
                                  >
                                    Open carrier page
                                  </a>
                                </>
                              ) : null}
                            </p>
                          ) : null}
                          {shipment.estimatedDeliveryAt ? (
                            <p className="mt-1 text-sm text-muted">
                              Merchant estimate: {formatDate(shipment.estimatedDeliveryAt)}
                            </p>
                          ) : null}
                        </div>
                        <span className="text-sm font-semibold text-strong">
                          {humanizeCommerceStatus(shipment.status)}
                        </span>
                      </div>
                      <p className="mt-4 text-caption leading-relaxed text-muted">
                        Tracking details are merchant-maintained. The carrier
                        page is provided for convenience and is not represented
                        as a live carrier integration.
                      </p>
                      {shipment.packages.length ? (
                        <div className="mt-4 rounded-lg bg-surface-alt p-4">
                          <p className="text-caption font-semibold uppercase tracking-wider text-muted">
                            Packages ({shipment.packages.length})
                          </p>
                          <ul className="mt-2 space-y-1 text-sm text-body">
                            {shipment.packages.map((parcel) => (
                              <li key={parcel.publicId}>
                                Package {parcel.packageNumber}
                                {parcel.weightGrams
                                  ? ` · ${parcel.weightGrams.toLocaleString("en-US")} g`
                                  : ""}
                                {parcel.lengthMillimeters && parcel.widthMillimeters && parcel.heightMillimeters
                                  ? ` · ${parcel.lengthMillimeters} × ${parcel.widthMillimeters} × ${parcel.heightMillimeters} mm`
                                  : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <div className="mt-5 border-l border-sage-200 pl-5">
                        {shipment.events.length ? (
                          shipment.events.map((event) => (
                            <div key={event.publicId} className="relative pb-5 last:pb-0">
                              <span className="absolute -left-[1.47rem] top-1 h-2.5 w-2.5 rounded-full bg-sage-500 ring-4 ring-surface" />
                              <p className="text-sm font-semibold text-strong">
                                {humanizeCommerceStatus(event.status)}
                              </p>
                              <p className="mt-1 text-caption text-muted">
                                {formatDate(event.occurredAt)}
                                {event.location ? ` · ${event.location}` : ""}
                              </p>
                              {event.message ? <p className="mt-1 text-sm text-body">{event.message}</p> : null}
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted">No carrier events yet.</p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-6">
            {order.addresses.map((address) => (
              <section key={address.kind} className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
                <p className="text-caption font-semibold uppercase tracking-wider text-muted">
                  {humanizeCommerceStatus(address.kind)} address
                </p>
                <address className="mt-3 not-italic text-sm leading-relaxed text-body">
                  <strong className="text-strong">{address.recipientName}</strong>
                  {address.company ? <><br />{address.company}</> : null}
                  <br />{address.line1}
                  {address.line2 ? <><br />{address.line2}</> : null}
                  <br />{address.city}, {address.region} {address.postalCode}
                  <br />{address.countryCode}
                  {address.phone ? <><br />{address.phone}</> : null}
                </address>
              </section>
            ))}
            <section className="rounded-2xl bg-ink-900 p-6 text-cream-100">
              <h2 className="text-h5 text-cream-50">Safe support reference</h2>
              <p className="mt-3 text-sm leading-relaxed text-cream-200/80">
                Share {order.orderNumber} when contacting support. This reference is not accepted as authorization to view or change the order; account login remains required.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}
