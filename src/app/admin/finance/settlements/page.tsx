import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import {
  generateSettlementDraftAction,
  upsertPartnerAction,
} from "@/app/admin/finance/actions";
import {
  bpsPercent,
  financeInputClass,
  financeLabelClass,
  signedUsd,
} from "@/app/admin/finance/_components/format";
import { buildQueryHref, type SearchParameter } from "@/lib/pagination";
import { getAdminSettlementIndex } from "@/server/admin/finance/settlements/queries";

export const metadata: Metadata = {
  title: "Partner settlements",
  robots: { index: false, follow: false },
};

export default async function FinanceSettlementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const { pagination, partners, settlements } = await getAdminSettlementIndex(
    await searchParams,
  );

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <Link href="/admin/finance" className="text-sm font-semibold text-sage-700">
              ← Finance
            </Link>
            <h1 className="mt-4 text-h2 text-strong">Partner settlements</h1>
            <p className="mt-2 text-sm text-muted">
              Draft → confirm → lock → mark paid. Losses carry into the next
              period; locked history is immutable, and nothing is ever paid out
              automatically.
            </p>
          </div>
          <Link
            href="/admin/finance/settlements/export"
            className="rounded-xl border border-ink-900/15 bg-white px-4 py-2.5 text-sm font-semibold text-strong hover:border-sage-600"
          >
            Export CSV
          </Link>
        </header>

        <div className="overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-900/[0.08] text-xs uppercase text-muted">
                <th className="px-5 py-4">Settlement</th>
                <th className="px-5 py-4">Partner</th>
                <th className="px-5 py-4">Period</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Profit</th>
                <th className="px-5 py-4">Carry-in</th>
                <th className="px-5 py-4">Partner share</th>
                <th className="px-5 py-4">My share</th>
                <th className="px-5 py-4">Carry-out</th>
                <th className="px-5 py-4">Paid</th>
              </tr>
            </thead>
            <tbody>
              {settlements.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-10 text-center text-muted">
                    No settlements yet. Create a partner and generate the first
                    draft below.
                  </td>
                </tr>
              ) : (
                settlements.map((settlement) => (
                  <tr key={settlement.publicId as string} className="border-b border-ink-900/[0.04]">
                    <td className="px-5 py-4">
                      <Link href={`/admin/finance/settlements/${settlement.publicId}`} className="font-semibold text-sage-700">
                        {settlement.settlementNumber as string}
                      </Link>
                    </td>
                    <td className="px-5 py-4">{settlement.partnerName as string}</td>
                    <td className="px-5 py-4">
                      {(settlement.periodStart as string).slice(0, 10)} → {(settlement.periodEnd as string).slice(0, 10)}
                    </td>
                    <td className="px-5 py-4">{settlement.status as string}</td>
                    <td className="px-5 py-4">{signedUsd(settlement.profitUsdMinor as string)}</td>
                    <td className="px-5 py-4">{signedUsd(settlement.carryoverInUsdMinor as string)}</td>
                    <td className="px-5 py-4">{signedUsd(settlement.partnerShareUsdMinor as string)}</td>
                    <td className="px-5 py-4">{signedUsd(settlement.ownerShareUsdMinor as string)}</td>
                    <td className="px-5 py-4">{signedUsd(settlement.carryoverOutUsdMinor as string)}</td>
                    <td className="px-5 py-4">
                      {settlement.status === "PAID" ? signedUsd(settlement.paidUsdMinor as string) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination.pageCount > 1 ? (
          <nav className="flex items-center gap-3 text-sm" aria-label="Pagination">
            {pagination.page > 1 ? (
              <Link className="font-semibold text-sage-700" href={buildQueryHref("/admin/finance/settlements", { page: pagination.page - 1 })}>
                ← Previous
              </Link>
            ) : null}
            <span className="text-muted">
              Page {pagination.page} of {pagination.pageCount} · {pagination.total} settlements
            </span>
            {pagination.page < pagination.pageCount ? (
              <Link className="font-semibold text-sage-700" href={buildQueryHref("/admin/finance/settlements", { page: pagination.page + 1 })}>
                Next →
              </Link>
            ) : null}
          </nav>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-2">
          <article className="rounded-2xl border border-dashed border-sage-700/30 bg-surface p-6">
            <h2 className="text-h4 text-strong">Generate settlement draft</h2>
            {partners.filter((partner) => partner.isActive).length === 0 ? (
              <p className="mt-3 text-sm text-muted">Create an active partner first.</p>
            ) : (
              <AdminActionForm action={generateSettlementDraftAction} className="mt-5 space-y-4" submitLabel="Generate draft">
                <label className={financeLabelClass}>
                  Partner
                  <select className={financeInputClass} name="partnerPublicId" required defaultValue="">
                    <option value="" disabled>Select partner</option>
                    {partners.filter((partner) => partner.isActive).map((partner) => (
                      <option key={partner.publicId} value={partner.publicId}>
                        {partner.name} ({bpsPercent(partner.shareBps)})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className={financeLabelClass}>Period start (ISO)<input className={financeInputClass} name="periodStart" required maxLength={40} placeholder="2026-07-01T00:00:00Z" /></label>
                  <label className={financeLabelClass}>Period end (ISO, exclusive)<input className={financeInputClass} name="periodEnd" required maxLength={40} placeholder="2026-08-01T00:00:00Z" /></label>
                </div>
                <label className={financeLabelClass}>Notes<textarea className={financeInputClass} name="notes" rows={2} maxLength={4000} /></label>
              </AdminActionForm>
            )}
          </article>

          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h4 text-strong">Partners</h2>
            <div className="mt-4 space-y-5">
              {partners.map((partner) => (
                <AdminActionForm key={partner.publicId} action={upsertPartnerAction} className="space-y-3 rounded-xl border border-ink-900/[0.06] p-4" submitLabel="Save partner">
                  <input type="hidden" name="publicId" value={partner.publicId} />
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className={financeLabelClass}>Name<input className={financeInputClass} name="name" required maxLength={255} defaultValue={partner.name} /></label>
                    <label className={financeLabelClass}>Share (bps)<input className={financeInputClass} name="shareBps" type="number" min={0} max={10000} step={1} required defaultValue={partner.shareBps} /></label>
                    <label className={financeLabelClass}>
                      Active
                      <select className={financeInputClass} name="isActive" defaultValue={partner.isActive ? "true" : "false"}>
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                    </label>
                  </div>
                  <label className={financeLabelClass}>Effective from (ISO)<input className={financeInputClass} name="effectiveFrom" maxLength={40} defaultValue={partner.effectiveFrom} /></label>
                  <label className={financeLabelClass}>Notes<input className={financeInputClass} name="notes" maxLength={4000} defaultValue={partner.notes ?? ""} /></label>
                </AdminActionForm>
              ))}
              <AdminActionForm action={upsertPartnerAction} className="space-y-3 rounded-xl border border-dashed border-sage-700/30 p-4" submitLabel="Create partner">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className={financeLabelClass}>Name<input className={financeInputClass} name="name" required maxLength={255} /></label>
                  <label className={financeLabelClass}>Share (bps, 5000 = 50%)<input className={financeInputClass} name="shareBps" type="number" min={0} max={10000} step={1} required defaultValue={5000} /></label>
                </div>
                <label className={financeLabelClass}>Effective from (ISO)<input className={financeInputClass} name="effectiveFrom" maxLength={40} placeholder="2026-07-01T00:00:00Z" /></label>
                <label className={financeLabelClass}>Notes<input className={financeInputClass} name="notes" maxLength={4000} /></label>
              </AdminActionForm>
            </div>
          </article>
        </section>
      </div>
    </section>
  );
}
