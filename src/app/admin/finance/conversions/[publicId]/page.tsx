import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import {
  addPaymentToBatchAction,
  completeConversionBatchAction,
  removePaymentFromBatchAction,
  voidConversionBatchAction,
} from "@/app/admin/finance/actions";
import {
  bpsPercent,
  financeInputClass,
  financeLabelClass,
  signedUsd,
} from "@/app/admin/finance/_components/format";
import { formatUsdMinor } from "@/domain/money";
import { getAdminConversionBatch } from "@/server/admin/finance/conversions/queries";

export const metadata: Metadata = {
  title: "Conversion batch",
  robots: { index: false, follow: false },
};

export default async function ConversionBatchPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const result = await getAdminConversionBatch(publicId);
  if (!result) notFound();
  const { batch, candidates } = result;
  const feeIsEstimated = batch.status !== "COMPLETED" || batch.actualFeeUsdMinor === null;

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header>
          <Link href="/admin/finance/conversions" className="text-sm font-semibold text-sage-700">
            ← Conversion batches
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            {batch.status} · {batch.kind === "USD_TO_CRYPTO" ? "USD → crypto" : "Direct crypto"} · fee rate {bpsPercent(batch.feeRateBps)}
          </p>
          <h1 className="text-h2 text-strong">{batch.batchNumber}</h1>
          <p className="mt-2 text-sm text-muted">
            {signedUsd(batch.totalUsdMinor)} across {batch.entries.length} payment(s) → {batch.targetAsset}
            {" · "}fee {batch.actualFeeUsdMinor ? `${signedUsd(batch.actualFeeUsdMinor)} (actual)` : `${signedUsd(batch.estimatedFeeUsdMinor)} (estimated)`}
            {batch.chainFeeUsdMinor ? ` · chain ${signedUsd(batch.chainFeeUsdMinor)}` : ""}
            {batch.transactionId ? ` · tx ${batch.transactionId}` : ""}
          </p>
        </header>

        <section className="overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-900/[0.08] text-xs uppercase text-muted">
                <th className="px-5 py-4">Order</th>
                <th className="px-5 py-4">Method</th>
                <th className="px-5 py-4">USD amount</th>
                <th className="px-5 py-4">Allocated fee</th>
                <th className="px-5 py-4">Allocated chain fee</th>
                <th className="px-5 py-4">Fee state</th>
                {batch.status === "DRAFT" ? <th className="px-5 py-4">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {batch.entries.length === 0 ? (
                <tr>
                  <td colSpan={batch.status === "DRAFT" ? 7 : 6} className="px-5 py-8 text-center text-muted">
                    No payments yet. Add confirmed payments below.
                  </td>
                </tr>
              ) : (
                batch.entries.map((entry) => (
                  <tr key={entry.paymentPublicId} className="border-b border-ink-900/[0.04]">
                    <td className="px-5 py-4">
                      <Link href={`/admin/finance/orders/${entry.orderPublicId}`} className="text-sage-700">
                        {entry.orderNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-4">
                      {entry.method}
                      {entry.cryptoCurrency ? ` (${entry.cryptoCurrency}${entry.actuallyPaid ? ` ${entry.actuallyPaid}` : ""})` : ""}
                    </td>
                    <td className="px-5 py-4">{signedUsd(entry.usdAmountMinor)}</td>
                    <td className="px-5 py-4">{signedUsd(entry.allocatedFeeUsdMinor)}</td>
                    <td className="px-5 py-4">{signedUsd(entry.allocatedChainFeeUsdMinor)}</td>
                    <td className="px-5 py-4">{batch.status === "COMPLETED" ? (feeIsEstimated ? "Estimated" : "Finalized") : "Pending"}</td>
                    {batch.status === "DRAFT" ? (
                      <td className="px-5 py-4">
                        <AdminActionForm action={removePaymentFromBatchAction} submitLabel="Remove">
                          <input type="hidden" name="batchPublicId" value={batch.publicId} />
                          <input type="hidden" name="paymentPublicId" value={entry.paymentPublicId} />
                        </AdminActionForm>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        {batch.status === "DRAFT" ? (
          <section className="grid gap-6 xl:grid-cols-2">
            <article className="rounded-2xl border border-dashed border-sage-700/30 bg-surface p-6">
              <h2 className="text-h4 text-strong">Add a confirmed payment</h2>
              {candidates.length === 0 ? (
                <p className="mt-3 text-sm text-muted">
                  No eligible confirmed payments (matching this batch kind and
                  not already in a live batch).
                </p>
              ) : (
                <AdminActionForm action={addPaymentToBatchAction} className="mt-5 space-y-4" submitLabel="Add payment">
                  <input type="hidden" name="batchPublicId" value={batch.publicId} />
                  <label className={financeLabelClass}>
                    Payment
                    <select className={financeInputClass} name="paymentPublicId" required defaultValue="">
                      <option value="" disabled>Select payment</option>
                      {candidates.map((payment) => (
                        <option key={payment.publicId} value={payment.publicId}>
                          {payment.orderNumber} · {payment.method} · {formatUsdMinor(payment.amountMinor)}
                        </option>
                      ))}
                    </select>
                  </label>
                </AdminActionForm>
              )}
            </article>

            <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
              <h2 className="text-h4 text-strong">Complete batch</h2>
              <p className="mt-2 text-xs text-muted">
                Leave the actual fee empty to allocate the estimate (profit
                stays marked Estimated until the actual value is recorded).
              </p>
              <AdminActionForm action={completeConversionBatchAction} className="mt-5 space-y-4" submitLabel="Complete and lock batch">
                <input type="hidden" name="batchPublicId" value={batch.publicId} />
                <div className="grid gap-4 md:grid-cols-2">
                  <label className={financeLabelClass}>Actual conversion fee (USD)<input className={financeInputClass} name="actualFee" inputMode="decimal" maxLength={16} placeholder={`${(Number(batch.estimatedFeeUsdMinor) / 100).toFixed(2)} estimated`} /></label>
                  <label className={financeLabelClass}>Chain fee (USD)<input className={financeInputClass} name="chainFee" inputMode="decimal" maxLength={16} placeholder="0.00" /></label>
                  <label className={financeLabelClass}>Rate ({batch.targetAsset} per USD)<input className={financeInputClass} name="rate" maxLength={40} placeholder="1.0002" /></label>
                  <label className={financeLabelClass}>Rate source<input className={financeInputClass} name="rateSource" maxLength={160} placeholder="Exchange name" /></label>
                  <label className={financeLabelClass}>Target amount<input className={financeInputClass} name="targetAmount" maxLength={60} placeholder="149.25" /></label>
                  <label className={financeLabelClass}>Actually received<input className={financeInputClass} name="receivedAmount" maxLength={60} placeholder="149.25" /></label>
                  <label className={financeLabelClass}>Transaction ID<input className={financeInputClass} name="transactionId" maxLength={255} /></label>
                  <label className={financeLabelClass}>Converted at (ISO)<input className={financeInputClass} name="convertedAt" maxLength={40} placeholder="2026-07-15T00:00:00Z" /></label>
                </div>
              </AdminActionForm>
            </article>
          </section>
        ) : null}

        {batch.status !== "VOIDED" ? (
          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h5 text-strong">Void batch</h2>
            <p className="mt-2 text-xs text-muted">
              Voiding excludes the batch from all profit figures and releases
              its payments for a replacement batch. The record itself is kept.
            </p>
            <AdminActionForm action={voidConversionBatchAction} className="mt-4" submitLabel="Void batch">
              <input type="hidden" name="batchPublicId" value={batch.publicId} />
            </AdminActionForm>
          </article>
        ) : null}
      </div>
    </section>
  );
}
