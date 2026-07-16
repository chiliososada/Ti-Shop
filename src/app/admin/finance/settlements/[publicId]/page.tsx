import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import {
  confirmSettlementAction,
  lockSettlementAction,
  markSettlementPaidAction,
  voidSettlementAction,
} from "@/app/admin/finance/actions";
import {
  bpsPercent,
  financeInputClass,
  financeLabelClass,
  signedUsd,
  usdInputValue,
} from "@/app/admin/finance/_components/format";
import { getAdminSettlementDetail } from "@/server/admin/finance/settlements/queries";

export const metadata: Metadata = {
  title: "Partner settlement",
  robots: { index: false, follow: false },
};

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className={`border-b border-ink-900/[0.04] ${strong ? "bg-cream-50 font-semibold" : ""}`}>
      <td className="px-5 py-3">{label}</td>
      <td className="px-5 py-3 text-right">{value}</td>
    </tr>
  );
}

export default async function SettlementDetailPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const result = await getAdminSettlementDetail(publicId);
  if (!result) notFound();
  const { settlement, orders, lateAdjustments } = result;
  const s = settlement;
  const estimatedOrders = orders.filter((order) => order.isEstimated).length;

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header>
          <Link href="/admin/finance/settlements" className="text-sm font-semibold text-sage-700">
            ← Settlements
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            {s.status} · {s.partnerName} @ {bpsPercent(Number(s.shareBpsSnapshot))} · formula v{String(s.calcVersion)}
            {s.previousSettlementNumber ? (
              <>
                {" "}· chained from{" "}
                <Link href={`/admin/finance/settlements/${s.previousSettlementPublicId}`} className="text-sage-700">
                  {String(s.previousSettlementNumber)}
                </Link>
              </>
            ) : null}
          </p>
          <h1 className="text-h2 text-strong">{String(s.settlementNumber)}</h1>
          <p className="mt-2 text-sm text-muted">
            {String(s.periodStart).slice(0, 10)} → {String(s.periodEnd).slice(0, 10)} ·{" "}
            {orders.length} orders · {lateAdjustments.length} late adjustments
            {estimatedOrders > 0 ? ` · WARNING: ${estimatedOrders} order(s) still estimated` : ""}
          </p>
          {s.notes ? (
            <p className="mt-3 max-w-3xl rounded-xl border border-amber-700/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {String(s.notes)}
            </p>
          ) : null}
        </header>

        <section className="grid gap-8 xl:grid-cols-2">
          <article className="overflow-hidden rounded-2xl border border-ink-900/[0.08] bg-surface">
            <h2 className="border-b border-ink-900/[0.08] px-5 py-4 text-h5 text-strong">
              Settlement summary
            </h2>
            <table className="w-full text-sm">
              <tbody>
                <Row label="Net revenue" value={signedUsd(String(s.revenueUsdMinor))} />
                <Row label="COGS" value={signedUsd(String(s.cogsUsdMinor))} />
                <Row label="Logistics + packaging" value={signedUsd(String(s.shippingCostUsdMinor))} />
                <Row label="Payment & conversion fees" value={signedUsd(String(s.feesUsdMinor))} />
                <Row label="After-sales costs" value={signedUsd(String(s.afterSalesUsdMinor))} />
                <Row label="Other adjustments (incl. late)" value={signedUsd(String(s.otherAdjustmentsUsdMinor))} />
                <Row label="Period profit" value={signedUsd(String(s.profitUsdMinor))} strong />
                <Row label="Carryover in (prior losses)" value={signedUsd(String(s.carryoverInUsdMinor))} />
                <Row label="Distributable" value={signedUsd(String(s.distributableUsdMinor))} strong />
                <Row label={`Partner share (${bpsPercent(Number(s.shareBpsSnapshot))})`} value={signedUsd(String(s.partnerShareUsdMinor))} strong />
                <Row label="My remainder" value={signedUsd(String(s.ownerShareUsdMinor))} />
                <Row label="Carryover out" value={signedUsd(String(s.carryoverOutUsdMinor))} />
                {s.status === "PAID" ? (
                  <Row
                    label={`Paid (${String(s.paymentMethod ?? "—")}${s.paymentReference ? `, ref ${String(s.paymentReference)}` : ""})`}
                    value={signedUsd(String(s.paidUsdMinor))}
                    strong
                  />
                ) : null}
              </tbody>
            </table>
            <p className="px-5 py-4 text-xs text-muted">
              Created by {String(s.createdByName ?? "—")} · confirmed by {String(s.confirmedByName ?? "—")} · payment confirmed by {String(s.paidConfirmedByName ?? "—")}
            </p>
          </article>

          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h4 text-strong">Workflow</h2>
            <div className="mt-5 space-y-5">
              {s.status === "DRAFT" ? (
                <AdminActionForm action={confirmSettlementAction} submitLabel="Confirm settlement">
                  <input type="hidden" name="settlementPublicId" value={publicId} />
                </AdminActionForm>
              ) : null}
              {s.status === "PENDING_CONFIRMATION" ? (
                <AdminActionForm action={lockSettlementAction} submitLabel="Lock settlement (immutable)">
                  <input type="hidden" name="settlementPublicId" value={publicId} />
                </AdminActionForm>
              ) : null}
              {s.status === "LOCKED" ? (
                <AdminActionForm action={markSettlementPaidAction} className="space-y-4" submitLabel="Mark as paid (records only — never transfers money)">
                  <input type="hidden" name="settlementPublicId" value={publicId} />
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className={financeLabelClass}>Paid amount (USD)<input className={financeInputClass} name="paidAmount" inputMode="decimal" maxLength={16} required defaultValue={usdInputValue(String(s.partnerShareUsdMinor))} /></label>
                    <label className={financeLabelClass}>Paid at (ISO)<input className={financeInputClass} name="paidAt" maxLength={40} placeholder="Leave empty for now" /></label>
                    <label className={financeLabelClass}>Method<input className={financeInputClass} name="paymentMethod" maxLength={120} placeholder="USDT / wire / cash" /></label>
                    <label className={financeLabelClass}>Reference / TxID<input className={financeInputClass} name="paymentReference" maxLength={255} /></label>
                  </div>
                </AdminActionForm>
              ) : null}
              {s.status !== "PAID" && s.status !== "VOIDED" ? (
                <AdminActionForm action={voidSettlementAction} className="space-y-3" submitLabel="Void settlement (releases orders)">
                  <input type="hidden" name="settlementPublicId" value={publicId} />
                  <label className={financeLabelClass}>
                    Void reason
                    <input className={financeInputClass} name="reason" maxLength={500} required placeholder="Why is this settlement void?" />
                  </label>
                </AdminActionForm>
              ) : null}
              {s.status === "PAID" ? (
                <p className="text-sm text-muted">
                  Paid settlements are immutable. Later corrections go through
                  PARTNER_SETTLEMENT_CORRECTION adjustments in a future period.
                </p>
              ) : null}
            </div>
          </article>
        </section>

        <section>
          <h2 className="text-h3 text-strong">Included orders ({orders.length})</h2>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-900/[0.08] text-xs uppercase text-muted">
                  <th className="px-5 py-4">Order</th>
                  <th className="px-5 py-4">Confirmed</th>
                  <th className="px-5 py-4">Net revenue</th>
                  <th className="px-5 py-4">Final profit</th>
                  <th className="px-5 py-4">State</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-muted">
                      Only late adjustments are included in this settlement.
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.publicId} className="border-b border-ink-900/[0.04]">
                      <td className="px-5 py-4">
                        <Link href={`/admin/finance/orders/${order.publicId}`} className="font-semibold text-sage-700">
                          {order.orderNumber}
                        </Link>
                      </td>
                      <td className="px-5 py-4">{order.confirmedAt?.slice(0, 10) ?? "—"}</td>
                      <td className="px-5 py-4">{signedUsd(order.netRevenueUsdMinor)}</td>
                      <td className="px-5 py-4">{signedUsd(order.profitUsdMinor)}</td>
                      <td className="px-5 py-4">{order.isEstimated ? "Estimated" : "Finalized"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {lateAdjustments.length > 0 ? (
          <section>
            <h2 className="text-h3 text-strong">Late adjustments from earlier periods ({lateAdjustments.length})</h2>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-900/[0.08] text-xs uppercase text-muted">
                    <th className="px-5 py-4">Type</th>
                    <th className="px-5 py-4">Order</th>
                    <th className="px-5 py-4">Signed USD</th>
                    <th className="px-5 py-4">Effective</th>
                    <th className="px-5 py-4">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {lateAdjustments.map((adjustment) => (
                    <tr key={adjustment.publicId} className="border-b border-ink-900/[0.04]">
                      <td className="px-5 py-4">{adjustment.type}</td>
                      <td className="px-5 py-4">
                        {adjustment.orderPublicId ? (
                          <Link href={`/admin/finance/orders/${adjustment.orderPublicId}`} className="text-sage-700">
                            {adjustment.orderNumber}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-5 py-4">{signedUsd(adjustment.signedUsdMinor)}</td>
                      <td className="px-5 py-4">{adjustment.effectiveAt.slice(0, 10)}</td>
                      <td className="px-5 py-4">{adjustment.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
