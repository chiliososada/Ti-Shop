import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { upsertAfterSalesEventAction } from "@/app/admin/finance/after-sales/actions";
import { formatUsdMinor } from "@/domain/money";
import { buildQueryHref, type SearchParameter } from "@/lib/pagination";
import type { AfterSalesIndexFilters } from "@/server/admin/finance/after-sales/queries";
import { getAdminAfterSalesIndex } from "@/server/admin/finance/after-sales/queries";

export const metadata: Metadata = {
  title: "After-sales administration",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

function pageHref(filters: AfterSalesIndexFilters, page: number) {
  return buildQueryHref("/admin/finance/after-sales", {
    q: filters.q,
    status: filters.status,
    page,
  });
}

export default async function AdminAfterSalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const { filters, pagination, events } = await getAdminAfterSalesIndex(
    await searchParams,
  );

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-12">
        <header className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <Link href="/admin/finance" className="text-sm font-semibold text-sage-700">
              ← Finance
            </Link>
            <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
              Returns, refunds &amp; compensation
            </p>
            <h1 className="text-h2 text-strong">After-sales events</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              Every refund, return, replacement, and gift is recorded here with
              its real stock movements and append-only profit adjustments.
            </p>
          </div>
          <Link
            href="/admin/finance/after-sales/export"
            className="rounded-xl border border-ink-900/15 bg-white px-4 py-2.5 text-sm font-semibold text-strong hover:border-sage-600"
          >
            Export CSV
          </Link>
        </header>

        <form method="get" action="/admin/finance/after-sales" className="grid gap-4 rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:grid-cols-4">
          <label className={labelClass}>
            Search
            <input className={inputClass} name="q" defaultValue={filters.q} maxLength={120} placeholder="Order number, email, or reason" />
          </label>
          <label className={labelClass}>
            Status
            <select className={inputClass} name="status" defaultValue={filters.status}>
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="APPROVED">Approved</option>
              <option value="COMPLETED">Completed</option>
              <option value="VOIDED">Voided</option>
            </select>
          </label>
          <div className="flex items-end gap-3 md:col-span-2">
            <button type="submit" className="rounded-xl bg-ink-900 px-5 py-3 text-sm font-semibold text-white hover:bg-ink-700">
              Apply filters
            </button>
            <Link href="/admin/finance/after-sales" className="rounded-xl border border-ink-900/15 bg-white px-5 py-3 text-sm font-semibold text-strong hover:border-sage-600">
              Reset
            </Link>
          </div>
        </form>

        <div className="overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-900/[0.08] text-xs uppercase text-muted">
                <th className="px-5 py-4">Event</th>
                <th className="px-5 py-4">Order</th>
                <th className="px-5 py-4">Customer</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Responsibility</th>
                <th className="px-5 py-4">Refund total</th>
                <th className="px-5 py-4">Items</th>
                <th className="px-5 py-4">Completed</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-muted">
                    No after-sales events match the current filters. Create one
                    below with the original order&apos;s id.
                  </td>
                </tr>
              ) : (
                events.map((event) => (
                  <tr key={event.publicId} className="border-b border-ink-900/[0.04]">
                    <td className="px-5 py-4">
                      <Link href={`/admin/finance/after-sales/${event.publicId}`} className="font-semibold text-sage-700">
                        {event.reason.slice(0, 40)}{event.reason.length > 40 ? "…" : ""}
                      </Link>
                    </td>
                    <td className="px-5 py-4">
                      <Link href={`/admin/orders/${event.orderPublicId}`} className="text-sage-700">
                        {event.orderNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-4">{event.customerEmail}</td>
                    <td className="px-5 py-4">{event.status}</td>
                    <td className="px-5 py-4">{event.responsibility}</td>
                    <td className="px-5 py-4">{formatUsdMinor(event.refundTotalMinor)}</td>
                    <td className="px-5 py-4">{event.itemCount}</td>
                    <td className="px-5 py-4">{event.completedAt ? event.completedAt.slice(0, 10) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination.pageCount > 1 ? (
          <nav className="flex items-center gap-3 text-sm" aria-label="Pagination">
            {pagination.page > 1 ? (
              <Link className="font-semibold text-sage-700" href={pageHref(filters, pagination.page - 1)}>
                ← Previous
              </Link>
            ) : null}
            <span className="text-muted">
              Page {pagination.page} of {pagination.pageCount} · {pagination.total} events
            </span>
            {pagination.page < pagination.pageCount ? (
              <Link className="font-semibold text-sage-700" href={pageHref(filters, pagination.page + 1)}>
                Next →
              </Link>
            ) : null}
          </nav>
        ) : null}

        <article className="rounded-2xl border border-dashed border-sage-700/30 bg-surface p-6">
          <h2 className="text-h4 text-strong">New after-sales event</h2>
          <p className="mt-2 text-xs text-muted">
            Amounts are in USD. Items (returns/compensation goods) are added on
            the event page after creation; nothing affects stock or profit
            until the event is approved and completed.
          </p>
          <AdminActionForm action={upsertAfterSalesEventAction} className="mt-6 space-y-5" submitLabel="Create event">
            <div className="grid gap-5 md:grid-cols-3">
              <label className={labelClass}>
                Original order public id
                <input className={inputClass} name="orderPublicId" required maxLength={36} placeholder="Order UUID from the order page" />
              </label>
              <label className={labelClass}>
                Responsibility
                <select className={inputClass} name="responsibility" defaultValue="MERCHANT">
                  <option value="MERCHANT">Merchant</option>
                  <option value="CARRIER">Carrier</option>
                  <option value="SUPPLIER">Supplier</option>
                  <option value="CUSTOMER">Customer</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <label className={labelClass}>Refund amount (USD)<input className={inputClass} name="refundAmount" inputMode="decimal" maxLength={16} placeholder="0.00" /></label>
              <label className={labelClass}>Shipping refund (USD)<input className={inputClass} name="shippingRefund" inputMode="decimal" maxLength={16} placeholder="0.00" /></label>
              <label className={labelClass}>Return shipping cost (USD)<input className={inputClass} name="returnShippingCost" inputMode="decimal" maxLength={16} placeholder="0.00" /></label>
              <label className={labelClass}>Compensation shipping cost (USD)<input className={inputClass} name="compensationShippingCost" inputMode="decimal" maxLength={16} placeholder="0.00" /></label>
            </div>
            <label className={labelClass}>Reason<textarea className={inputClass} name="reason" rows={2} maxLength={4000} required /></label>
            <label className={labelClass}>Evidence / internal notes<textarea className={inputClass} name="evidenceNotes" rows={2} maxLength={8000} /></label>
          </AdminActionForm>
        </article>
      </div>
    </section>
  );
}
