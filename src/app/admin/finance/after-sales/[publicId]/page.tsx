import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import {
  approveAfterSalesEventAction,
  attachCompensationToOrderAction,
  completeAfterSalesEventAction,
  upsertAfterSalesEventAction,
  upsertAfterSalesItemAction,
  voidAfterSalesEventAction,
} from "@/app/admin/finance/after-sales/actions";
import { formatUsdMinor } from "@/domain/money";
import { getAdminAfterSalesEvent } from "@/server/admin/finance/after-sales/queries";

export const metadata: Metadata = {
  title: "After-sales event",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

function usdInput(minor: string) {
  const value = BigInt(minor);
  const negative = value < BigInt(0);
  const abs = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

function formatSignedUsd(minor: string) {
  const value = BigInt(minor);
  return value < BigInt(0)
    ? `-${formatUsdMinor((-value).toString())}`
    : formatUsdMinor(value.toString());
}

export default async function AdminAfterSalesDetailPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const result = await getAdminAfterSalesEvent(publicId);
  if (!result) notFound();
  const { event, locations, variants, openOrders } = result;
  const editable = event.status === "DRAFT" || event.status === "APPROVED";

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-12">
        <header>
          <Link href="/admin/finance/after-sales" className="text-sm font-semibold text-sage-700">
            ← After-sales events
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            {event.status} · order{" "}
            <Link href={`/admin/orders/${event.order.publicId}`} className="text-sage-700">
              {event.order.orderNumber}
            </Link>{" "}
            · {event.order.customerEmail}
          </p>
          <h1 className="text-h3 text-strong">{event.reason.slice(0, 120)}</h1>
          <p className="mt-2 text-sm text-muted">
            Refund {formatUsdMinor(event.refundAmountMinor)} · shipping refund{" "}
            {formatUsdMinor(event.shippingRefundMinor)} · return shipping cost{" "}
            {formatUsdMinor(event.returnShippingCostMinor)} · compensation shipping{" "}
            {formatUsdMinor(event.compensationShippingCostMinor)}
          </p>
        </header>

        {editable ? (
          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h4 text-strong">Event details</h2>
            <AdminActionForm action={upsertAfterSalesEventAction} className="mt-6 space-y-5" submitLabel="Save event">
              <input type="hidden" name="publicId" value={event.publicId} />
              <input type="hidden" name="orderPublicId" value={event.order.publicId} />
              <div className="grid gap-5 md:grid-cols-3">
                <label className={labelClass}>
                  Responsibility
                  <select className={inputClass} name="responsibility" defaultValue={event.responsibility}>
                    <option value="MERCHANT">Merchant</option>
                    <option value="CARRIER">Carrier</option>
                    <option value="SUPPLIER">Supplier</option>
                    <option value="CUSTOMER">Customer</option>
                    <option value="OTHER">Other</option>
                  </select>
                </label>
                <label className={labelClass}>Refund amount (USD)<input className={inputClass} name="refundAmount" inputMode="decimal" maxLength={16} defaultValue={usdInput(event.refundAmountMinor)} /></label>
                <label className={labelClass}>Shipping refund (USD)<input className={inputClass} name="shippingRefund" inputMode="decimal" maxLength={16} defaultValue={usdInput(event.shippingRefundMinor)} /></label>
                <label className={labelClass}>Return shipping cost (USD)<input className={inputClass} name="returnShippingCost" inputMode="decimal" maxLength={16} defaultValue={usdInput(event.returnShippingCostMinor)} /></label>
                <label className={labelClass}>Compensation shipping cost (USD)<input className={inputClass} name="compensationShippingCost" inputMode="decimal" maxLength={16} defaultValue={usdInput(event.compensationShippingCostMinor)} /></label>
              </div>
              <label className={labelClass}>Reason<textarea className={inputClass} name="reason" rows={2} maxLength={4000} required defaultValue={event.reason} /></label>
              <label className={labelClass}>Evidence / internal notes<textarea className={inputClass} name="evidenceNotes" rows={2} maxLength={8000} defaultValue={event.evidenceNotes ?? ""} /></label>
            </AdminActionForm>
          </article>
        ) : (
          <p className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 text-sm text-muted">
            This event is {event.status.toLowerCase()} and immutable. Corrections
            go through reversing financial adjustments.
            {event.evidenceNotes ? ` Notes: ${event.evidenceNotes}` : ""}
          </p>
        )}

        <section>
          <h2 className="text-h3 text-strong">Items ({event.items.length})</h2>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-900/[0.08] text-xs uppercase text-muted">
                  <th className="px-5 py-4">Kind</th>
                  <th className="px-5 py-4">Variant</th>
                  <th className="px-5 py-4">Qty</th>
                  <th className="px-5 py-4">Disposition / delivery</th>
                  <th className="px-5 py-4">Restocked</th>
                  <th className="px-5 py-4">Cost snapshot</th>
                  <th className="px-5 py-4">Attached order</th>
                  {editable ? <th className="px-5 py-4">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {event.items.length === 0 ? (
                  <tr>
                    <td colSpan={editable ? 8 : 7} className="px-5 py-8 text-center text-muted">
                      No items. Pure refunds need no items; returns and
                      compensation goods are added below.
                    </td>
                  </tr>
                ) : (
                  event.items.map((item) => (
                    <tr key={item.publicId} className="border-b border-ink-900/[0.04]">
                      <td className="px-5 py-4">{item.kind}</td>
                      <td className="px-5 py-4">{item.variantLabel}</td>
                      <td className="px-5 py-4">{item.quantity}</td>
                      <td className="px-5 py-4">{item.disposition ?? item.compensationDelivery ?? "—"}</td>
                      <td className="px-5 py-4">{item.restocked ? "Yes" : "No"}</td>
                      <td className="px-5 py-4">
                        {item.totalCostUsdMinor ? formatUsdMinor(item.totalCostUsdMinor) : "Pending"}
                      </td>
                      <td className="px-5 py-4">
                        {item.appliedToOrderPublicId ? (
                          <Link href={`/admin/orders/${item.appliedToOrderPublicId}`} className="text-sage-700">
                            {item.appliedToOrderNumber}
                          </Link>
                        ) : item.kind === "COMPENSATION" && item.compensationDelivery === "NEXT_ORDER" ? (
                          "Awaiting attachment"
                        ) : (
                          "—"
                        )}
                      </td>
                      {editable ? (
                        <td className="px-5 py-4">
                          {item.appliedToOrderPublicId === null ? (
                            <AdminActionForm action={upsertAfterSalesItemAction} submitLabel="Remove">
                              <input type="hidden" name="eventPublicId" value={event.publicId} />
                              <input type="hidden" name="itemPublicId" value={item.publicId} />
                              <input type="hidden" name="remove" value="true" />
                            </AdminActionForm>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {editable ? (
            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <article className="rounded-2xl border border-dashed border-sage-700/30 bg-surface p-6">
                <h3 className="text-h5 text-strong">Add a returned item</h3>
                <AdminActionForm action={upsertAfterSalesItemAction} className="mt-5 space-y-4" submitLabel="Add return item">
                  <input type="hidden" name="eventPublicId" value={event.publicId} />
                  <input type="hidden" name="kind" value="RETURN" />
                  <label className={labelClass}>
                    Order line
                    <select className={inputClass} name="orderItemId" required defaultValue="">
                      <option value="" disabled>Select order line</option>
                      {event.order.items.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className={labelClass}>Quantity<input className={inputClass} name="quantity" type="number" min={1} step={1} required /></label>
                    <label className={labelClass}>
                      Disposition
                      <select className={inputClass} name="disposition" required defaultValue="">
                        <option value="" disabled>Select outcome</option>
                        <option value="RESALABLE">Returned — resalable (restock)</option>
                        <option value="DAMAGED">Returned — damaged (write off)</option>
                        <option value="DESTROYED">Returned — destroyed (write off)</option>
                        <option value="LOST">Not returned (refund only)</option>
                      </select>
                    </label>
                  </div>
                </AdminActionForm>
              </article>
              <article className="rounded-2xl border border-dashed border-sage-700/30 bg-surface p-6">
                <h3 className="text-h5 text-strong">Add a compensation item</h3>
                <AdminActionForm action={upsertAfterSalesItemAction} className="mt-5 space-y-4" submitLabel="Add compensation item">
                  <input type="hidden" name="eventPublicId" value={event.publicId} />
                  <input type="hidden" name="kind" value="COMPENSATION" />
                  <label className={labelClass}>
                    Variant to send free of charge
                    <select className={inputClass} name="variantPublicId" required defaultValue="">
                      <option value="" disabled>Select variant</option>
                      {variants.map((variant) => (
                        <option key={variant.publicId} value={variant.publicId}>{variant.label}</option>
                      ))}
                    </select>
                  </label>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className={labelClass}>Quantity<input className={inputClass} name="quantity" type="number" min={1} step={1} required /></label>
                    <label className={labelClass}>
                      Delivery
                      <select className={inputClass} name="compensationDelivery" required defaultValue="">
                        <option value="" disabled>Select delivery</option>
                        <option value="DEDICATED_SHIPMENT">Dedicated free shipment (now)</option>
                        <option value="NEXT_ORDER">Add to the customer&apos;s next order</option>
                      </select>
                    </label>
                  </div>
                </AdminActionForm>
              </article>
            </div>
          ) : null}
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h4 text-strong">Workflow</h2>
            <p className="mt-2 text-xs text-muted">
              Draft → approve → complete. Completion validates the refund cap,
              writes the profit adjustments, restocks resalable returns, and
              ships dedicated compensations. It is idempotent and immutable
              afterwards.
            </p>
            <div className="mt-5 space-y-5">
              {event.status === "DRAFT" ? (
                <AdminActionForm action={approveAfterSalesEventAction} submitLabel="Approve event">
                  <input type="hidden" name="eventPublicId" value={event.publicId} />
                </AdminActionForm>
              ) : null}
              {event.status === "APPROVED" ? (
                <AdminActionForm action={completeAfterSalesEventAction} className="space-y-4" submitLabel="Complete event (writes adjustments and stock)">
                  <input type="hidden" name="eventPublicId" value={event.publicId} />
                  <label className={labelClass}>
                    Inventory location (for restocks / dedicated shipments)
                    <select className={inputClass} name="locationPublicId" defaultValue="">
                      <option value="">Not needed for this event</option>
                      {locations.map((location) => (
                        <option key={location.publicId} value={location.publicId}>{location.code} · {location.name}</option>
                      ))}
                    </select>
                  </label>
                </AdminActionForm>
              ) : null}
              {editable ? (
                <AdminActionForm action={voidAfterSalesEventAction} submitLabel="Void event">
                  <input type="hidden" name="eventPublicId" value={event.publicId} />
                </AdminActionForm>
              ) : null}
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted">Created by</dt><dd>{event.createdByName ?? "—"}</dd>
                <dt className="text-muted">Approved by</dt><dd>{event.approvedByName ?? "—"}</dd>
                <dt className="text-muted">Completed at</dt><dd>{event.completedAt ?? "—"}</dd>
              </dl>
            </div>
          </article>

          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h4 text-strong">Attach next-order gift</h2>
            {event.items.some(
              (item) =>
                item.kind === "COMPENSATION" &&
                item.compensationDelivery === "NEXT_ORDER" &&
                item.appliedToOrderPublicId === null,
            ) ? (
              openOrders.length === 0 ? (
                <p className="mt-3 text-sm text-muted">
                  The customer has no open (draft or pending-payment) order yet.
                  Attach the gift once their next order exists and before its
                  payment is confirmed.
                </p>
              ) : (
                event.items
                  .filter(
                    (item) =>
                      item.kind === "COMPENSATION" &&
                      item.compensationDelivery === "NEXT_ORDER" &&
                      item.appliedToOrderPublicId === null,
                  )
                  .map((item) => (
                    <AdminActionForm key={item.publicId} action={attachCompensationToOrderAction} className="mt-5 space-y-4" submitLabel={`Attach ${item.variantLabel}`}>
                      <input type="hidden" name="eventPublicId" value={event.publicId} />
                      <input type="hidden" name="itemPublicId" value={item.publicId} />
                      <label className={labelClass}>
                        Target order
                        <select className={inputClass} name="targetOrderPublicId" required defaultValue="">
                          <option value="" disabled>Select open order</option>
                          {openOrders.map((order) => (
                            <option key={order.publicId} value={order.publicId}>{order.orderNumber} ({order.status})</option>
                          ))}
                        </select>
                      </label>
                    </AdminActionForm>
                  ))
              )
            ) : (
              <p className="mt-3 text-sm text-muted">
                No unattached next-order compensations on this event.
              </p>
            )}
          </article>
        </section>

        <section>
          <h2 className="text-h3 text-strong">Profit adjustments from this event ({event.adjustments.length})</h2>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-900/[0.08] text-xs uppercase text-muted">
                  <th className="px-5 py-4">Type</th>
                  <th className="px-5 py-4">Signed USD</th>
                  <th className="px-5 py-4">State</th>
                  <th className="px-5 py-4">Effective</th>
                  <th className="px-5 py-4">Reason</th>
                </tr>
              </thead>
              <tbody>
                {event.adjustments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-muted">
                      Adjustments appear after the event is completed.
                    </td>
                  </tr>
                ) : (
                  event.adjustments.map((adjustment) => (
                    <tr key={adjustment.publicId} className="border-b border-ink-900/[0.04]">
                      <td className="px-5 py-4">{adjustment.type}</td>
                      <td className="px-5 py-4">{formatSignedUsd(adjustment.signedUsdMinor)}</td>
                      <td className="px-5 py-4">{adjustment.isEstimated ? "Estimated" : "Finalized"}</td>
                      <td className="px-5 py-4">{adjustment.effectiveAt.slice(0, 10)}</td>
                      <td className="px-5 py-4">{adjustment.reason}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}
