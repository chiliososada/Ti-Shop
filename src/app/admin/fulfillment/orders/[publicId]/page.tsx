import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { humanizeCommerceStatus } from "@/domain/order";
import {
  allowedShipmentTransitionsForPayment,
  canAdvanceTrackingForPayment,
} from "@/server/admin/fulfillment/lifecycle";
import { getAdminFulfillmentOrder } from "@/server/admin/fulfillment/queries";

import {
  addTrackingEventAction,
  createPackageAction,
  createShipmentAction,
  deletePackageAction,
  updatePackageAction,
  updateShipmentDetailsAction,
  updateShipmentStatusAction,
} from "../../actions";

export const metadata: Metadata = {
  title: "Fulfill order",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

export default async function AdminFulfillmentOrderPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const order = await getAdminFulfillmentOrder(publicId);
  if (!order) notFound();

  const eventTimeDefault = new Date().toISOString();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-8">
        <header className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <Link href="/admin/fulfillment" className="text-sm font-semibold text-sage-700">
              ← Fulfillment
            </Link>
            <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
              Order-owned fulfillment
            </p>
            <h1 className="mt-3 text-h2 text-strong">{order.orderNumber}</h1>
            <p className="mt-3 text-body">
              {order.customerEmail} · Confirmed {formatDate(order.confirmedAt)}
            </p>
            <p className="mt-2 text-sm text-muted">
              Every shipment and tracking event on this page is loaded through
              this order’s public identifier and displayed with its owning order.
            </p>
          </div>
          <Link
            href={`/admin/orders/${order.publicId}`}
            className="inline-flex rounded-full border border-ink-900/15 px-5 py-2.5 text-sm font-semibold text-strong hover:bg-surface-alt"
          >
            Order review
          </Link>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
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

        {order.paymentStatus !== "PAID" ? (
          <section
            role="alert"
            className="rounded-2xl border border-red-800/25 bg-red-50 p-6 text-red-950"
          >
            <h2 className="text-h4">Payment blocks new fulfillment</h2>
            <p className="mt-2 text-sm">
              Payment is {humanizeCommerceStatus(order.paymentStatus)}. New
              shipments and pre-dispatch progress are blocked. Shipments already
              in transit remain editable so their physical carrier history is
              never rolled back; review the refund before taking further action.
            </p>
          </section>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
            <h2 className="text-h4 text-strong">Order lines</h2>
            <p className="mt-2 text-sm text-muted">
              Allocated quantities count as fulfilled when a shipment is created.
              Canceling a draft or labeled shipment releases those quantities.
            </p>
            <div className="mt-5 divide-y divide-line">
              {order.items.map((item) => (
                <article key={item.lineNumber} className="grid gap-3 py-5 sm:grid-cols-[1fr_auto]">
                  <div>
                    <p className="font-semibold text-strong">
                      Line {item.lineNumber}: {item.productName}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {item.variantName ?? "Default variant"}{item.sku ? ` · SKU ${item.sku}` : ""}
                    </p>
                  </div>
                  <div className="text-sm sm:text-right">
                    <p>{item.fulfilledQuantity}/{item.quantity} fulfilled</p>
                    <p className="mt-1 text-muted">{item.remainingQuantity} available</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
            <h2 className="text-h4 text-strong">Ship-to address</h2>
            {order.shippingAddress ? (
              <address className="mt-5 space-y-1 text-sm not-italic text-body">
                <p className="font-semibold text-strong">{order.shippingAddress.recipientName}</p>
                {order.shippingAddress.company ? <p>{order.shippingAddress.company}</p> : null}
                <p>{order.shippingAddress.line1}</p>
                {order.shippingAddress.line2 ? <p>{order.shippingAddress.line2}</p> : null}
                <p>{order.shippingAddress.city}, {order.shippingAddress.region} {order.shippingAddress.postalCode}</p>
                <p>{order.shippingAddress.countryCode}</p>
                {order.shippingAddress.phone ? <p>{order.shippingAddress.phone}</p> : null}
              </address>
            ) : (
              <p role="alert" className="mt-4 text-sm text-red-800">
                No shipping address is stored for this order. Do not ship until it is resolved.
              </p>
            )}
          </aside>
        </div>

        {order.canCreateShipment ? (
          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
            <h2 className="text-h4 text-strong">Create shipment</h2>
            <p className="mt-3 max-w-3xl text-body">
              Shipment numbers are generated on the server. The form sends one
              ordered quantity per rendered line; it never sends an internal
              order-item database ID.
            </p>
            <AdminActionForm
              action={createShipmentAction}
              submitLabel="Create draft shipment"
              className="mt-7 space-y-6"
            >
              <input type="hidden" name="orderPublicId" value={order.publicId} />
              <div className="grid gap-5 md:grid-cols-3">
                <label className={labelClass}>
                  Carrier
                  <select className={inputClass} name="carrierPublicId" required defaultValue="">
                    <option value="" disabled>Select carrier</option>
                    {order.carriers.map((carrier) => (
                      <option key={carrier.publicId} value={carrier.publicId}>
                        {carrier.name} ({carrier.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Service level (optional)
                  <input className={inputClass} name="serviceLevel" maxLength={120} placeholder="Ground" />
                </label>
                <label className={labelClass}>
                  Tracking number (optional)
                  <input className={`${inputClass} font-mono`} name="trackingNumber" maxLength={180} autoComplete="off" />
                </label>
                <label className={labelClass}>
                  Estimated delivery (ISO, optional)
                  <input className={inputClass} name="estimatedDeliveryAt" maxLength={40} placeholder="2026-07-20T17:00:00-04:00" />
                </label>
              </div>
              <fieldset>
                <legend className="text-sm font-semibold text-strong">Quantities by order line</legend>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {order.items.map((item) => (
                    <label key={item.lineNumber} className="rounded-xl border border-line p-4 text-sm">
                      <span className="font-semibold text-strong">Line {item.lineNumber}: {item.productName}</span>
                      <span className="mt-1 block text-xs text-muted">Maximum {item.remainingQuantity}</span>
                      <input
                        className={inputClass}
                        name="lineQuantity"
                        type="number"
                        min="0"
                        max={item.remainingQuantity}
                        step="1"
                        defaultValue="0"
                        required
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            </AdminActionForm>
          </section>
        ) : order.canManage ? (
          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h4 text-strong">Create shipment</h2>
            <p className="mt-3 text-body">
              A shipment cannot be created: payment is not paid, the order is not
              confirmed/processing, all quantities are allocated, or no active
              carrier is configured.
            </p>
          </section>
        ) : null}

        <section>
          <h2 className="text-h3 text-strong">Shipments ({order.shipments.length})</h2>
          <p className="mt-2 max-w-3xl text-body">
            Tracking numbers are stored and shown as plain text. No carrier URL,
            label URL, provider payload, or claim of live carrier verification is exposed.
          </p>
          <div className="mt-6 space-y-6">
            {order.shipments.map((shipment) => {
              const transitions = allowedShipmentTransitionsForPayment(
                order.paymentStatus,
                shipment.status,
              );
              const canAdvanceTracking = canAdvanceTrackingForPayment(
                order.paymentStatus,
                shipment.status,
              );
              const canEditPackages =
                shipment.status === "DRAFT" ||
                shipment.status === "LABEL_CREATED";
              return (
                <article key={shipment.publicId} className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
                  <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                    <div>
                      <p className="font-mono text-caption text-sage-700">{shipment.shipmentNumber}</p>
                      <h3 className="mt-2 text-h4 text-strong">
                        {humanizeCommerceStatus(shipment.status)}
                      </h3>
                      <p className="mt-2 text-sm text-muted">
                        Owner: {order.orderNumber} · {order.customerEmail}
                      </p>
                    </div>
                    <div className="text-sm md:text-right">
                      <p className="font-semibold text-strong">
                        {shipment.carrier ? `${shipment.carrier.name} (${shipment.carrier.code})` : "No carrier"}
                      </p>
                      <p className="mt-1 font-mono text-xs text-muted">
                        {shipment.trackingNumber ?? "No tracking number"}
                      </p>
                      <p className="mt-1 text-xs text-muted">{shipment.serviceLevel ?? "No service level"}</p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 text-sm sm:grid-cols-4">
                    <p>Estimated: {formatDate(shipment.estimatedDeliveryAt)}</p>
                    <p>Shipped: {formatDate(shipment.shippedAt)}</p>
                    <p>Delivered: {formatDate(shipment.deliveredAt)}</p>
                    <p>Canceled: {formatDate(shipment.canceledAt)}</p>
                  </div>

                  {order.canManage ? (
                    <AdminActionForm
                      action={updateShipmentDetailsAction}
                      submitLabel="Save logistics details"
                      className="mt-6 space-y-5 rounded-xl border border-line p-5"
                    >
                      <input type="hidden" name="shipmentPublicId" value={shipment.publicId} />
                      <div className="grid gap-5 md:grid-cols-3">
                        <label className={labelClass}>
                          Service level
                          <input className={inputClass} name="serviceLevel" maxLength={120} defaultValue={shipment.serviceLevel ?? ""} />
                        </label>
                        <label className={labelClass}>
                          Tracking number
                          <input className={`${inputClass} font-mono`} name="trackingNumber" maxLength={180} autoComplete="off" defaultValue={shipment.trackingNumber ?? ""} />
                        </label>
                        <label className={labelClass}>
                          Estimated delivery (ISO with timezone)
                          <input className={inputClass} name="estimatedDeliveryAt" maxLength={40} defaultValue={shipment.estimatedDeliveryAt ?? ""} placeholder="2026-07-20T17:00:00-04:00" />
                        </label>
                      </div>
                      <p className="text-xs text-muted">
                        Estimates and tracking details are merchant-maintained until a carrier integration is configured.
                      </p>
                    </AdminActionForm>
                  ) : null}

                  <div className="mt-6 rounded-xl bg-surface-alt p-4">
                    <h4 className="font-semibold text-strong">Allocated lines</h4>
                    {shipment.items.length ? (
                      <ul className="mt-3 space-y-2 text-sm text-body">
                        {shipment.items.map((item, index) => (
                          <li key={`${shipment.publicId}:${index}`}>
                            {item.quantity} × {item.productName} · {item.variantName ?? "Default variant"}{item.sku ? ` · ${item.sku}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-muted">
                        No active line allocations. Canceled draft allocations are released.
                      </p>
                    )}
                  </div>

                  <section className="mt-6 rounded-xl border border-line p-5">
                    <h4 className="font-semibold text-strong">
                      Packages ({shipment.packages.length})
                    </h4>
                    {shipment.packages.length ? (
                      <div className="mt-4 space-y-4">
                        {shipment.packages.map((parcel) => (
                          <article key={parcel.publicId} className="rounded-xl bg-surface-alt p-4">
                            <p className="text-sm font-semibold text-strong">
                              Package {parcel.packageNumber}
                            </p>
                            <p className="mt-1 text-xs text-muted">
                              {parcel.weightGrams ? `${parcel.weightGrams.toLocaleString("en-US")} g` : "Weight not set"}
                              {parcel.lengthMillimeters && parcel.widthMillimeters && parcel.heightMillimeters
                                ? ` · ${parcel.lengthMillimeters} × ${parcel.widthMillimeters} × ${parcel.heightMillimeters} mm`
                                : " · Dimensions not set"}
                            </p>
                            {order.canManage && canEditPackages ? (
                              <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                                <AdminActionForm
                                  action={updatePackageAction}
                                  submitLabel="Save package"
                                  className="grid gap-3 md:grid-cols-4"
                                >
                                  <input type="hidden" name="packagePublicId" value={parcel.publicId} />
                                  <label className={labelClass}>Weight g<input className={inputClass} name="weightGrams" inputMode="numeric" defaultValue={parcel.weightGrams ?? ""} /></label>
                                  <label className={labelClass}>Length mm<input className={inputClass} name="lengthMillimeters" inputMode="numeric" defaultValue={parcel.lengthMillimeters ?? ""} /></label>
                                  <label className={labelClass}>Width mm<input className={inputClass} name="widthMillimeters" inputMode="numeric" defaultValue={parcel.widthMillimeters ?? ""} /></label>
                                  <label className={labelClass}>Height mm<input className={inputClass} name="heightMillimeters" inputMode="numeric" defaultValue={parcel.heightMillimeters ?? ""} /></label>
                                </AdminActionForm>
                                <AdminActionForm
                                  action={deletePackageAction}
                                  submitLabel="Remove package"
                                  className="self-end"
                                >
                                  <input type="hidden" name="packagePublicId" value={parcel.publicId} />
                                </AdminActionForm>
                              </div>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-muted">No package records yet.</p>
                    )}
                    {order.canManage && canEditPackages ? (
                      <AdminActionForm
                        action={createPackageAction}
                        submitLabel="Add package"
                        className="mt-5 grid gap-3 md:grid-cols-4"
                      >
                        <input type="hidden" name="shipmentPublicId" value={shipment.publicId} />
                        <label className={labelClass}>Weight g<input className={inputClass} name="weightGrams" inputMode="numeric" /></label>
                        <label className={labelClass}>Length mm<input className={inputClass} name="lengthMillimeters" inputMode="numeric" /></label>
                        <label className={labelClass}>Width mm<input className={inputClass} name="widthMillimeters" inputMode="numeric" /></label>
                        <label className={labelClass}>Height mm<input className={inputClass} name="heightMillimeters" inputMode="numeric" /></label>
                      </AdminActionForm>
                    ) : order.canManage ? (
                      <p className="mt-3 text-xs text-muted">
                        Package records are locked after the shipment leaves label-created status.
                      </p>
                    ) : null}
                  </section>

                  {order.canManage && transitions.length ? (
                    <AdminActionForm
                      action={updateShipmentStatusAction}
                      submitLabel="Update shipment status"
                      className="mt-6 space-y-5 rounded-xl border border-line p-5"
                    >
                      <input type="hidden" name="shipmentPublicId" value={shipment.publicId} />
                      <label className={labelClass}>
                        Allowed next status
                        <select className={inputClass} name="status" required defaultValue="">
                          <option value="" disabled>Select status</option>
                          {transitions.map((status) => (
                            <option key={status} value={status}>{humanizeCommerceStatus(status)}</option>
                          ))}
                        </select>
                      </label>
                      {transitions.includes("CANCELED") ? (
                        <p className="text-xs text-muted">
                          Canceling releases this draft/labeled shipment’s line allocations and is terminal.
                        </p>
                      ) : null}
                    </AdminActionForm>
                  ) : null}

                  {order.canManage && canAdvanceTracking ? (
                    <AdminActionForm
                      action={addTrackingEventAction}
                      submitLabel="Add tracking event"
                      className="mt-6 space-y-5 rounded-xl border border-line p-5"
                    >
                      <input type="hidden" name="shipmentPublicId" value={shipment.publicId} />
                      <div className="grid gap-5 md:grid-cols-2">
                        <label className={labelClass}>
                          Event status
                          <select className={inputClass} name="status" defaultValue="INFO">
                            <option value="INFO">Information</option>
                            <option value="LABEL_CREATED">Label created</option>
                            <option value="PICKED_UP">Picked up</option>
                            <option value="IN_TRANSIT">In transit</option>
                            <option value="OUT_FOR_DELIVERY">Out for delivery</option>
                            <option value="DELIVERED">Delivered</option>
                            <option value="EXCEPTION">Exception</option>
                            <option value="RETURNED">Returned</option>
                          </select>
                        </label>
                        <label className={labelClass}>
                          Occurred at (ISO with timezone)
                          <input className={inputClass} name="occurredAt" required maxLength={40} defaultValue={eventTimeDefault} />
                        </label>
                        <label className={labelClass}>
                          Location (optional)
                          <input className={inputClass} name="location" maxLength={255} />
                        </label>
                        <label className={labelClass}>
                          Message
                          <input className={inputClass} name="message" maxLength={5000} placeholder="Required for an information event" />
                        </label>
                      </div>
                    </AdminActionForm>
                  ) : order.canManage && order.paymentStatus !== "PAID" ? (
                    <p
                      role="alert"
                      className="mt-6 rounded-xl border border-red-800/20 bg-red-50 p-4 text-sm text-red-900"
                    >
                      Tracking events that would dispatch this shipment are
                      disabled until payment returns to paid. Cancel this
                      pre-dispatch shipment if it should not proceed.
                    </p>
                  ) : null}

                  <section className="mt-7">
                    <h4 className="font-semibold text-strong">
                      Tracking history ({shipment.trackingEvents.length})
                    </h4>
                    {shipment.trackingEvents.length ? (
                      <ol className="mt-4 space-y-3">
                        {shipment.trackingEvents.map((event) => (
                          <li key={event.publicId} className="rounded-xl bg-surface-alt p-4 text-sm">
                            <div className="flex flex-wrap justify-between gap-2">
                              <p className="font-semibold text-strong">{humanizeCommerceStatus(event.status)}</p>
                              <time className="text-xs text-muted">{formatDate(event.occurredAt)}</time>
                            </div>
                            {event.message ? <p className="mt-2 text-body">{event.message}</p> : null}
                            {event.location ? <p className="mt-1 text-xs text-muted">{event.location}</p> : null}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="mt-3 text-sm text-muted">No tracking events recorded.</p>
                    )}
                  </section>
                </article>
              );
            })}
          </div>
          {!order.shipments.length ? <p className="mt-6 text-body">No shipments for this order.</p> : null}
        </section>
      </div>
    </section>
  );
}
