import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import {
  bpsPercent,
  formatCnyMinor,
  signedUsd,
} from "@/app/admin/finance/_components/format";
import { formatUsdMinor } from "@/domain/money";
import type { SearchParameter } from "@/lib/pagination";
import { getProductProfitReport } from "@/server/admin/finance/reports/queries";

export const metadata: Metadata = {
  title: "Product profit",
  robots: { index: false, follow: false },
};

export default async function FinanceProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const params = await searchParams;
  const { range, rows } = await getProductProfitReport(params);

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <Link href="/admin/finance" className="text-sm font-semibold text-sage-700">
              ← Finance
            </Link>
            <h1 className="mt-4 text-h2 text-strong">Product profit</h1>
            <p className="mt-2 text-sm text-muted">
              {range.start} → {range.endInclusive} · revenue is tax-exclusive;
              COGS comes from immutable order snapshots.
            </p>
          </div>
          <div className="flex gap-3">
            {(
              [
                ["today", "Today"],
                ["week", "Week"],
                ["month", "Month"],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={`/admin/finance/products?range=${key}`}
                className={`rounded-xl border px-4 py-2.5 text-sm font-semibold ${
                  range.key === key
                    ? "border-ink-900 bg-ink-900 text-white"
                    : "border-ink-900/15 bg-white text-strong hover:border-sage-600"
                }`}
              >
                {label}
              </Link>
            ))}
            <Link
              href={`/admin/finance/products/export?range=${range.key}${range.key === "custom" ? `&from=${range.start}&to=${range.endInclusive}` : ""}`}
              className="rounded-xl border border-ink-900/15 bg-white px-4 py-2.5 text-sm font-semibold text-strong hover:border-sage-600"
            >
              Export CSV
            </Link>
          </div>
        </header>

        <div className="overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-900/[0.08] text-xs uppercase text-muted">
                <th className="px-5 py-4">SKU</th>
                <th className="px-5 py-4">Sold</th>
                <th className="px-5 py-4">Returned</th>
                <th className="px-5 py-4">Gifts</th>
                <th className="px-5 py-4">Avg. price</th>
                <th className="px-5 py-4">Avg. CNY cost</th>
                <th className="px-5 py-4">Avg. USD cost</th>
                <th className="px-5 py-4">Revenue</th>
                <th className="px-5 py-4">COGS</th>
                <th className="px-5 py-4">After-sales</th>
                <th className="px-5 py-4">Gross profit</th>
                <th className="px-5 py-4">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-5 py-10 text-center text-muted">
                    No confirmed sales in this range.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.label + row.sku} className="border-b border-ink-900/[0.04]">
                    <td className="px-5 py-4">
                      {row.label}
                      {row.sku ? <span className="block text-xs text-muted">{row.sku}</span> : null}
                      {row.isEstimated ? (
                        <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                          Estimated
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-4">{row.soldQuantity}</td>
                    <td className="px-5 py-4">{row.returnedQuantity}</td>
                    <td className="px-5 py-4">{row.giftQuantity}</td>
                    <td className="px-5 py-4">{row.averageSellUsdMinor ? formatUsdMinor(row.averageSellUsdMinor) : "—"}</td>
                    <td className="px-5 py-4">{row.averageCnyCostMinor ? formatCnyMinor(row.averageCnyCostMinor) : "—"}</td>
                    <td className="px-5 py-4">{row.averageUsdCostMinor ? formatUsdMinor(row.averageUsdCostMinor) : "—"}</td>
                    <td className="px-5 py-4">{signedUsd(row.revenueUsdMinor)}</td>
                    <td className="px-5 py-4">{signedUsd(row.cogsUsdMinor)}</td>
                    <td className="px-5 py-4">{signedUsd(row.afterSalesCostUsdMinor)}</td>
                    <td className="px-5 py-4">{signedUsd(row.grossProfitUsdMinor)}</td>
                    <td className="px-5 py-4">{bpsPercent(row.marginBps)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
