import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { formatUsdMinor } from "@/domain/money";
import {
  humanizeCommerceStatus,
  PAYMENT_METHOD_LABELS,
} from "@/domain/order";
import { buildQueryHref, type SearchParameter } from "@/lib/pagination";
import type { AdminOrderIndexFilters } from "@/server/admin/orders/queries";
import { getAdminOrderIndex } from "@/server/admin/orders/queries";
import { DISPLAY_TIME_ZONE } from "@/lib/display-timezone";

export const metadata: Metadata = {
  title: "Order administration",
  robots: { index: false, follow: false },
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

function displayMoney(value: string, currency: string) {
  return currency === "USD" ? formatUsdMinor(value) : `${currency} ${value}`;
}

function pageHref(filters: AdminOrderIndexFilters, page: number) {
  return buildQueryHref("/admin/orders", {
    q: filters.q,
    orderStatus: filters.orderStatus,
    paymentStatus: filters.paymentStatus,
    fulfillmentStatus: filters.fulfillmentStatus,
    review: filters.review,
    page,
  });
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const result = await getAdminOrderIndex(await searchParams);
  const { orders } = result;

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x">
        <header className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <Link href="/admin" className="text-sm font-semibold text-sage-700">
              ← Administration
            </Link>
            <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
              Operations
            </p>
            <h1 className="mt-3 text-h2 text-strong">Orders and payments</h1>
            <p className="mt-3 max-w-3xl text-body">
              Review order, payment, and fulfillment state. Provider callbacks
              and payment-address data are intentionally excluded from this view.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {result.canCreateManualOrder ? (
              <Link
                href="/admin/orders/new"
                className="inline-flex rounded-full bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink-800"
              >
                Create manual order
              </Link>
            ) : null}
            <Link
              href="/admin/payments"
              className="inline-flex rounded-full border border-ink-900/15 px-5 py-2.5 text-sm font-semibold text-strong hover:bg-surface-alt"
            >
              Payment settings
            </Link>
          </div>
        </header>

        <form
          action="/admin/orders"
          method="get"
          className="mt-10 grid gap-4 rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:grid-cols-2 xl:grid-cols-5"
        >
          <label className="text-sm font-semibold text-strong xl:col-span-2">
            Order number or customer email
            <input
              name="q"
              maxLength={120}
              defaultValue={result.filters.q}
              placeholder="Order number or email"
              className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
            />
          </label>
          <label className="text-sm font-semibold text-strong">
            Order status
            <select
              name="orderStatus"
              defaultValue={result.filters.orderStatus}
              className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
            >
              <option value="">All order statuses</option>
              {["DRAFT", "PENDING_PAYMENT", "CONFIRMED", "PROCESSING", "COMPLETED", "CANCELED"].map((status) => (
                <option key={status} value={status}>{humanizeCommerceStatus(status)}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-strong">
            Payment status
            <select
              name="paymentStatus"
              defaultValue={result.filters.paymentStatus}
              className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
            >
              <option value="">All payment statuses</option>
              {["UNPAID", "PENDING", "PARTIALLY_PAID", "PAID", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED", "VOIDED"].map((status) => (
                <option key={status} value={status}>{humanizeCommerceStatus(status)}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-strong">
            Fulfillment status
            <select
              name="fulfillmentStatus"
              defaultValue={result.filters.fulfillmentStatus}
              className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
            >
              <option value="">All fulfillment statuses</option>
              {["UNFULFILLED", "PARTIAL", "FULFILLED", "RETURNED", "CANCELED"].map((status) => (
                <option key={status} value={status}>{humanizeCommerceStatus(status)}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-strong">
            Needs a decision
            <select
              name="review"
              defaultValue={result.filters.review}
              className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
            >
              <option value="">Any payment attempt</option>
              <option value="required">Awaiting payment review</option>
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-3 md:col-span-2 xl:col-span-5">
            <button type="submit" className="rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-white">
              Apply filters
            </button>
            <Link href="/admin/orders" className="rounded-full border border-ink-900/15 px-6 py-3 text-sm font-semibold text-strong">
              Reset
            </Link>
          </div>
        </form>

        <div className="mt-10 overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-h4 text-strong">Orders ({result.pagination.total})</h2>
            <p className="text-caption text-muted">
              Page {result.pagination.page} of {result.pagination.pageCount}
            </p>
          </div>
          {orders.length ? (
            <table className="mt-5 w-full min-w-[1040px] text-left text-sm">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="py-3 pr-4">Order</th>
                  <th className="py-3 pr-4">Customer</th>
                  <th className="py-3 pr-4">Order status</th>
                  <th className="py-3 pr-4">Payment</th>
                  <th className="py-3 pr-4">Fulfillment</th>
                  <th className="py-3 pr-4">Total</th>
                  <th className="py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.map((order) => (
                  <tr key={order.publicId}>
                    <td className="py-4 pr-4">
                      <p className="font-mono text-xs font-semibold text-sage-700">
                        {order.orderNumber}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {formatDate(order.createdAt)} CT
                      </p>
                    </td>
                    <td className="py-4 pr-4">
                      <p className="font-semibold text-strong">{order.customerEmail}</p>
                      <p className="mt-1 text-xs text-muted">
                        {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
                      </p>
                    </td>
                    <td className="py-4 pr-4">
                      {humanizeCommerceStatus(order.status)}
                    </td>
                    <td className="py-4 pr-4">
                      <p className="font-semibold text-strong">
                        {humanizeCommerceStatus(order.paymentStatus)}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {order.paymentAttempts.length
                          ? order.paymentAttempts
                              .map(
                                (payment) =>
                                  `${PAYMENT_METHOD_LABELS[payment.method]}: ${humanizeCommerceStatus(payment.status)}`,
                              )
                              .join(" · ")
                          : "No attempts"}
                      </p>
                    </td>
                    <td className="py-4 pr-4">
                      <p>{humanizeCommerceStatus(order.fulfillmentStatus)}</p>
                      <p className="mt-1 text-xs text-muted">
                        {order.shipmentCount} shipment
                        {order.shipmentCount === 1 ? "" : "s"}
                      </p>
                    </td>
                    <td className="py-4 pr-4 font-semibold text-strong">
                      {displayMoney(order.totalMinor, order.currency)}
                    </td>
                    <td className="py-4">
                      <Link
                        href={`/admin/orders/${order.publicId}`}
                        className="font-semibold text-sage-700"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-10 text-body">No orders match these filters.</p>
          )}
          <nav className="mt-6 flex flex-wrap items-center justify-between gap-4" aria-label="Order administration pagination">
            {result.pagination.page > 1 ? (
              <Link href={pageHref(result.filters, result.pagination.page - 1)} className="font-semibold text-sage-700">
                ← Previous page
              </Link>
            ) : (
              <span className="text-sm text-muted">First page</span>
            )}
            {result.pagination.page < result.pagination.pageCount ? (
              <Link href={pageHref(result.filters, result.pagination.page + 1)} className="font-semibold text-sage-700">
                Next page →
              </Link>
            ) : (
              <span className="text-sm text-muted">Last page</span>
            )}
          </nav>
        </div>
      </div>
    </section>
  );
}
