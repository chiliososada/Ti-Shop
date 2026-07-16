import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import {
  bpsPercent,
  financeInputClass,
  financeLabelClass,
  signedUsd,
} from "@/app/admin/finance/_components/format";
import type { SearchParameter } from "@/lib/pagination";
import { getFinanceDashboard } from "@/server/admin/finance/reports/queries";

export const metadata: Metadata = {
  title: "Finance dashboard",
  robots: { index: false, follow: false },
};

const MODULES = [
  { href: "/admin/finance/orders", title: "Order profit", text: "Per-order waterfall, cost recording, and adjustments." },
  { href: "/admin/finance/products", title: "Product profit", text: "SKU-level revenue, COGS, and margins." },
  { href: "/admin/finance/procurement", title: "Procurement", text: "CNY purchase orders, FX rates, and receipts." },
  { href: "/admin/finance/after-sales", title: "After-sales", text: "Refunds, returns, replacements, and gifts." },
  { href: "/admin/finance/conversions", title: "Crypto conversions", text: "USD→crypto batches and direct receipts." },
  { href: "/admin/finance/settlements", title: "Partner settlements", text: "50% profit sharing with loss carryover." },
] as const;

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-ink-900/[0.08] bg-surface p-5">
      <p className="text-xs uppercase text-muted">{label}</p>
      <p className="mt-2 text-h4 text-strong">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export default async function FinanceDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const params = await searchParams;
  const dashboard = await getFinanceDashboard(params);
  const { metrics, health, range } = dashboard;

  const rangeHref = (key: string) => `/admin/finance?range=${key}`;

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-12">
        <header>
          <Link href="/admin" className="text-sm font-semibold text-sage-700">
            ← Administration
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Internal management accounting · formula v{dashboard.calcVersion} · not a tax report
          </p>
          <h1 className="text-h2 text-strong">Finance dashboard</h1>
          <p className="mt-2 text-sm text-muted">
            {range.start} → {range.endInclusive} · {dashboard.orderCount} confirmed orders ·{" "}
            {health.estimatedOrderCount > 0
              ? `${health.estimatedOrderCount} still estimated`
              : "all figures finalized"}
          </p>
          {dashboard.truncated ? (
            <p className="mt-3 max-w-3xl rounded-xl border border-amber-700/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This range has more orders than the dashboard scans in one pass; totals below
              cover only the first {dashboard.orderCount} orders. Narrow the date range for
              exact figures.
            </p>
          ) : null}
        </header>

        <div className="flex flex-wrap items-end gap-3">
          {(
            [
              ["today", "Today"],
              ["week", "This week"],
              ["month", "This month"],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={rangeHref(key)}
              className={`rounded-xl border px-4 py-2.5 text-sm font-semibold ${
                range.key === key
                  ? "border-ink-900 bg-ink-900 text-white"
                  : "border-ink-900/15 bg-white text-strong hover:border-sage-600"
              }`}
            >
              {label}
            </Link>
          ))}
          <form method="get" action="/admin/finance" className="flex items-end gap-2">
            <input type="hidden" name="range" value="custom" />
            <label className={financeLabelClass}>
              From
              <input className={financeInputClass} type="date" name="from" defaultValue={range.key === "custom" ? range.start : ""} required />
            </label>
            <label className={financeLabelClass}>
              To
              <input className={financeInputClass} type="date" name="to" defaultValue={range.key === "custom" ? range.endInclusive : ""} required />
            </label>
            <button type="submit" className="rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm font-semibold text-strong hover:border-sage-600">
              Apply
            </button>
          </form>
        </div>

        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
          <StatCard label="Sales revenue (excl. tax)" value={signedUsd(metrics.revenueUsdMinor)} hint={`incl. shipping charged ${signedUsd(metrics.shippingRevenueUsdMinor)}`} />
          <StatCard label="Refunds" value={signedUsd(metrics.refundsUsdMinor)} />
          <StatCard label="Net revenue" value={signedUsd(metrics.netRevenueUsdMinor)} />
          <StatCard label="COGS" value={signedUsd(metrics.cogsUsdMinor)} />
          <StatCard label="Actual logistics + packaging" value={signedUsd(metrics.shippingCostUsdMinor)} />
          <StatCard label="After-sales cost" value={signedUsd(metrics.afterSalesUsdMinor)} />
          <StatCard label="Payment fees" value={signedUsd(metrics.paymentFeesUsdMinor)} />
          <StatCard label="Crypto conversion fees" value={signedUsd(metrics.conversionFeesUsdMinor)} />
          <StatCard label="Exchange gain/loss" value={signedUsd(metrics.exchangeNetUsdMinor)} />
          <StatCard label="Tax collected (tracked separately)" value={signedUsd(metrics.taxCollectedUsdMinor)} />
          <StatCard label="Operating profit" value={signedUsd(metrics.profitUsdMinor)} hint={`margin ${bpsPercent(metrics.marginBps)}`} />
          <StatCard
            label={`Partner share${metrics.partnerName ? ` (${metrics.partnerName}, ${bpsPercent(metrics.partnerShareBps)})` : " (no partner configured)"}`}
            value={signedUsd(metrics.partnerShareUsdMinor)}
            hint={`your remainder ${signedUsd(metrics.ownerShareUsdMinor)} — indicative; the binding split happens in settlements with carryover`}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-amber-700/20 bg-amber-50 p-5">
            <p className="text-xs uppercase text-amber-900">Orders missing cost data</p>
            <p className="mt-2 text-h4 text-amber-900">{health.missingCostOrders}</p>
            <Link href="/admin/finance/orders?state=estimated" className="mt-1 block text-xs font-semibold text-amber-900 underline">
              Record actual costs →
            </Link>
          </div>
          <div className="rounded-2xl border border-ink-900/[0.08] bg-surface p-5">
            <p className="text-xs uppercase text-muted">Orders not yet settled</p>
            <p className="mt-2 text-h4 text-strong">{health.unsettledOrders}</p>
            <Link href="/admin/finance/settlements" className="mt-1 block text-xs font-semibold text-sage-700">
              Generate a settlement →
            </Link>
          </div>
          <div className="rounded-2xl border border-ink-900/[0.08] bg-surface p-5">
            <p className="text-xs uppercase text-muted">Open settlement drafts</p>
            <p className="mt-2 text-h4 text-strong">{health.pendingSettlements}</p>
            <p className="mt-1 text-xs text-muted">
              {health.finalizedOrderCount} finalized / {health.estimatedOrderCount} estimated in range
            </p>
          </div>
        </div>

        <section>
          <h2 className="text-h3 text-strong">Finance modules</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {MODULES.map((module) => (
              <Link
                key={module.href}
                href={module.href}
                className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <h3 className="text-h5 text-strong">{module.title}</h3>
                <p className="mt-2 text-sm text-muted">{module.text}</p>
                <span className="mt-4 block text-sm font-semibold text-sage-700">Open module →</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
