import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { PaginationNav } from "@/components/PaginationNav";
import { buildQueryHref, type SearchParameter } from "@/lib/pagination";
import type { AdminCustomerFilters } from "@/server/admin/customers/filters";
import { getAdminCustomerIndex } from "@/server/admin/customers/queries";

export const metadata: Metadata = {
  title: "Customer administration",
  robots: { index: false, follow: false },
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function customerPageHref(filters: AdminCustomerFilters, page: number) {
  return buildQueryHref("/admin/customers", {
    q: filters.q || undefined,
    page: page > 1 ? page : undefined,
  });
}

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const result = await getAdminCustomerIndex(await searchParams);

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x">
        <header>
          <Link href="/admin" className="text-sm font-semibold text-sage-700">
            ← Administration
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Customer service
          </p>
          <h1 className="mt-3 text-h2 text-strong">Customers</h1>
          <p className="mt-3 max-w-3xl text-body">
            Review customer accounts, US contact profiles, order activity, and
            communication summaries. Authentication secrets and payment credentials
            are never included in this view.
          </p>
        </header>

        {result.validationError ? (
          <p
            role="alert"
            className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-800"
          >
            One or more customer filters were invalid, so safe defaults were used.
          </p>
        ) : null}

        <form
          action="/admin/customers"
          method="get"
          className="mt-8 flex flex-wrap items-end gap-3 rounded-2xl border border-ink-900/[0.08] bg-surface p-6"
        >
          <label className="min-w-64 flex-1 text-sm font-semibold text-strong">
            Search customers
            <input
              name="q"
              type="search"
              maxLength={120}
              defaultValue={result.filters.q}
              placeholder="Name, email, or phone"
              className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
            />
          </label>
          <button
            type="submit"
            className="rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-white"
          >
            Search
          </button>
          <Link
            href="/admin/customers"
            className="rounded-full border border-ink-900/15 px-6 py-3 text-sm font-semibold text-strong"
          >
            Reset
          </Link>
        </form>

        <section className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-h4 text-strong">
              Customer accounts ({result.pagination.total})
            </h2>
            <p className="text-caption text-muted">
              Page {result.pagination.page} of {result.pagination.pageCount}
            </p>
          </div>
          {result.customers.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="py-3 pr-4">Customer</th>
                    <th className="py-3 pr-4">Email</th>
                    <th className="py-3 pr-4">Phone</th>
                    <th className="py-3 pr-4">Access</th>
                    <th className="py-3 pr-4">Orders</th>
                    <th className="py-3 pr-4">Communication</th>
                    <th className="py-3 pr-4">Joined</th>
                    <th className="py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.customers.map((customer) => (
                    <tr key={customer.publicId}>
                      <td className="py-4 pr-4">
                        <p className="font-semibold text-strong">{customer.name}</p>
                        <p className="mt-1 text-xs text-muted">
                          {[customer.firstName, customer.lastName]
                            .filter(Boolean)
                            .join(" ") || "Profile name not set"}
                        </p>
                      </td>
                      <td className="py-4 pr-4">
                        <p>{customer.email}</p>
                        <p className="mt-1 text-xs text-muted">
                          {customer.emailVerified ? "Verified" : "Not verified"}
                        </p>
                      </td>
                      <td className="py-4 pr-4">{customer.phone ?? "—"}</td>
                      <td className="py-4 pr-4">
                        {customer.isDisabled ? "Disabled" : "Active"}
                      </td>
                      <td className="py-4 pr-4">{customer.orderCount}</td>
                      <td className="py-4 pr-4 text-xs text-muted">
                        {customer.whatsappIntentCount} WhatsApp intent
                        {customer.whatsappIntentCount === 1 ? "" : "s"} · {" "}
                        {customer.inquiryCount} inquir
                        {customer.inquiryCount === 1 ? "y" : "ies"}
                      </td>
                      <td className="py-4 pr-4 text-xs text-muted">
                        {formatDate(customer.createdAt)} UTC
                      </td>
                      <td className="py-4">
                        <Link
                          href={`/admin/customers/${customer.publicId}`}
                          className="font-semibold text-sage-700"
                        >
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-5 text-body">No customer accounts match this search.</p>
          )}
          <PaginationNav
            page={result.pagination.page}
            pageCount={result.pagination.pageCount}
            previousHref={
              result.pagination.page > 1
                ? customerPageHref(
                    result.filters,
                    result.pagination.page - 1,
                  )
                : null
            }
            nextHref={
              result.pagination.page < result.pagination.pageCount
                ? customerPageHref(
                    result.filters,
                    result.pagination.page + 1,
                  )
                : null
            }
            label="Customer administration pagination"
          />
        </section>
      </div>
    </section>
  );
}
