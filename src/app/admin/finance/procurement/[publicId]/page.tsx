import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import {
  cancelProcurementOrderAction,
  importProcurementLinesAction,
  receiveProcurementOrderAction,
  setProcurementFxRateAction,
  upsertProcurementItemAction,
  upsertProcurementOrderAction,
} from "@/app/admin/finance/procurement/actions";
import { formatUsdMinor } from "@/domain/money";
import { getAdminProcurementOrder } from "@/server/admin/finance/procurement/queries";

export const metadata: Metadata = {
  title: "Edit purchase order",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

function formatCny(minor: string) {
  const value = BigInt(minor);
  const negative = value < BigInt(0);
  const abs = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}¥${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

function cnyInputValue(minor: string) {
  const value = BigInt(minor);
  const negative = value < BigInt(0);
  const abs = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

function formatSignedUsd(minor: string) {
  const value = BigInt(minor);
  return value < BigInt(0)
    ? `-${formatUsdMinor((-value).toString())}`
    : formatUsdMinor(value.toString());
}

export default async function AdminProcurementDetailPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const result = await getAdminProcurementOrder(publicId);
  if (!result) notFound();
  const { order, suppliers, locations, variants, costEntries, costStates } = result;
  const editable = order.status !== "RECEIVED" && order.status !== "CANCELED";

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-12">
        <header>
          <Link href="/admin/finance/procurement" className="text-sm font-semibold text-sage-700">
            ← Purchase orders
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            {order.status} · {order.supplier.name}
          </p>
          <h1 className="text-h2 text-strong">{order.orderNumber}</h1>
          <p className="mt-2 text-sm text-muted">
            CNY total {formatCny(order.totalMinor)}
            {order.totalUsdMinor ? ` · USD total ${formatUsdMinor(order.totalUsdMinor)}` : " · USD total pending receipt"}
            {order.fxRateCnyPerUsd ? ` · rate ${order.fxRateCnyPerUsd} CNY/USD` : " · exchange rate not recorded"}
          </p>
        </header>

        {editable ? (
          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h4 text-strong">Order details</h2>
            <AdminActionForm action={upsertProcurementOrderAction} className="mt-6 space-y-5" submitLabel="Save purchase order">
              <input type="hidden" name="publicId" value={order.publicId} />
              <div className="grid gap-5 md:grid-cols-3">
                <label className={labelClass}>
                  Supplier
                  <select className={inputClass} name="supplierPublicId" defaultValue={order.supplier.publicId}>
                    {suppliers.map((supplier) => (
                      <option key={supplier.publicId} value={supplier.publicId}>{supplier.name}</option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Status
                  <select className={inputClass} name="status" defaultValue={order.status}>
                    <option value="DRAFT">Draft</option>
                    <option value="ORDERED">Ordered</option>
                    <option value="PAID">Paid</option>
                  </select>
                </label>
                <label className={labelClass}>Ordered at<input className={inputClass} name="orderedAt" maxLength={40} defaultValue={order.orderedAt ?? ""} placeholder="2026-07-01T00:00:00Z" /></label>
                <label className={labelClass}>Paid at<input className={inputClass} name="paidAt" maxLength={40} defaultValue={order.paidAt ?? ""} placeholder="2026-07-02T00:00:00Z" /></label>
                <label className={labelClass}>Domestic shipping (CNY)<input className={inputClass} name="domesticShipping" inputMode="decimal" maxLength={16} defaultValue={cnyInputValue(order.domesticShippingMinor)} /></label>
                <label className={labelClass}>International shipping (CNY)<input className={inputClass} name="internationalShipping" inputMode="decimal" maxLength={16} defaultValue={cnyInputValue(order.internationalShippingMinor)} /></label>
                <label className={labelClass}>Customs (CNY)<input className={inputClass} name="customs" inputMode="decimal" maxLength={16} defaultValue={cnyInputValue(order.customsMinor)} /></label>
                <label className={labelClass}>Procurement fee (CNY)<input className={inputClass} name="procurementFee" inputMode="decimal" maxLength={16} defaultValue={cnyInputValue(order.procurementFeeMinor)} /></label>
                <label className={labelClass}>Packaging (CNY)<input className={inputClass} name="packaging" inputMode="decimal" maxLength={16} defaultValue={cnyInputValue(order.packagingMinor)} /></label>
                <label className={labelClass}>Other cost (CNY)<input className={inputClass} name="otherCost" inputMode="decimal" maxLength={16} defaultValue={cnyInputValue(order.otherCostMinor)} /></label>
              </div>
              <label className={labelClass}>Notes<textarea className={inputClass} name="notes" rows={2} maxLength={4000} defaultValue={order.notes ?? ""} /></label>
            </AdminActionForm>
          </article>
        ) : (
          <p className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 text-sm text-muted">
            This purchase order is {order.status.toLowerCase()} and can no longer
            be edited. Cost corrections happen through the exchange-rate form
            below (with an audit trail) or profit adjustments.
          </p>
        )}

        <section>
          <h2 className="text-h3 text-strong">Lines ({order.items.length})</h2>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-900/[0.08] text-xs uppercase text-muted">
                  <th className="px-5 py-4">Variant</th>
                  <th className="px-5 py-4">Qty</th>
                  <th className="px-5 py-4">CNY unit</th>
                  <th className="px-5 py-4">CNY line</th>
                  <th className="px-5 py-4">Allocated extras</th>
                  <th className="px-5 py-4">CNY total</th>
                  <th className="px-5 py-4">USD total</th>
                  <th className="px-5 py-4">USD unit cost</th>
                  {editable ? <th className="px-5 py-4">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {order.items.length === 0 ? (
                  <tr>
                    <td colSpan={editable ? 9 : 8} className="px-5 py-8 text-center text-muted">
                      No lines yet. Add one below or paste CSV.
                    </td>
                  </tr>
                ) : (
                  order.items.map((item) => (
                    <tr key={item.publicId} className="border-b border-ink-900/[0.04]">
                      <td className="px-5 py-4">{item.variantTitle}{item.sku ? ` (${item.sku})` : ""}</td>
                      <td className="px-5 py-4">{item.quantity}{item.receivedQuantity > 0 ? ` (received ${item.receivedQuantity})` : ""}</td>
                      <td className="px-5 py-4">{formatCny(item.unitPriceMinor)}</td>
                      <td className="px-5 py-4">{formatCny(item.lineMinor)}</td>
                      <td className="px-5 py-4">{formatCny(item.allocatedCostMinor)}</td>
                      <td className="px-5 py-4">{formatCny(item.totalMinor)}</td>
                      <td className="px-5 py-4">{item.totalUsdMinor ? formatUsdMinor(item.totalUsdMinor) : "—"}</td>
                      <td className="px-5 py-4">{item.unitCostUsdMinor ? formatUsdMinor(item.unitCostUsdMinor) : "—"}</td>
                      {editable ? (
                        <td className="px-5 py-4">
                          <AdminActionForm action={upsertProcurementItemAction} submitLabel="Remove">
                            <input type="hidden" name="procurementPublicId" value={order.publicId} />
                            <input type="hidden" name="itemPublicId" value={item.publicId} />
                            <input type="hidden" name="remove" value="true" />
                          </AdminActionForm>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {editable ? (
            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <article className="rounded-2xl border border-dashed border-sage-700/30 bg-surface p-6">
                <h3 className="text-h5 text-strong">Add or update a line</h3>
                <p className="mt-2 text-xs text-muted">
                  Submitting a variant that is already on the order replaces its
                  quantity and price.
                </p>
                <AdminActionForm action={upsertProcurementItemAction} className="mt-5 space-y-4" submitLabel="Save line">
                  <input type="hidden" name="procurementPublicId" value={order.publicId} />
                  <label className={labelClass}>
                    Variant
                    <select className={inputClass} name="variantPublicId" required defaultValue="">
                      <option value="" disabled>Select variant</option>
                      {variants.map((variant) => (
                        <option key={variant.publicId} value={variant.publicId}>{variant.label}</option>
                      ))}
                    </select>
                  </label>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className={labelClass}>Quantity<input className={inputClass} name="quantity" type="number" min={1} max={1000000} step={1} required /></label>
                    <label className={labelClass}>CNY unit price<input className={inputClass} name="unitPriceCny" inputMode="decimal" maxLength={16} required placeholder="123.45" /></label>
                  </div>
                </AdminActionForm>
              </article>
              <article className="rounded-2xl border border-dashed border-sage-700/30 bg-surface p-6">
                <h3 className="text-h5 text-strong">Import lines from CSV</h3>
                <p className="mt-2 text-xs text-muted">
                  Header <code>sku,quantity,unitPriceCny</code>. Existing lines
                  with the same SKU are replaced; bad rows are reported.
                </p>
                <AdminActionForm action={importProcurementLinesAction} className="mt-5 space-y-4" submitLabel="Import CSV rows">
                  <input type="hidden" name="procurementPublicId" value={order.publicId} />
                  <label className={labelClass}>
                    CSV rows
                    <textarea className={`${inputClass} font-mono`} name="csvText" rows={6} maxLength={100000} placeholder={"sku,quantity,unitPriceCny\nBPC-2MG,100,58.00"} required />
                  </label>
                </AdminActionForm>
              </article>
            </div>
          ) : null}
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h4 text-strong">Exchange rate</h2>
            <p className="mt-2 text-xs text-muted">
              CNY per USD, recorded manually (an automatic rate service is
              optional and not required). Corrections after receipt re-value
              remaining stock and are fully audited; consumed order snapshots
              never change.
            </p>
            {order.fxRateCnyPerUsd ? (
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted">Current rate</dt><dd>{order.fxRateCnyPerUsd}</dd>
                <dt className="text-muted">Rate time</dt><dd>{order.fxRateDate ?? "—"}</dd>
                <dt className="text-muted">Source</dt><dd>{order.fxRateSource ?? "—"}</dd>
                <dt className="text-muted">Note</dt><dd>{order.fxRateNote ?? "—"}</dd>
              </dl>
            ) : null}
            {order.status !== "CANCELED" ? (
              <AdminActionForm action={setProcurementFxRateAction} className="mt-5 space-y-4" submitLabel="Save exchange rate">
                <input type="hidden" name="procurementPublicId" value={order.publicId} />
                <div className="grid gap-4 md:grid-cols-2">
                  <label className={labelClass}>CNY per USD<input className={inputClass} name="fxRate" required maxLength={24} defaultValue={order.fxRateCnyPerUsd ?? ""} placeholder="7.2500" /></label>
                  <label className={labelClass}>
                    Source
                    <select className={inputClass} name="fxRateSource" defaultValue={order.fxRateSource ?? "MANUAL"}>
                      <option value="MANUAL">Manual entry</option>
                      <option value="API">Rate service</option>
                    </select>
                  </label>
                </div>
                <label className={labelClass}>Rate time (ISO, optional)<input className={inputClass} name="fxRateDate" maxLength={40} defaultValue={order.fxRateDate ?? ""} placeholder="2026-07-14T00:00:00Z" /></label>
                <label className={labelClass}>Note<input className={inputClass} name="fxRateNote" maxLength={500} defaultValue={order.fxRateNote ?? ""} placeholder="e.g. Bank of China noon rate" /></label>
              </AdminActionForm>
            ) : null}
          </article>

          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h4 text-strong">Receive stock</h2>
            {order.status === "RECEIVED" ? (
              <p className="mt-3 text-sm text-muted">
                Received {order.receivedAt ?? ""}. Inventory quantities and
                moving-average USD costs were locked with rate {order.fxRateCnyPerUsd}.
              </p>
            ) : order.status === "CANCELED" ? (
              <p className="mt-3 text-sm text-muted">This order was canceled.</p>
            ) : (
              <>
                <p className="mt-2 text-xs text-muted">
                  Receiving allocates the extra costs across lines by CNY value,
                  converts each line at the recorded rate, updates on-hand stock
                  at the chosen location, and locks USD unit costs. Requires the
                  exchange rate and at least one line.
                </p>
                {locations.length === 0 ? (
                  <p className="mt-4 rounded-xl border border-amber-700/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Create an inventory location first under
                    {" "}<Link href="/admin/inventory" className="font-semibold text-sage-700">Inventory</Link>.
                  </p>
                ) : (
                  <AdminActionForm action={receiveProcurementOrderAction} className="mt-5 space-y-4" submitLabel="Receive into inventory">
                    <input type="hidden" name="procurementPublicId" value={order.publicId} />
                    <label className={labelClass}>
                      Location
                      <select className={inputClass} name="locationPublicId" required defaultValue="">
                        <option value="" disabled>Select location</option>
                        {locations.map((location) => (
                          <option key={location.publicId} value={location.publicId}>{location.code} · {location.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className={labelClass}>Received at (ISO, optional)<input className={inputClass} name="receivedAt" maxLength={40} placeholder="Leave empty for now" /></label>
                  </AdminActionForm>
                )}
                <div className="mt-6 border-t border-ink-900/[0.06] pt-5">
                  <AdminActionForm action={cancelProcurementOrderAction} submitLabel="Cancel purchase order">
                    <input type="hidden" name="procurementPublicId" value={order.publicId} />
                  </AdminActionForm>
                </div>
              </>
            )}
          </article>
        </section>

        {costStates.length > 0 ? (
          <section>
            <h2 className="text-h3 text-strong">Current valuation of affected variants</h2>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-900/[0.08] text-xs uppercase text-muted">
                    <th className="px-5 py-4">Variant</th>
                    <th className="px-5 py-4">Valued qty</th>
                    <th className="px-5 py-4">Total value</th>
                    <th className="px-5 py-4">Average unit cost</th>
                  </tr>
                </thead>
                <tbody>
                  {costStates.map((state) => (
                    <tr key={state.variantPublicId} className="border-b border-ink-900/[0.04]">
                      <td className="px-5 py-4">{state.variantLabel}</td>
                      <td className="px-5 py-4">{state.quantity}</td>
                      <td className="px-5 py-4">{formatUsdMinor(state.totalCostUsdMinor)}</td>
                      <td className="px-5 py-4">
                        {state.averageUnitCostUsdMinor ? formatUsdMinor(state.averageUnitCostUsdMinor) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {costEntries.length > 0 ? (
          <section>
            <h2 className="text-h3 text-strong">Cost ledger entries for this order</h2>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-900/[0.08] text-xs uppercase text-muted">
                    <th className="px-5 py-4">Time</th>
                    <th className="px-5 py-4">Type</th>
                    <th className="px-5 py-4">Variant</th>
                    <th className="px-5 py-4">Qty Δ</th>
                    <th className="px-5 py-4">Cost Δ</th>
                    <th className="px-5 py-4">Qty after</th>
                    <th className="px-5 py-4">Value after</th>
                  </tr>
                </thead>
                <tbody>
                  {costEntries.map((entry) => (
                    <tr key={entry.publicId} className="border-b border-ink-900/[0.04]">
                      <td className="px-5 py-4">{entry.occurredAt}</td>
                      <td className="px-5 py-4">{entry.entryType}</td>
                      <td className="px-5 py-4">{entry.variantLabel}</td>
                      <td className="px-5 py-4">{entry.quantityDelta}</td>
                      <td className="px-5 py-4">{formatSignedUsd(entry.costDeltaUsdMinor)}</td>
                      <td className="px-5 py-4">{entry.quantityAfter}</td>
                      <td className="px-5 py-4">{formatUsdMinor(entry.totalCostAfterUsdMinor)}</td>
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
