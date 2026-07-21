import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { formatCnyMinor } from "@/app/admin/finance/_components/format";
import { formatUsdMinor } from "@/domain/money";
import { getCost2CatalogReport } from "@/server/admin/finance/reports/cost2-queries";

export const metadata: Metadata = {
  title: "Cost 2",
  robots: { index: false, follow: false },
};

export default async function Cost2Page() {
  await connection();
  const report = await getCost2CatalogReport();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-8">
        <header className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <Link href="/admin/finance" className="text-sm font-semibold text-sage-700">
              ← Finance
            </Link>
            <h1 className="mt-4 text-h2 text-strong">Cost 2</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted">
              Cost 2 = Cost 1 + (selling price − Cost 1) ÷ 2. This internal
              partner-sharing view does not change customer prices and is not
              applied a second time in partner settlements.
            </p>
          </div>
          <Link
            href="/admin/finance/cost2/export"
            className="rounded-xl border border-ink-900/15 bg-white px-4 py-2.5 text-sm font-semibold text-strong hover:border-sage-600"
          >
            Export CSV
          </Link>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-ink-900/[0.08] bg-surface p-5">
            <p className="text-xs uppercase text-muted">Active SKUs</p>
            <p className="mt-2 text-h4 text-strong">{report.summary.total}</p>
          </div>
          <div className="rounded-2xl border border-ink-900/[0.08] bg-surface p-5">
            <p className="text-xs uppercase text-muted">Formula ready</p>
            <p className="mt-2 text-h4 text-strong">{report.summary.ready}</p>
          </div>
          <div className="rounded-2xl border border-ink-900/[0.08] bg-surface p-5">
            <p className="text-xs uppercase text-muted">Needs attention</p>
            <p className="mt-2 text-h4 text-strong">
              {report.summary.missing + report.summary.mismatch}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-900/[0.08] text-xs uppercase text-muted">
                <th className="px-5 py-4">Product</th>
                <th className="px-5 py-4">Selling price</th>
                <th className="px-5 py-4">Cost 1 CNY</th>
                <th className="px-5 py-4">Cost 1 USD</th>
                <th className="px-5 py-4">Cost 2 USD</th>
                <th className="px-5 py-4">Partner 50%</th>
                <th className="px-5 py-4">Owner 50%</th>
                <th className="px-5 py-4">State</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.variantPublicId} className="border-b border-ink-900/[0.04]">
                  <td className="px-5 py-4">
                    <span className="font-semibold text-strong">{row.product}</span>
                    {row.sku ? <span className="block text-xs text-muted">{row.sku}</span> : null}
                  </td>
                  <td className="px-5 py-4">{row.sellUsdMinor ? formatUsdMinor(row.sellUsdMinor) : "—"}</td>
                  <td className="px-5 py-4">{row.cost1CnyMinor ? formatCnyMinor(row.cost1CnyMinor) : "—"}</td>
                  <td className="px-5 py-4">{row.cost1UsdMinor ? formatUsdMinor(row.cost1UsdMinor) : "—"}</td>
                  <td className="px-5 py-4 font-semibold">{row.cost2UsdMinor ? formatUsdMinor(row.cost2UsdMinor) : "—"}</td>
                  <td className="px-5 py-4">{row.partnerShareUsdMinor ? formatUsdMinor(row.partnerShareUsdMinor) : "—"}</td>
                  <td className="px-5 py-4">{row.ownerShareUsdMinor ? formatUsdMinor(row.ownerShareUsdMinor) : "—"}</td>
                  <td className="px-5 py-4">
                    {row.state === "ready" ? "Ready" : row.state === "mismatch" ? "Mismatch" : "Missing source"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
