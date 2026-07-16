import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { humanizeCommerceStatus } from "@/domain/order";
import { buildQueryHref, type SearchParameter } from "@/lib/pagination";
import type { AdminFulfillmentIndexFilters } from "@/server/admin/fulfillment/queries";
import { getAdminFulfillmentIndex } from "@/server/admin/fulfillment/queries";

import { createCarrierAction, updateCarrierAction } from "./actions";

export const metadata: Metadata = {
  title: "Fulfillment administration",
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

function fulfillmentHref(
  filters: AdminFulfillmentIndexFilters,
  pages: { pendingPage?: number; shipmentPage?: number },
) {
  return buildQueryHref("/admin/fulfillment", {
    pendingPage: pages.pendingPage ?? filters.pendingPage,
    shipmentPage: pages.shipmentPage ?? filters.shipmentPage,
    shipmentQ: filters.shipmentQ,
    shipmentStatus: filters.shipmentStatus,
  });
}

export default async function AdminFulfillmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const fulfillment = await getAdminFulfillmentIndex(await searchParams);

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header>
          <Link href="/admin" className="text-sm font-semibold text-sage-700">
            ← Administration
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Fulfillment
          </p>
          <h1 className="mt-3 text-h2 text-strong">Shipments and carriers</h1>
          <p className="mt-3 max-w-3xl text-body">
            Allocate confirmed order lines, record manually supplied tracking
            events, and maintain carrier labels. Tracking templates are stored
            formatting aids—not verified live carrier integrations.
          </p>
        </header>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-h4 text-strong">
                Orders needing fulfillment ({fulfillment.pendingOrderPagination.total})
              </h2>
              <p className="mt-2 text-sm text-muted">
                Paid, confirmed or processing orders with unallocated quantities.
              </p>
            </div>
            <Link className="text-sm font-semibold text-sage-700" href="/admin/orders">
              Review all orders
            </Link>
          </div>
          {fulfillment.pendingOrders.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="py-3 pr-4">Order</th>
                    <th className="py-3 pr-4">Customer</th>
                    <th className="py-3 pr-4">Payment</th>
                    <th className="py-3 pr-4">Fulfillment</th>
                    <th className="py-3 pr-4">Confirmed</th>
                    <th className="py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {fulfillment.pendingOrders.map((order) => (
                    <tr key={order.publicId}>
                      <td className="py-4 pr-4">
                        <p className="font-mono text-xs font-semibold text-sage-700">
                          {order.orderNumber}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {humanizeCommerceStatus(order.status)} · {order.shipmentCount} shipment
                          {order.shipmentCount === 1 ? "" : "s"}
                        </p>
                      </td>
                      <td className="py-4 pr-4 font-semibold text-strong">
                        {order.customerEmail}
                      </td>
                      <td className="py-4 pr-4">
                        {humanizeCommerceStatus(order.paymentStatus)}
                      </td>
                      <td className="py-4 pr-4">
                        <p>{humanizeCommerceStatus(order.fulfillmentStatus)}</p>
                        <p className="mt-1 text-xs text-muted">
                          {order.fulfilledQuantity}/{order.orderedQuantity} allocated · {order.remainingQuantity} remaining
                        </p>
                      </td>
                      <td className="py-4 pr-4">{formatDate(order.confirmedAt)}</td>
                      <td className="py-4">
                        <Link
                          className="font-semibold text-sage-700"
                          href={`/admin/fulfillment/orders/${order.publicId}`}
                        >
                          Fulfill
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-6 text-body">No confirmed orders need fulfillment.</p>
          )}
          <nav className="mt-6 flex flex-wrap items-center justify-between gap-4" aria-label="Orders needing fulfillment pagination">
            {fulfillment.pendingOrderPagination.page > 1 ? (
              <Link
                href={fulfillmentHref(fulfillment.filters, {
                  pendingPage: fulfillment.pendingOrderPagination.page - 1,
                })}
                className="font-semibold text-sage-700"
              >
                ← Previous orders
              </Link>
            ) : (
              <span className="text-sm text-muted">First order page</span>
            )}
            <span className="text-sm text-muted">
              Page {fulfillment.pendingOrderPagination.page} of {fulfillment.pendingOrderPagination.pageCount}
            </span>
            {fulfillment.pendingOrderPagination.page < fulfillment.pendingOrderPagination.pageCount ? (
              <Link
                href={fulfillmentHref(fulfillment.filters, {
                  pendingPage: fulfillment.pendingOrderPagination.page + 1,
                })}
                className="font-semibold text-sage-700"
              >
                Next orders →
              </Link>
            ) : (
              <span className="text-sm text-muted">Last order page</span>
            )}
          </nav>
        </section>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-h4 text-strong">
              Shipments ({fulfillment.shipmentPagination.total})
            </h2>
            <p className="text-caption text-muted">
              Page {fulfillment.shipmentPagination.page} of {fulfillment.shipmentPagination.pageCount}
            </p>
          </div>
          <form action="/admin/fulfillment" method="get" className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.4fr)_auto] md:items-end">
            <input type="hidden" name="pendingPage" value={fulfillment.filters.pendingPage} />
            <label className="text-sm font-semibold text-strong">
              Shipment, tracking, order, or email
              <input
                name="shipmentQ"
                maxLength={120}
                defaultValue={fulfillment.filters.shipmentQ}
                className={inputClass}
                placeholder="Search shipments"
              />
            </label>
            <label className="text-sm font-semibold text-strong">
              Shipment status
              <select name="shipmentStatus" defaultValue={fulfillment.filters.shipmentStatus} className={inputClass}>
                <option value="">All statuses</option>
                {["DRAFT", "LABEL_CREATED", "IN_TRANSIT", "DELIVERED", "EXCEPTION", "RETURNED", "CANCELED"].map((status) => (
                  <option key={status} value={status}>{humanizeCommerceStatus(status)}</option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-3">
              <button type="submit" className="rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-white">Apply</button>
              <Link href="/admin/fulfillment" className="rounded-full border border-ink-900/15 px-5 py-3 text-sm font-semibold text-strong">Reset</Link>
            </div>
          </form>
          {fulfillment.shipments.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="py-3 pr-4">Shipment</th>
                    <th className="py-3 pr-4">Order owner</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4">Carrier</th>
                    <th className="py-3 pr-4">Tracking number</th>
                    <th className="py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {fulfillment.shipments.map((shipment) => (
                    <tr key={shipment.publicId}>
                      <td className="py-4 pr-4">
                        <Link
                          className="font-mono text-xs font-semibold text-sage-700"
                          href={`/admin/fulfillment/orders/${shipment.order.publicId}`}
                        >
                          {shipment.shipmentNumber}
                        </Link>
                        <p className="mt-1 text-xs text-muted">
                          {shipment.itemQuantity} item{shipment.itemQuantity === 1 ? "" : "s"} · {shipment.packageCount} package{shipment.packageCount === 1 ? "" : "s"} · {shipment.trackingEventCount} event{shipment.trackingEventCount === 1 ? "" : "s"}
                        </p>
                      </td>
                      <td className="py-4 pr-4">
                        <p className="font-semibold text-strong">{shipment.order.orderNumber}</p>
                        <p className="mt-1 text-xs text-muted">{shipment.order.customerEmail}</p>
                        <p
                          className={`mt-1 text-xs font-semibold ${
                            shipment.order.paymentStatus === "PAID"
                              ? "text-muted"
                              : "text-red-800"
                          }`}
                        >
                          Payment: {humanizeCommerceStatus(shipment.order.paymentStatus)}
                        </p>
                      </td>
                      <td className="py-4 pr-4">
                        {humanizeCommerceStatus(shipment.status)}
                      </td>
                      <td className="py-4 pr-4">
                        {shipment.carrier
                          ? `${shipment.carrier.name} (${shipment.carrier.code})`
                          : "No carrier"}
                      </td>
                      <td className="py-4 pr-4 font-mono text-xs">
                        {shipment.trackingNumber ?? "Not set"}
                        <p className="mt-1 font-sans text-xs text-muted">
                          ETA: {formatDate(shipment.estimatedDeliveryAt)}
                        </p>
                      </td>
                      <td className="py-4">{formatDate(shipment.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-6 text-body">No shipments match these filters.</p>
          )}
          <nav className="mt-6 flex flex-wrap items-center justify-between gap-4" aria-label="Shipment pagination">
            {fulfillment.shipmentPagination.page > 1 ? (
              <Link
                href={fulfillmentHref(fulfillment.filters, {
                  shipmentPage: fulfillment.shipmentPagination.page - 1,
                })}
                className="font-semibold text-sage-700"
              >
                ← Previous shipments
              </Link>
            ) : (
              <span className="text-sm text-muted">First shipment page</span>
            )}
            {fulfillment.shipmentPagination.page < fulfillment.shipmentPagination.pageCount ? (
              <Link
                href={fulfillmentHref(fulfillment.filters, {
                  shipmentPage: fulfillment.shipmentPagination.page + 1,
                })}
                className="font-semibold text-sage-700"
              >
                Next shipments →
              </Link>
            ) : (
              <span className="text-sm text-muted">Last shipment page</span>
            )}
          </nav>
        </section>

        <section className="space-y-6">
          <div>
            <h2 className="text-h3 text-strong">Carrier directory</h2>
            <p className="mt-2 max-w-3xl text-body">
              Codes become immutable after creation. HTTPS tracking templates
              must contain {"{trackingNumber}"}; the site does not validate
              them against a carrier or use them as evidence of delivery.
            </p>
          </div>

          {fulfillment.canManage ? (
            <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
              <h3 className="text-h4 text-strong">Add carrier</h3>
              <AdminActionForm
                action={createCarrierAction}
                submitLabel="Create carrier"
                className="mt-6 space-y-5"
              >
                <div className="grid gap-5 md:grid-cols-2">
                  <label className={labelClass}>
                    Immutable code
                    <input className={inputClass} name="code" required maxLength={40} placeholder="UPS_US" />
                  </label>
                  <label className={labelClass}>
                    Display name
                    <input className={inputClass} name="name" required maxLength={160} />
                  </label>
                </div>
                <label className={labelClass}>
                  Tracking URL template (optional)
                  <input
                    className={inputClass}
                    name="trackingUrlTemplate"
                    type="text"
                    maxLength={2048}
                    placeholder="https://carrier.example/track/{trackingNumber}"
                  />
                </label>
                <label className="flex items-center gap-3 text-sm font-semibold text-strong">
                  <input type="checkbox" name="isActive" defaultChecked /> Active for new shipments
                </label>
              </AdminActionForm>
            </article>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-2">
            {fulfillment.carriers.map((carrier) => (
              <article
                key={carrier.publicId}
                className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-caption text-sage-700">{carrier.code}</p>
                    <h3 className="mt-2 text-h4 text-strong">{carrier.name}</h3>
                  </div>
                  <span className="rounded-full bg-surface-alt px-3 py-1 text-caption font-semibold text-strong">
                    {carrier.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <p className="mt-3 text-sm text-muted">
                  {carrier.shipmentCount} shipment{carrier.shipmentCount === 1 ? "" : "s"} · Updated {formatDate(carrier.updatedAt)}
                </p>
                {fulfillment.canManage ? (
                  <AdminActionForm
                    action={updateCarrierAction}
                    submitLabel="Save carrier"
                    className="mt-6 space-y-5"
                  >
                    <input type="hidden" name="carrierPublicId" value={carrier.publicId} />
                    <label className={labelClass}>
                      Display name
                      <input className={inputClass} name="name" required maxLength={160} defaultValue={carrier.name} />
                    </label>
                    <label className={labelClass}>
                      Unverified tracking template
                      <input
                        className={inputClass}
                        name="trackingUrlTemplate"
                        type="text"
                        maxLength={2048}
                        defaultValue={carrier.trackingUrlTemplate ?? ""}
                        placeholder="https://carrier.example/track/{trackingNumber}"
                      />
                    </label>
                    <label className="flex items-center gap-3 text-sm font-semibold text-strong">
                      <input type="checkbox" name="isActive" defaultChecked={carrier.isActive} /> Active for new shipments
                    </label>
                  </AdminActionForm>
                ) : (
                  <div className="mt-5 rounded-xl bg-surface-alt p-4 text-sm text-body">
                    <p className="break-all font-mono text-xs">
                      {carrier.trackingUrlTemplate ?? "No tracking template"}
                    </p>
                    <p className="mt-3 text-muted">
                      You need fulfillment.manage to edit this carrier.
                    </p>
                  </div>
                )}
              </article>
            ))}
          </div>
          {!fulfillment.carriers.length ? (
            <p className="text-body">No carriers have been configured.</p>
          ) : null}
        </section>
      </div>
    </section>
  );
}
