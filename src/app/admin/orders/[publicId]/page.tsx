import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { formatUsdMinor } from "@/domain/money";
import {
  humanizeCommerceStatus,
  PAYMENT_METHOD_LABELS,
} from "@/domain/order";
import { getAdminOrder } from "@/server/admin/orders/queries";

import {
  cancelUnlinkedNowPaymentsPaymentAction,
  linkNowPaymentsProviderPaymentAction,
  recordManualPaymentRefundAction,
  reviewManualPaymentAction,
} from "../actions";
import { DISPLAY_TIME_ZONE } from "@/lib/display-timezone";

export const metadata: Metadata = {
  title: "Order review",
  robots: { index: false, follow: false },
};

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value))} CT`;
}

function displayMoney(value: string, currency: string) {
  return currency === "USD" ? formatUsdMinor(value) : `${currency} ${value}`;
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const order = await getAdminOrder(publicId);
  if (!order) notFound();
  const hasPreDispatchShipment = order.shipments.some(
    (shipment) =>
      shipment.status === "DRAFT" || shipment.status === "LABEL_CREATED",
  );
  const hasPhysicalDispatch = order.shipments.some(
    (shipment) =>
      (shipment.shippedAt !== null ||
        ["IN_TRANSIT", "EXCEPTION", "DELIVERED", "RETURNED"].includes(
          shipment.status,
        )),
  );

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x">
        <header>
          <div>
            <Link href="/admin/orders" className="text-sm font-semibold text-sage-700">
              ← Orders and payments
            </Link>
            <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
              Order review
            </p>
            <h1 className="mt-3 text-h2 text-strong">{order.orderNumber}</h1>
            <p className="mt-3 text-body">
              {order.customerEmail} · Placed {formatDate(order.placedAt)}
            </p>
          </div>
        </header>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            ["Order", order.status],
            ["Payment", order.paymentStatus],
            ["Fulfillment", order.fulfillmentStatus],
          ].map(([label, value]) => (
            <article
              key={label}
              className="rounded-2xl border border-ink-900/[0.08] bg-surface p-5"
            >
              <p className="text-caption uppercase tracking-wider text-muted">{label}</p>
              <p className="mt-2 text-h5 text-strong">
                {humanizeCommerceStatus(value)}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
              <h2 className="text-h4 text-strong">Items</h2>
              <div className="mt-5 divide-y divide-line">
                {order.items.map((item) => (
                  <article
                    key={item.key}
                    className="grid gap-3 py-5 sm:grid-cols-[1fr_auto]"
                  >
                    <div>
                      <p className="font-semibold text-strong">{item.productName}</p>
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
                  </article>
                ))}
              </div>
              <dl className="ml-auto mt-5 max-w-sm space-y-2 border-t border-line pt-5 text-sm">
                {[
                  ["Subtotal", order.subtotalMinor],
                  ["Discount", order.discountMinor],
                  ["Shipping", order.shippingMinor],
                  ["Tax", order.taxMinor],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="text-muted">{label}</dt>
                    <dd className="font-semibold text-strong">
                      {displayMoney(value, order.currency)}
                    </dd>
                  </div>
                ))}
                <div className="flex justify-between gap-4 border-t border-line pt-3 text-base">
                  <dt className="font-semibold text-strong">Total</dt>
                  <dd className="font-semibold text-strong">
                    {displayMoney(order.totalMinor, order.currency)}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="text-h4 text-strong">Payments and events</h2>
                  <p className="mt-2 text-sm text-muted">
                    Raw provider payloads, payment addresses, checkout URLs, and
                    provider credentials are not shown. Provider IDs are exposed
                    only for controlled reconciliation.
                  </p>
                </div>
                <Link href="/admin/payments" className="text-sm font-semibold text-sage-700">
                  Payment settings →
                </Link>
              </div>

              {order.payments.length ? (
                <div className="mt-6 space-y-6">
                  {order.payments.map((payment) => (
                    <article
                      key={payment.publicId}
                      className="rounded-2xl border border-ink-900/10 p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-strong">
                            {PAYMENT_METHOD_LABELS[payment.method]}
                          </p>
                          <p className="mt-1 text-sm text-muted">
                            {displayMoney(payment.amountMinor, payment.currency)} · {humanizeCommerceStatus(payment.status)}
                          </p>
                        </div>
                        <p className="text-caption text-muted">
                          Updated {formatDate(payment.updatedAt)}
                        </p>
                      </div>

                      <dl className="mt-4 grid gap-3 rounded-xl bg-surface-alt p-4 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-muted">Provider status</dt>
                          <dd className="mt-1 font-semibold text-strong">
                            {payment.providerStatus ?? "Not reported"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted">Provider invoice ID</dt>
                          <dd className="mt-1 break-all font-mono text-xs font-semibold text-strong">
                            {payment.providerInvoiceId ?? "Not assigned"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted">Provider payment ID</dt>
                          <dd className="mt-1 break-all font-mono text-xs font-semibold text-strong">
                            {payment.providerPaymentId ?? "Not linked"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted">Confirmed</dt>
                          <dd className="mt-1 font-semibold text-strong">
                            {formatDate(payment.confirmedAt)}
                          </dd>
                        </div>
                        {payment.cryptoCurrency || payment.cryptoAmount ? (
                          <div>
                            <dt className="text-muted">Requested crypto</dt>
                            <dd className="mt-1 font-semibold text-strong">
                              {payment.cryptoAmount ?? "—"} {payment.cryptoCurrency ?? ""}
                            </dd>
                          </div>
                        ) : null}
                        {payment.actuallyPaid ? (
                          <div>
                            <dt className="text-muted">Provider amount received</dt>
                            <dd className="mt-1 font-semibold text-strong">
                              {payment.actuallyPaid} {payment.cryptoCurrency ?? ""}
                            </dd>
                          </div>
                        ) : null}
                        {payment.outcomeAmount ? (
                          <div>
                            <dt className="text-muted">Provider outcome</dt>
                            <dd className="mt-1 font-semibold text-strong">
                              {payment.outcomeAmount} {payment.outcomeCurrency ?? ""}
                            </dd>
                          </div>
                        ) : null}
                      </dl>

                      {payment.reconciliationIssue ? (
                        <div className="mt-5 rounded-xl border border-red-700/20 bg-red-50 p-5 text-red-900">
                          <p className="font-semibold">Provider reconciliation hold</p>
                          <p className="mt-2 text-sm leading-relaxed">
                            {payment.reconciliationIssue ===
                            "PROVIDER_PAYMENT_ID_MISSING"
                              ? "The invoice exists, but no provider payment ID reached this site. Automatic reservation expiration is paused until this record is reconciled."
                              : payment.reconciliationIssue}
                          </p>
                        </div>
                      ) : null}

                      {payment.canResolveUnlinkedNowPayments &&
                      payment.providerInvoiceId ? (
                        <div className="mt-5 rounded-xl border border-amber-700/20 bg-amber-50 p-5 text-amber-950">
                          <p className="font-semibold">
                            Resolve missing NOWPayments payment ID
                          </p>
                          <p className="mt-2 text-sm leading-relaxed">
                            First inspect invoice {payment.providerInvoiceId} in the
                            matching NOWPayments environment. Linking performs a live
                            provider lookup and refuses any invoice, order, currency,
                            or amount mismatch. Never mark it unpaid while a deposit is
                            visible or uncertain.
                          </p>
                          <div className="mt-5 grid gap-5 lg:grid-cols-2">
                            <AdminActionForm
                              action={linkNowPaymentsProviderPaymentAction}
                              submitLabel="Validate and link payment"
                              className="space-y-3 rounded-xl border border-amber-900/10 bg-white/70 p-4"
                            >
                              <input
                                type="hidden"
                                name="paymentPublicId"
                                value={payment.publicId}
                              />
                              <label className="block text-sm font-semibold">
                                Exact provider payment ID
                                <input
                                  required
                                  name="providerPaymentId"
                                  autoComplete="off"
                                  className="mt-2 w-full rounded-lg border border-ink-900/15 bg-white px-3 py-2 font-mono text-sm text-strong"
                                />
                              </label>
                            </AdminActionForm>

                            <AdminActionForm
                              action={cancelUnlinkedNowPaymentsPaymentAction}
                              submitLabel="Cancel verified-unpaid invoice"
                              className="space-y-3 rounded-xl border border-red-900/10 bg-white/70 p-4"
                            >
                              <input
                                type="hidden"
                                name="paymentPublicId"
                                value={payment.publicId}
                              />
                              <label className="block text-sm font-semibold">
                                Retype exact provider invoice ID
                                <input
                                  required
                                  name="providerInvoiceId"
                                  autoComplete="off"
                                  className="mt-2 w-full rounded-lg border border-ink-900/15 bg-white px-3 py-2 font-mono text-sm text-strong"
                                />
                              </label>
                              <label className="flex items-start gap-3 text-sm leading-relaxed">
                                <input
                                  required
                                  type="checkbox"
                                  name="confirmation"
                                  value="CONFIRM_NO_PROVIDER_PAYMENT"
                                  className="mt-1"
                                />
                                <span>
                                  I independently verified in the provider dashboard
                                  that this invoice has no payment or deposit. Canceling
                                  may release reserved stock and close the order.
                                </span>
                              </label>
                            </AdminActionForm>
                          </div>
                        </div>
                      ) : null}

                      {/* Settled manual payments state the good news plainly,
                          so the refund disclosure below reads as an option
                          rather than a problem. */}
                      {payment.status === "CONFIRMED" && payment.confirmedAt ? (
                        <div className="mt-5 rounded-xl border border-sage-700/20 bg-sage-50 p-4 text-sm text-sage-900">
                          <span className="font-semibold">
                            Funds settled and order confirmed.
                          </span>{" "}
                          Recorded {formatDate(payment.confirmedAt)}. Inventory for
                          this order is consumed and its cost is locked; nothing
                          further is required here.
                        </div>
                      ) : null}

                      {payment.canReview ? (
                        <div className="mt-5 rounded-xl border border-clay-600/20 bg-clay-50 p-5">
                          <p className="font-semibold text-clay-700">
                            Manual payment review
                          </p>
                          <p className="mt-2 text-sm leading-relaxed text-clay-700">
                            Confirm only after independently verifying settled funds.
                            The first confirmation also confirms the order and consumes
                            its active inventory reservations. Provider-managed
                            NOWPayments records cannot be changed by these actions.
                          </p>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <AdminActionForm
                              action={reviewManualPaymentAction}
                              submitLabel="Confirm settled payment"
                              className="space-y-3"
                            >
                              <input
                                type="hidden"
                                name="paymentPublicId"
                                value={payment.publicId}
                              />
                              <input type="hidden" name="decision" value="CONFIRM" />
                            </AdminActionForm>
                            <AdminActionForm
                              action={reviewManualPaymentAction}
                              submitLabel="Reject payment"
                              className="space-y-3"
                            >
                              <input
                                type="hidden"
                                name="paymentPublicId"
                                value={payment.publicId}
                              />
                              <input type="hidden" name="decision" value="REJECT" />
                            </AdminActionForm>
                          </div>
                        </div>
                      ) : null}

                      {payment.externalRefund ? (
                        <div className="mt-5 rounded-xl border border-sage-700/20 bg-sage-50 p-5 text-sage-900">
                          <p className="font-semibold">External refund recorded</p>
                          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                            <div>
                              <dt className="text-sage-700">Reference</dt>
                              <dd className="mt-1 break-all font-mono font-semibold">
                                {payment.externalRefund.reference}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-sage-700">Recorded</dt>
                              <dd className="mt-1 font-semibold">
                                {formatDate(payment.externalRefund.recordedAt)}
                              </dd>
                            </div>
                          </dl>
                          {payment.externalRefund.note ? (
                            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
                              {payment.externalRefund.note}
                            </p>
                          ) : null}
                          <p className="mt-3 text-sm leading-relaxed">
                            This is an audit record of a refund completed in the
                            external Wire/Zelle service. This site did not send the
                            funds.
                          </p>
                        </div>
                      ) : null}

                      {payment.canRecordExternalRefund ? (
                        /* A settled payment is the healthy end state, so the
                           refund path stays collapsed: an always-open red panel
                           on every paid order reads as an alarm and trains
                           operators to ignore real ones. Opening it is a
                           deliberate act, and only then does the danger styling
                           apply. */
                        <details className="group mt-5">
                          <summary className="cursor-pointer list-none rounded-xl border border-ink-900/[0.08] bg-surface-alt px-5 py-3 text-sm font-semibold text-strong transition hover:border-red-800/30 hover:text-red-950">
                            <span className="inline-flex items-center gap-2">
                              <span className="text-muted transition group-open:rotate-90">
                                ›
                              </span>
                              Money was returned to the customer? Record an
                              external refund
                            </span>
                          </summary>
                          <div className="mt-3 rounded-xl border border-red-800/20 bg-red-50 p-5 text-red-950">
                          <p className="font-semibold">
                            Record a completed full external refund
                          </p>
                          <p className="mt-2 text-sm leading-relaxed">
                            Use this only after the entire order amount has already
                            been returned through the bank or Zelle. This action does
                            not send money. It records the reference, marks payment
                            refunded, and updates the order atomically.
                          </p>
                          {hasPreDispatchShipment ? (
                            <div role="alert" className="mt-4 rounded-lg border border-red-900/15 bg-white/70 p-4 text-sm">
                              Cancel every draft or label-created shipment on the{" "}
                              <Link
                                href={`/admin/fulfillment/orders/${order.publicId}`}
                                className="font-semibold underline"
                              >
                                fulfillment page
                              </Link>{" "}
                              before recording the refund. This releases its line
                              allocations first.
                            </div>
                          ) : (
                            <>
                              <p className="mt-3 text-sm font-semibold">
                                {hasPhysicalDispatch
                                  ? "A carrier dispatch exists: inventory and tracking will be preserved."
                                  : "No carrier dispatch exists: any consumed tracked sale inventory will be restored once, and the order will be canceled."}
                              </p>
                              <AdminActionForm
                                action={recordManualPaymentRefundAction}
                                submitLabel="Record completed external refund"
                                className="mt-5 space-y-4"
                              >
                                <input
                                  type="hidden"
                                  name="paymentPublicId"
                                  value={payment.publicId}
                                />
                                <label className="block text-sm font-semibold">
                                  Bank or Zelle refund reference
                                  <input
                                    required
                                    name="refundReference"
                                    maxLength={255}
                                    autoComplete="off"
                                    className="mt-2 w-full rounded-lg border border-red-950/20 bg-white px-3 py-2 font-mono text-sm text-strong"
                                  />
                                </label>
                                <label className="block text-sm font-semibold">
                                  Internal note (optional)
                                  <textarea
                                    name="note"
                                    maxLength={2000}
                                    rows={3}
                                    className="mt-2 w-full rounded-lg border border-red-950/20 bg-white px-3 py-2 text-sm text-strong"
                                  />
                                </label>
                                <label className="flex items-start gap-3 text-sm leading-relaxed">
                                  <input
                                    required
                                    type="checkbox"
                                    name="confirmation"
                                    value="CONFIRM_EXTERNAL_REFUND_COMPLETED"
                                    className="mt-1"
                                  />
                                  <span>
                                    I independently completed and verified the full
                                    refund outside this site. I understand this button
                                    records that fact and does not transfer funds.
                                  </span>
                                </label>
                              </AdminActionForm>
                            </>
                          )}
                          </div>
                        </details>
                      ) : null}

                      <div className="mt-5">
                        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
                          Event history
                        </h3>
                        {payment.events.length ? (
                          <ol className="mt-3 divide-y divide-line">
                            {payment.events.map((event) => (
                              <li key={event.publicId} className="py-3 text-sm">
                                <div className="flex flex-wrap justify-between gap-2">
                                  <p className="font-mono text-xs font-semibold text-strong">
                                    {event.eventType}
                                  </p>
                                  <time className="text-caption text-muted">
                                    {formatDate(event.occurredAt)}
                                  </time>
                                </div>
                                <p className="mt-1 text-muted">
                                  {event.statusBefore
                                    ? humanizeCommerceStatus(event.statusBefore)
                                    : "No prior status"}
                                  {" → "}
                                  {event.statusAfter
                                    ? humanizeCommerceStatus(event.statusAfter)
                                    : "No resulting status"}
                                  {event.amountMinor
                                    ? ` · ${displayMoney(event.amountMinor, payment.currency)}`
                                    : ""}
                                </p>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="mt-3 text-sm text-muted">No payment events recorded.</p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="mt-5 text-body">No payment attempts recorded.</p>
              )}
            </section>

            <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
              <h2 className="text-h4 text-strong">Shipments</h2>
              {order.shipments.length ? (
                <div className="mt-5 space-y-5">
                  {order.shipments.map((shipment) => (
                    <article key={shipment.publicId} className="rounded-xl border border-line p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="font-mono text-caption text-sage-700">
                            {shipment.shipmentNumber}
                          </p>
                          <p className="mt-2 font-semibold text-strong">
                            {shipment.carrierName ?? "Carrier pending"}
                            {shipment.serviceLevel ? ` · ${shipment.serviceLevel}` : ""}
                          </p>
                          {shipment.trackingNumber ? (
                            <p className="mt-1 text-sm text-muted">
                              Tracking {shipment.trackingNumber}
                            </p>
                          ) : null}
                        </div>
                        <span className="text-sm font-semibold text-strong">
                          {humanizeCommerceStatus(shipment.status)}
                        </span>
                      </div>
                      {shipment.items.length ? (
                        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-body">
                          {shipment.items.map((item, index) => (
                            <li key={`${item.sku ?? item.productName}:${index}`}>
                              {item.quantity} × {item.productName}
                              {item.variantName ? ` · ${item.variantName}` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {shipment.events.length ? (
                        <ol className="mt-5 border-l border-sage-200 pl-5">
                          {shipment.events.map((event) => (
                            <li key={event.publicId} className="pb-4 last:pb-0">
                              <p className="text-sm font-semibold text-strong">
                                {humanizeCommerceStatus(event.status)}
                              </p>
                              <p className="mt-1 text-caption text-muted">
                                {formatDate(event.occurredAt)}
                                {event.location ? ` · ${event.location}` : ""}
                              </p>
                              {event.message ? (
                                <p className="mt-1 text-sm text-body">{event.message}</p>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="mt-4 text-sm text-muted">No tracking events.</p>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-body">No shipment has been created.</p>
              )}
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
              <h2 className="text-h5 text-strong">Customer</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-muted">Email</dt>
                  <dd className="mt-1 break-all font-semibold text-strong">
                    {order.customerEmail}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Phone</dt>
                  <dd className="mt-1 font-semibold text-strong">
                    {order.customerPhone ?? "Not provided"}
                  </dd>
                </div>
                {order.customerNote ? (
                  <div>
                    <dt className="text-muted">Customer note</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-body">
                      {order.customerNote}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>

            {order.addresses.map((address) => (
              <section
                key={address.kind}
                className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6"
              >
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

            <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
              <h2 className="text-h5 text-strong">Timeline</h2>
              <dl className="mt-4 space-y-3 text-sm">
                {[
                  ["Created", order.createdAt],
                  ["Confirmed", order.confirmedAt],
                  ["Completed", order.completedAt],
                  ["Canceled", order.canceledAt],
                  ["Updated", order.updatedAt],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted">{label}</dt>
                    <dd className="mt-1 font-semibold text-strong">
                      {formatDate(value)}
                    </dd>
                  </div>
                ))}
                {order.cancellationReason ? (
                  <div>
                    <dt className="text-muted">Cancellation reason</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-body">
                      {order.cancellationReason}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}
