import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { formatUsdMinor } from "@/domain/money";
import { humanizeCommerceStatus } from "@/domain/order";
import {
  buildQueryHref,
  normalizePageSearchParameter,
  type SearchParameter,
} from "@/lib/pagination";
import { listCurrentUserOrders } from "@/server/orders/queries";
import { DISPLAY_TIME_ZONE } from "@/lib/display-timezone";

export const metadata: Metadata = {
  title: "My orders",
  robots: { index: false, follow: false },
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

export default async function CustomerOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const query = await searchParams;
  const { orders, pagination } = await listCurrentUserOrders(
    normalizePageSearchParameter(query.page),
  );

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <p className="font-mono text-eyebrow uppercase text-sage-600">
              Customer account
            </p>
            <h1 className="mt-4 text-h2 text-strong">Orders</h1>
            <p className="mt-3 text-body">
              Payment, fulfillment, shipment, and tracking status appear here.
            </p>
          </div>
          <Link
            href="/checkout"
            className="inline-flex rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-cream-50 hover:bg-sage-600"
          >
            Go to checkout
          </Link>
        </div>

        {pagination.total === 0 ? (
          <div className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-8 text-center">
            <h2 className="text-h4 text-strong">No orders yet</h2>
            <p className="mt-3 text-body">
              Fixed-price products can be placed as pending orders from checkout.
            </p>
            <Link
              href="/products"
              className="mt-6 inline-flex rounded-full border border-ink-900/15 px-6 py-3 text-sm font-semibold text-strong hover:bg-surface-alt"
            >
              Browse products
            </Link>
          </div>
        ) : (
          <div className="mt-10 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
              <p>
                {pagination.total} order{pagination.total === 1 ? "" : "s"}
              </p>
              <p>
                Page {pagination.page} of {pagination.pageCount}
              </p>
            </div>
            {orders.map((order) => (
              <Link
                key={order.publicId}
                href={`/account/orders/${order.publicId}`}
                className="grid gap-5 rounded-2xl border border-ink-900/[0.08] bg-surface p-6 transition hover:border-sage-300 hover:shadow-sm md:grid-cols-[1.25fr_repeat(4,minmax(0,1fr))] md:items-center"
              >
                <div>
                  <p className="font-mono text-caption text-sage-700">
                    {order.orderNumber}
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    {formatDate(order.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-caption uppercase tracking-wider text-muted">Order</p>
                  <p className="mt-1 text-sm font-semibold text-strong">
                    {humanizeCommerceStatus(order.status)}
                  </p>
                </div>
                <div>
                  <p className="text-caption uppercase tracking-wider text-muted">Payment</p>
                  <p className="mt-1 text-sm font-semibold text-strong">
                    {humanizeCommerceStatus(order.paymentStatus)}
                  </p>
                </div>
                <div>
                  <p className="text-caption uppercase tracking-wider text-muted">Fulfillment</p>
                  <p className="mt-1 text-sm font-semibold text-strong">
                    {humanizeCommerceStatus(order.fulfillmentStatus)}
                  </p>
                </div>
                <div className="md:text-right">
                  <p className="text-caption text-muted">
                    {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
                  </p>
                  <p className="mt-1 text-h5 text-strong">
                    {order.currency === "USD"
                      ? formatUsdMinor(order.totalMinor)
                      : `${order.currency} ${order.totalMinor}`}
                  </p>
                </div>
              </Link>
            ))}
            <nav
              aria-label="Order history pagination"
              className="flex flex-wrap items-center justify-between gap-4 pt-3"
            >
              {pagination.page > 1 ? (
                <Link
                  href={buildQueryHref("/account/orders", {
                    page: pagination.page - 1,
                  })}
                  className="font-semibold text-sage-700"
                >
                  ← Previous page
                </Link>
              ) : (
                <span className="text-sm text-muted">First page</span>
              )}
              {pagination.page < pagination.pageCount ? (
                <Link
                  href={buildQueryHref("/account/orders", {
                    page: pagination.page + 1,
                  })}
                  className="font-semibold text-sage-700"
                >
                  Next page →
                </Link>
              ) : (
                <span className="text-sm text-muted">Last page</span>
              )}
            </nav>
          </div>
        )}
      </div>
    </section>
  );
}
