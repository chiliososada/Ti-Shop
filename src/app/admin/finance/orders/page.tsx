import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import {
  bpsPercent,
  financeInputClass,
  financeLabelClass,
  signedUsd,
} from "@/app/admin/finance/_components/format";
import { buildQueryHref, type SearchParameter } from "@/lib/pagination";
import type { FinanceOrderIndexFilters } from "@/server/admin/finance/reports/queries";
import { getFinanceOrderIndex } from "@/server/admin/finance/reports/queries";

export const metadata: Metadata = {
  title: "Order profit",
  robots: { index: false, follow: false },
};

function pageHref(filters: FinanceOrderIndexFilters, page: number) {
  return buildQueryHref("/admin/finance/orders", {
    q: filters.q,
    state: filters.state,
    page,
  });
}

export default async function FinanceOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const { filters, pagination, rows } = await getFinanceOrderIndex(await searchParams);

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <Link href="/admin/finance" className="text-sm font-semibold text-sage-700">
              ← Finance
            </Link>
            <h1 className="mt-4 text-h2 text-strong">Order profit</h1>
            <p className="mt-2 text-sm text-muted">
              Confirmed orders with revenue, snapshot COGS, and final profit.
              Estimated rows are missing actual costs.
            </p>
          </div>
          <Link
            href="/admin/finance/orders/export"
            className="rounded-xl border border-ink-900/15 bg-white px-4 py-2.5 text-sm font-semibold text-strong hover:border-sage-600"
          >
            Export CSV
          </Link>
        </header>

        <form method="get" action="/admin/finance/orders" className="grid gap-4 rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:grid-cols-4">
          <label className={financeLabelClass}>
            Search
            <input className={financeInputClass} name="q" defaultValue={filters.q} maxLength={120} placeholder="Order number or email" />
          </label>
          <label className={financeLabelClass}>
            State
            <select className={financeInputClass} name="state" defaultValue={filters.state}>
              <option value="">All</option>
              <option value="estimated">Estimated only</option>
              <option value="finalized">Finalized only</option>
              <option value="unsettled">Not yet settled</option>
              <option value="settled">Settled</option>
            </select>
          </label>
          <div className="flex items-end gap-3 md:col-span-2">
            <button type="submit" className="rounded-xl bg-ink-900 px-5 py-3 text-sm font-semibold text-white hover:bg-ink-700">
              Apply filters
            </button>
            <Link href="/admin/finance/orders" className="rounded-xl border border-ink-900/15 bg-white px-5 py-3 text-sm font-semibold text-strong hover:border-sage-600">
              Reset
            </Link>
          </div>
        </form>

        <div className="overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-900/[0.08] text-xs uppercase text-muted">
                <th className="px-5 py-4">Order</th>
                <th className="px-5 py-4">Customer</th>
                <th className="px-5 py-4">Confirmed</th>
                <th className="px-5 py-4">Net revenue</th>
                <th className="px-5 py-4">COGS</th>
                <th className="px-5 py-4">Final profit</th>
                <th className="px-5 py-4">Margin</th>
                <th className="px-5 py-4">State</th>
                <th className="px-5 py-4">Settled</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-muted">
                    No confirmed orders match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.publicId} className="border-b border-ink-900/[0.04]">
                    <td className="px-5 py-4">
                      <Link href={`/admin/finance/orders/${row.publicId}`} className="font-semibold text-sage-700">
                        {row.orderNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-4">{row.customerEmail}</td>
                    <td className="px-5 py-4">{row.confirmedAt?.slice(0, 10) ?? "—"}</td>
                    <td className="px-5 py-4">{signedUsd(row.netRevenueUsdMinor)}</td>
                    <td className="px-5 py-4">{signedUsd(row.cogsUsdMinor)}</td>
                    <td className="px-5 py-4">{signedUsd(row.profitUsdMinor)}</td>
                    <td className="px-5 py-4">{bpsPercent(row.marginBps)}</td>
                    <td className="px-5 py-4">{row.isEstimated ? "Estimated" : "Finalized"}</td>
                    <td className="px-5 py-4">{row.settled ? "Yes" : "No"}</td>
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
              Page {pagination.page} of {pagination.pageCount} · {pagination.total} orders
            </span>
            {pagination.page < pagination.pageCount ? (
              <Link className="font-semibold text-sage-700" href={pageHref(filters, pagination.page + 1)}>
                Next →
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </section>
  );
}
