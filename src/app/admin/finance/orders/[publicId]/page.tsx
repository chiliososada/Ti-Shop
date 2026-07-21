import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import {
  createAdjustmentAction,
  recordShipmentCostsAction,
  reverseAdjustmentAction,
} from "@/app/admin/finance/actions";
import {
  bpsPercent,
  financeInputClass,
  financeLabelClass,
  signedUsd,
  usdInputValue,
} from "@/app/admin/finance/_components/format";
import { formatUsdMinor } from "@/domain/money";
import { getFinanceOrderDetail } from "@/server/admin/finance/reports/queries";

export const metadata: Metadata = {
  title: "Order profit detail",
  robots: { index: false, follow: false },
};

function WaterfallRow({
  label,
  value,
  sign,
  strong,
  estimated,
}: {
  label: string;
  value: string | null;
  sign?: "+" | "-";
  strong?: boolean;
  estimated?: boolean;
}) {
  return (
    <tr className={`border-b border-ink-900/[0.04] ${strong ? "bg-cream-50 font-semibold" : ""}`}>
      <td className="px-5 py-3">{label}{estimated ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">Estimated</span> : null}</td>
      <td className="px-5 py-3 text-right">
        {value === null ? "—" : <>{sign ? `${sign} ` : ""}{signedUsd(value)}</>}
      </td>
    </tr>
  );
}

export default async function FinanceOrderDetailPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const result = await getFinanceOrderDetail(publicId);
  if (!result) notFound();
  const { order, profit, items, shipments, conversionEntries, adjustments } = result;

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-12">
        <header>
          <Link href="/admin/finance/orders" className="text-sm font-semibold text-sage-700">
            ← Order profit
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            {order.status} · {order.paymentStatus} ·{" "}
            <Link href={`/admin/orders/${order.publicId}`} className="text-sage-700">operations view</Link>
            {order.settledIn ? (
              <>
                {" "}· settled in{" "}
                <Link href={`/admin/finance/settlements/${order.settledIn.publicId}`} className="text-sage-700">
                  {order.settledIn.settlementNumber}
                </Link>
              </>
            ) : null}
          </p>
          <h1 className="text-h2 text-strong">{order.orderNumber}</h1>
          <p className="mt-2 text-sm text-muted">
            {order.customerEmail} · formula v{profit.calcVersion} ·{" "}
            {profit.isEstimated
              ? `ESTIMATED (${profit.estimationReasons.join(", ")})`
              : "FINALIZED"}
          </p>
        </header>

        <section className="grid gap-8 xl:grid-cols-2">
          <article className="overflow-hidden rounded-2xl border border-ink-900/[0.08] bg-surface">
            <h2 className="border-b border-ink-900/[0.08] px-5 py-4 text-h5 text-strong">
              Profit waterfall
            </h2>
            <table className="w-full text-sm">
              <tbody>
                <WaterfallRow label="Merchandise sales" value={profit.merchandiseRevenue} sign="+" />
                <WaterfallRow label="Discounts" value={profit.discount} sign="-" />
                <WaterfallRow label="Shipping charged to customer" value={profit.shippingRevenue} sign="+" />
                <WaterfallRow label="Refunds" value={profit.refunds} sign="-" />
                <WaterfallRow label="Shipping refunded" value={profit.shippingRefunds} sign="-" />
                <WaterfallRow label="Net operating revenue" value={profit.netRevenue} strong />
                <WaterfallRow label="Cost of goods (snapshots)" value={profit.cogs} sign="-" estimated={profit.estimationReasons.includes("missing_cost_snapshot") || profit.estimationReasons.includes("reference_cost_snapshot")} />
                <WaterfallRow label="Cost 2 (partner-inclusive snapshot)" value={profit.cost2} estimated={profit.cost2IsEstimated} />
                <WaterfallRow label="Partner merchandise share inside Cost 2" value={profit.partnerMerchandiseShare} sign="-" />
                <WaterfallRow label="Actual logistics cost" value={profit.shippingCost} sign="-" estimated={profit.estimationReasons.includes("missing_shipping_cost")} />
                <WaterfallRow label="Packaging" value={profit.packagingCost} sign="-" />
                <WaterfallRow label="Payment fees" value={profit.paymentFees} sign="-" />
                <WaterfallRow label="Crypto conversion fees" value={profit.conversionFees} sign="-" estimated={profit.estimationReasons.includes("conversion_fee_estimated")} />
                <WaterfallRow label="After-sales costs" value={profit.afterSalesCost} sign="-" />
                <WaterfallRow label="Other direct costs" value={profit.otherDirectCost} sign="-" />
                <WaterfallRow label="Cost corrections" value={profit.costCorrections} sign="+" />
                <WaterfallRow label="Exchange gain/loss" value={profit.exchangeNet} sign="+" />
                <WaterfallRow label={`Final profit (margin ${bpsPercent(profit.marginBps)})`} value={profit.finalProfit} strong />
                <WaterfallRow label="Profit after Cost 2 (reference)" value={profit.profitAfterCost2} strong />
                <WaterfallRow
                  label={`Partner share${profit.partnerName ? ` — ${profit.partnerName} @ ${bpsPercent(profit.partnerShareBps)}` : ""} (indicative)`}
                  value={profit.partnerShare}
                />
                <WaterfallRow label="My remainder (indicative)" value={profit.ownerShare} />
              </tbody>
            </table>
            <p className="px-5 py-4 text-xs text-muted">
              Tax collected {signedUsd(profit.taxCollected)} is tracked separately
              and never counted as revenue or profit. Cost 2 is an internal
              merchandise-margin view. The binding partner split happens once
              in settlements, where operating costs and losses carry forward.
            </p>
          </article>

          <div className="space-y-8">
            <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
              <h2 className="text-h5 text-strong">Lines & cost snapshots</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink-900/[0.08] text-xs uppercase text-muted">
                      <th className="py-2 pr-4">Line</th>
                      <th className="py-2 pr-4">Qty</th>
                      <th className="py-2 pr-4">Unit price</th>
                      <th className="py-2 pr-4">Unit Cost 1</th>
                      <th className="py-2 pr-4">Unit Cost 2</th>
                      <th className="py-2 pr-4">COGS 1</th>
                      <th className="py-2">Cost 2 total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr key={index} className="border-b border-ink-900/[0.04]">
                        <td className="py-2 pr-4">
                          {item.label}
                          {item.isCompensation ? (
                            <span className="ml-2 rounded-full bg-sage-100 px-2 py-0.5 text-[10px] font-semibold text-sage-800">
                              Compensation — cost on original order
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-4">{item.quantity}</td>
                        <td className="py-2 pr-4">{formatUsdMinor(item.unitPriceMinor)}</td>
                        <td className="py-2 pr-4">
                          {item.unitCostUsdMinor
                            ? `${formatUsdMinor(item.unitCostUsdMinor)} (${item.costIsEstimated ? "Excel reference estimate" : item.costMethod === "MOVING_AVERAGE" ? "moving avg" : "manual"})`
                            : item.isCompensation
                              ? "—"
                              : "No cost yet (estimated)"}
                        </td>
                        <td className="py-2 pr-4">{item.unitCost2UsdMinor ? formatUsdMinor(item.unitCost2UsdMinor) : "—"}</td>
                        <td className="py-2 pr-4">{item.totalCogsUsdMinor ? formatUsdMinor(item.totalCogsUsdMinor) : "—"}</td>
                        <td className="py-2">{item.totalCost2UsdMinor ? formatUsdMinor(item.totalCost2UsdMinor) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
              <h2 className="text-h5 text-strong">Shipments & actual costs</h2>
              {shipments.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No shipments yet.</p>
              ) : (
                <div className="mt-4 space-y-5">
                  {shipments.map((shipment) => (
                    <div key={shipment.publicId} className="rounded-xl border border-ink-900/[0.06] p-4">
                      <p className="text-sm font-semibold text-strong">
                        {shipment.shipmentNumber} · {shipment.status}
                        {shipment.shippingCostMinor === null && shipment.status !== "CANCELED" ? (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                            Cost missing
                          </span>
                        ) : null}
                      </p>
                      {order.settledIn ? (
                        <p className="mt-2 text-xs text-muted">
                          Profit is settled; record differences as adjustments.
                        </p>
                      ) : (
                        <AdminActionForm action={recordShipmentCostsAction} className="mt-3 space-y-3" submitLabel="Save actual costs">
                          <input type="hidden" name="shipmentPublicId" value={shipment.publicId} />
                          <input type="hidden" name="orderPublicId" value={order.publicId} />
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className={financeLabelClass}>
                              Carrier charge (USD)
                              <input className={financeInputClass} name="shippingCost" inputMode="decimal" maxLength={16} required defaultValue={shipment.shippingCostMinor ? usdInputValue(shipment.shippingCostMinor) : ""} placeholder="9.80" />
                            </label>
                            <label className={financeLabelClass}>
                              Packaging (USD)
                              <input className={financeInputClass} name="packagingCost" inputMode="decimal" maxLength={16} defaultValue={shipment.packagingCostMinor ? usdInputValue(shipment.packagingCostMinor) : ""} placeholder="0.00" />
                            </label>
                          </div>
                        </AdminActionForm>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-4 text-xs text-muted">
                Shipping spread: charged {signedUsd(profit.shippingRevenue)} − paid{" "}
                {signedUsd(profit.shippingCost)} ={" "}
                {signedUsd(BigInt(profit.shippingRevenue) - BigInt(profit.shippingCost))}
              </p>
            </article>

            {conversionEntries.length > 0 ? (
              <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
                <h2 className="text-h5 text-strong">Conversion fee allocations</h2>
                <ul className="mt-3 space-y-2 text-sm">
                  {conversionEntries.map((entry, index) => (
                    <li key={index} className="flex justify-between">
                      <span>
                        {entry.batchNumber} ({entry.batchStatus}
                        {entry.feeIsEstimated ? ", estimated" : ""})
                      </span>
                      <span>
                        {signedUsd(entry.allocatedFeeUsdMinor)} + chain{" "}
                        {signedUsd(entry.allocatedChainFeeUsdMinor)}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ) : null}
          </div>
        </section>

        <section className="grid gap-8 xl:grid-cols-2">
          <article className="rounded-2xl border border-dashed border-sage-700/30 bg-surface p-6">
            <h2 className="text-h4 text-strong">Record a manual adjustment</h2>
            <p className="mt-2 text-xs text-muted">
              Append-only: history is never edited. CNY amounts keep their
              original value and the historical rate you enter.
            </p>
            <AdminActionForm action={createAdjustmentAction} className="mt-5 space-y-4" submitLabel="Record adjustment">
              <input type="hidden" name="orderPublicId" value={order.publicId} />
              <div className="grid gap-4 md:grid-cols-2">
                <label className={financeLabelClass}>
                  Type
                  <select className={financeInputClass} name="type" defaultValue="MANUAL_DIRECT_COST">
                    {[
                      "REFUND",
                      "SHIPPING_REFUND",
                      "RETURN_SHIPPING",
                      "DAMAGED_RETURN",
                      "COMPENSATION_PRODUCT",
                      "COMPENSATION_SHIPPING",
                      "PAYMENT_FEE",
                      "CRYPTO_CONVERSION_FEE",
                      "EXCHANGE_GAIN",
                      "EXCHANGE_LOSS",
                      "MANUAL_DIRECT_COST",
                      "COST_CORRECTION",
                      "ROUNDING_ADJUSTMENT",
                      "PARTNER_SETTLEMENT_CORRECTION",
                    ].map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <label className={financeLabelClass}>
                  Direction
                  <select className={financeInputClass} name="direction" defaultValue="DECREASE">
                    <option value="DECREASE">Decrease profit (cost)</option>
                    <option value="INCREASE">Increase profit (gain)</option>
                  </select>
                </label>
                <label className={financeLabelClass}>Amount<input className={financeInputClass} name="amount" inputMode="decimal" maxLength={16} required placeholder="12.34" /></label>
                <label className={financeLabelClass}>
                  Currency
                  <select className={financeInputClass} name="originalCurrency" defaultValue="USD">
                    <option value="USD">USD</option>
                    <option value="CNY">CNY (needs rate)</option>
                  </select>
                </label>
                <label className={financeLabelClass}>CNY/USD rate (for CNY)<input className={financeInputClass} name="fxRate" maxLength={24} placeholder="7.25" /></label>
                <label className={financeLabelClass}>Effective at (ISO, optional)<input className={financeInputClass} name="effectiveAt" maxLength={40} placeholder="Leave empty for now" /></label>
                <label className={financeLabelClass}>
                  Certainty
                  <select className={financeInputClass} name="isEstimated" defaultValue="false">
                    <option value="false">Finalized</option>
                    <option value="true">Estimated</option>
                  </select>
                </label>
              </div>
              <label className={financeLabelClass}>Reason<textarea className={financeInputClass} name="reason" rows={2} maxLength={4000} required /></label>
            </AdminActionForm>
          </article>

          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h4 text-strong">Adjustments ({adjustments.length})</h2>
            {adjustments.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No adjustments on this order.</p>
            ) : (
              <ul className="mt-4 space-y-4">
                {adjustments.map((adjustment) => (
                  <li key={adjustment.publicId} className="rounded-xl border border-ink-900/[0.06] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-strong">
                          {adjustment.type} · {signedUsd(adjustment.signedUsdMinor)}
                          {adjustment.isEstimated ? " · Estimated" : ""}
                          {adjustment.settled ? " · settled" : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {adjustment.effectiveAt.slice(0, 10)} — {adjustment.reason}
                        </p>
                      </div>
                    </div>
                    <AdminActionForm action={reverseAdjustmentAction} className="mt-3 space-y-3" submitLabel="Reverse (append opposite)">
                      <input type="hidden" name="adjustmentPublicId" value={adjustment.publicId} />
                      <input type="hidden" name="orderPublicId" value={order.publicId} />
                      <label className={financeLabelClass}>
                        Reversal reason
                        <input className={financeInputClass} name="reason" maxLength={500} required placeholder="Why is this being reversed?" />
                      </label>
                    </AdminActionForm>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>
      </div>
    </section>
  );
}
