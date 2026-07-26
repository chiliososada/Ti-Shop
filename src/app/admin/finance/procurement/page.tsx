import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import {
  upsertProcurementOrderAction,
  upsertSupplierAction,
} from "@/app/admin/finance/procurement/actions";
import { formatUsdMinor } from "@/domain/money";
import { buildQueryHref, type SearchParameter } from "@/lib/pagination";
import type { ProcurementIndexFilters } from "@/server/admin/finance/procurement/queries";
import { getAdminProcurementIndex } from "@/server/admin/finance/procurement/queries";
import { DISPLAY_TIME_ZONE } from "@/lib/display-timezone";

export const metadata: Metadata = {
  title: "Procurement administration",
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

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

function pageHref(filters: ProcurementIndexFilters, page: number) {
  return buildQueryHref("/admin/finance/procurement", {
    q: filters.q,
    status: filters.status,
    page,
  });
}

export default async function AdminProcurementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const result = await getAdminProcurementIndex(await searchParams);
  const { filters, pagination, orders, suppliers } = result;

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-12">
        <header className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <Link href="/admin/finance" className="text-sm font-semibold text-sage-700">
              ← Finance
            </Link>
            <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
              CNY procurement
            </p>
            <h1 className="text-h2 text-strong">Purchase orders</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              Record CNY purchase costs, lock the historical CNY/USD rate at
              receipt, and feed the moving-average inventory valuation. Original
              CNY amounts and rates are always retained for review.
            </p>
          </div>
          <Link
            href="/admin/finance/procurement/export"
            className="rounded-xl border border-ink-900/15 bg-white px-4 py-2.5 text-sm font-semibold text-strong hover:border-sage-600"
          >
            Export CSV
          </Link>
        </header>

        <form method="get" action="/admin/finance/procurement" className="grid gap-4 rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:grid-cols-4">
          <label className={labelClass}>
            Search
            <input className={inputClass} name="q" defaultValue={filters.q} maxLength={120} placeholder="PO number or supplier" />
          </label>
          <label className={labelClass}>
            Status
            <select className={inputClass} name="status" defaultValue={filters.status}>
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="ORDERED">Ordered</option>
              <option value="PAID">Paid</option>
              <option value="RECEIVED">Received</option>
              <option value="CANCELED">Canceled</option>
            </select>
          </label>
          <div className="flex items-end gap-3 md:col-span-2">
            <button type="submit" className="rounded-xl bg-ink-900 px-5 py-3 text-sm font-semibold text-white hover:bg-ink-700">
              Apply filters
            </button>
            <Link href="/admin/finance/procurement" className="rounded-xl border border-ink-900/15 bg-white px-5 py-3 text-sm font-semibold text-strong hover:border-sage-600">
              Reset
            </Link>
          </div>
        </form>

        <div className="overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-900/[0.08] text-xs uppercase text-muted">
                <th className="px-5 py-4">PO</th>
                <th className="px-5 py-4">Supplier</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Lines</th>
                <th className="px-5 py-4">CNY total</th>
                <th className="px-5 py-4">FX rate</th>
                <th className="px-5 py-4">USD total</th>
                <th className="px-5 py-4">Received</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-muted">
                    No purchase orders match the current filters. Create the
                    first one below.
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.publicId} className="border-b border-ink-900/[0.04]">
                    <td className="px-5 py-4">
                      <Link href={`/admin/finance/procurement/${order.publicId}`} className="font-semibold text-sage-700">
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-4">{order.supplierName}</td>
                    <td className="px-5 py-4">{order.status}</td>
                    <td className="px-5 py-4">{order.itemCount}</td>
                    <td className="px-5 py-4">{formatCny(order.totalCnyMinor)}</td>
                    <td className="px-5 py-4">{order.fxRate ?? "—"}</td>
                    <td className="px-5 py-4">
                      {order.totalUsdMinor ? formatUsdMinor(order.totalUsdMinor) : "—"}
                    </td>
                    <td className="px-5 py-4">{formatDate(order.receivedAt)}</td>
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
              Page {pagination.page} of {pagination.pageCount} · {pagination.total} purchase orders
            </span>
            {pagination.page < pagination.pageCount ? (
              <Link className="font-semibold text-sage-700" href={pageHref(filters, pagination.page + 1)}>
                Next →
              </Link>
            ) : null}
          </nav>
        ) : null}

        <article className="rounded-2xl border border-dashed border-sage-700/30 bg-surface p-6">
          <h2 className="text-h4 text-strong">New purchase order</h2>
          {suppliers.length === 0 ? (
            <p className="mt-4 text-sm text-muted">
              Create a supplier below first; every purchase order belongs to a
              supplier.
            </p>
          ) : (
            <AdminActionForm action={upsertProcurementOrderAction} className="mt-6 space-y-5" submitLabel="Create purchase order">
              <div className="grid gap-5 md:grid-cols-3">
                <label className={labelClass}>
                  Supplier
                  <select className={inputClass} name="supplierPublicId" required defaultValue="">
                    <option value="" disabled>Select supplier</option>
                    {suppliers.filter((supplier) => supplier.isActive).map((supplier) => (
                      <option key={supplier.publicId} value={supplier.publicId}>{supplier.name}</option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Status
                  <select className={inputClass} name="status" defaultValue="DRAFT">
                    <option value="DRAFT">Draft</option>
                    <option value="ORDERED">Ordered</option>
                    <option value="PAID">Paid</option>
                  </select>
                </label>
                <label className={labelClass}>
                  Ordered at (ISO, optional)
                  <input className={inputClass} name="orderedAt" maxLength={40} placeholder="2026-07-01T00:00:00Z" />
                </label>
                <label className={labelClass}>
                  Domestic shipping (CNY)
                  <input className={inputClass} name="domesticShipping" inputMode="decimal" placeholder="0.00" maxLength={16} />
                </label>
                <label className={labelClass}>
                  International shipping (CNY)
                  <input className={inputClass} name="internationalShipping" inputMode="decimal" placeholder="0.00" maxLength={16} />
                </label>
                <label className={labelClass}>
                  Customs (CNY, optional)
                  <input className={inputClass} name="customs" inputMode="decimal" placeholder="0.00" maxLength={16} />
                </label>
                <label className={labelClass}>
                  Procurement fee (CNY)
                  <input className={inputClass} name="procurementFee" inputMode="decimal" placeholder="0.00" maxLength={16} />
                </label>
                <label className={labelClass}>
                  Packaging (CNY)
                  <input className={inputClass} name="packaging" inputMode="decimal" placeholder="0.00" maxLength={16} />
                </label>
                <label className={labelClass}>
                  Other cost (CNY)
                  <input className={inputClass} name="otherCost" inputMode="decimal" placeholder="0.00" maxLength={16} />
                </label>
              </div>
              <label className={labelClass}>
                Notes
                <textarea className={inputClass} name="notes" rows={2} maxLength={4000} />
              </label>
            </AdminActionForm>
          )}
        </article>

        <section>
          <h2 className="text-h3 text-strong">Suppliers ({suppliers.length})</h2>
          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <article className="rounded-2xl border border-dashed border-sage-700/30 bg-surface p-6">
              <h3 className="text-h5 text-strong">New supplier</h3>
              <AdminActionForm action={upsertSupplierAction} className="mt-5 space-y-4" submitLabel="Create supplier">
                <label className={labelClass}>Name<input className={inputClass} name="name" required maxLength={255} /></label>
                <label className={labelClass}>Contact name<input className={inputClass} name="contactName" maxLength={160} /></label>
                <label className={labelClass}>Contact details<textarea className={inputClass} name="contactDetails" rows={2} maxLength={4000} /></label>
                <label className={labelClass}>Notes<textarea className={inputClass} name="notes" rows={2} maxLength={4000} /></label>
              </AdminActionForm>
            </article>
            {suppliers.map((supplier) => (
              <article key={supplier.publicId} className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-h5 text-strong">{supplier.name}</h3>
                  <span className="text-xs text-muted">{supplier._count.purchaseOrders} POs · {supplier.isActive ? "Active" : "Inactive"}</span>
                </div>
                <AdminActionForm action={upsertSupplierAction} className="mt-5 space-y-4" submitLabel="Save supplier">
                  <input type="hidden" name="publicId" value={supplier.publicId} />
                  <label className={labelClass}>Name<input className={inputClass} name="name" required maxLength={255} defaultValue={supplier.name} /></label>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className={labelClass}>Contact name<input className={inputClass} name="contactName" maxLength={160} defaultValue={supplier.contactName ?? ""} /></label>
                    <label className={labelClass}>
                      Active
                      <select className={inputClass} name="isActive" defaultValue={supplier.isActive ? "true" : "false"}>
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                    </label>
                  </div>
                  <label className={labelClass}>Contact details<textarea className={inputClass} name="contactDetails" rows={2} maxLength={4000} defaultValue={supplier.contactDetails ?? ""} /></label>
                  <label className={labelClass}>Notes<textarea className={inputClass} name="notes" rows={2} maxLength={4000} defaultValue={supplier.notes ?? ""} /></label>
                </AdminActionForm>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
