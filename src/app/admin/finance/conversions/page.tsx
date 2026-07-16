import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { createConversionBatchAction } from "@/app/admin/finance/actions";
import {
  bpsPercent,
  financeInputClass,
  financeLabelClass,
  signedUsd,
} from "@/app/admin/finance/_components/format";
import { buildQueryHref, type SearchParameter } from "@/lib/pagination";
import { getAdminConversionIndex } from "@/server/admin/finance/conversions/queries";

export const metadata: Metadata = {
  title: "Crypto conversions",
  robots: { index: false, follow: false },
};

export default async function FinanceConversionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const { pagination, batches } = await getAdminConversionIndex(await searchParams);

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <Link href="/admin/finance" className="text-sm font-semibold text-sage-700">
              ← Finance
            </Link>
            <h1 className="mt-4 text-h2 text-strong">Crypto conversion batches</h1>
            <p className="mt-2 text-sm text-muted">
              USD receipts converted to crypto pay the configured conversion fee
              (default 0.5%); direct crypto receipts never do. Fees are
              allocated across the included orders to the exact cent.
            </p>
          </div>
          <Link
            href="/admin/finance/conversions/export"
            className="rounded-xl border border-ink-900/15 bg-white px-4 py-2.5 text-sm font-semibold text-strong hover:border-sage-600"
          >
            Export CSV
          </Link>
        </header>

        <div className="overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-900/[0.08] text-xs uppercase text-muted">
                <th className="px-5 py-4">Batch</th>
                <th className="px-5 py-4">Kind</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Asset</th>
                <th className="px-5 py-4">Payments</th>
                <th className="px-5 py-4">USD total</th>
                <th className="px-5 py-4">Fee rate</th>
                <th className="px-5 py-4">Fee (est / actual)</th>
                <th className="px-5 py-4">Converted</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-muted">
                    No batches yet. Create the first one below.
                  </td>
                </tr>
              ) : (
                batches.map((batch) => (
                  <tr key={batch.publicId} className="border-b border-ink-900/[0.04]">
                    <td className="px-5 py-4">
                      <Link href={`/admin/finance/conversions/${batch.publicId}`} className="font-semibold text-sage-700">
                        {batch.batchNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-4">{batch.kind === "USD_TO_CRYPTO" ? "USD → crypto" : "Direct crypto"}</td>
                    <td className="px-5 py-4">{batch.status}</td>
                    <td className="px-5 py-4">{batch.targetAsset}</td>
                    <td className="px-5 py-4">{batch.entryCount}</td>
                    <td className="px-5 py-4">{signedUsd(batch.totalUsdMinor)}</td>
                    <td className="px-5 py-4">{bpsPercent(batch.feeRateBps)}</td>
                    <td className="px-5 py-4">
                      {signedUsd(batch.estimatedFeeUsdMinor)}
                      {" / "}
                      {batch.actualFeeUsdMinor ? signedUsd(batch.actualFeeUsdMinor) : "—"}
                    </td>
                    <td className="px-5 py-4">{batch.convertedAt?.slice(0, 10) ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination.pageCount > 1 ? (
          <nav className="flex items-center gap-3 text-sm" aria-label="Pagination">
            {pagination.page > 1 ? (
              <Link className="font-semibold text-sage-700" href={buildQueryHref("/admin/finance/conversions", { page: pagination.page - 1 })}>
                ← Previous
              </Link>
            ) : null}
            <span className="text-muted">
              Page {pagination.page} of {pagination.pageCount} · {pagination.total} batches
            </span>
            {pagination.page < pagination.pageCount ? (
              <Link className="font-semibold text-sage-700" href={buildQueryHref("/admin/finance/conversions", { page: pagination.page + 1 })}>
                Next →
              </Link>
            ) : null}
          </nav>
        ) : null}

        <article className="rounded-2xl border border-dashed border-sage-700/30 bg-surface p-6">
          <h2 className="text-h4 text-strong">New conversion batch</h2>
          <AdminActionForm action={createConversionBatchAction} className="mt-6 space-y-5" submitLabel="Create batch">
            <div className="grid gap-5 md:grid-cols-3">
              <label className={financeLabelClass}>
                Kind
                <select className={financeInputClass} name="kind" defaultValue="USD_TO_CRYPTO">
                  <option value="USD_TO_CRYPTO">USD received → convert to crypto (0.5% fee)</option>
                  <option value="DIRECT_CRYPTO">Customer paid crypto directly (no 0.5%)</option>
                </select>
              </label>
              <label className={financeLabelClass}>
                Target asset
                <input className={financeInputClass} name="targetAsset" required maxLength={20} placeholder="USDT" />
              </label>
              <label className={financeLabelClass}>
                Notes
                <input className={financeInputClass} name="notes" maxLength={500} />
              </label>
            </div>
          </AdminActionForm>
        </article>
      </div>
    </section>
  );
}
