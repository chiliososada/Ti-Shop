import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { getAdminAuditIndex } from "@/server/admin/access/queries";
import type { AuditFilters } from "@/server/admin/access/validators";

export const metadata: Metadata = {
  title: "Administration audit log",
  robots: { index: false, follow: false },
};

type SearchParameter = string | string[] | undefined;

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function pageHref(filters: AuditFilters, page: number) {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.resourceType) params.set("resourceType", filters.resourceType);
  if (filters.actorPublicId) params.set("actorPublicId", filters.actorPublicId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  params.set("page", String(page));
  params.set("pageSize", String(filters.pageSize));
  return `/admin/audit?${params.toString()}`;
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const result = await getAdminAuditIndex(await searchParams);

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header>
          <Link href="/admin" className="text-sm font-semibold text-sage-700">
            ← Administration
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Accountability
          </p>
          <h1 className="mt-3 text-h2 text-strong">Administration audit log</h1>
          <p className="mt-3 max-w-3xl text-body">
            Review administrative mutations by actor, action, resource, and UTC
            date. This index deliberately omits stored before/after payloads to
            avoid broad disclosure of customer or operational data.
          </p>
        </header>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <h2 className="text-h4 text-strong">Filters</h2>
          <form
            action="/admin/audit"
            method="get"
            className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3"
          >
            <label className="text-sm font-semibold text-strong">
              Action contains
              <input
                name="action"
                maxLength={160}
                defaultValue={result.filters.action ?? ""}
                placeholder="orders. or admin.access"
                className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-strong">
              Resource type contains
              <input
                name="resourceType"
                maxLength={120}
                defaultValue={result.filters.resourceType ?? ""}
                placeholder="order"
                className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-strong">
              Actor public ID
              <input
                name="actorPublicId"
                maxLength={36}
                defaultValue={result.filters.actorPublicId ?? ""}
                placeholder="UUID"
                className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-strong">
              From date (UTC)
              <input
                name="from"
                type="date"
                defaultValue={result.filters.from ?? ""}
                className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-strong">
              Through date (UTC)
              <input
                name="to"
                type="date"
                defaultValue={result.filters.to ?? ""}
                className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-strong">
              Rows per page
              <select
                name="pageSize"
                defaultValue={String(result.filters.pageSize)}
                className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
              >
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </label>
            <div className="flex flex-wrap items-end gap-3 md:col-span-2 xl:col-span-3">
              <button
                type="submit"
                className="rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-white"
              >
                Apply filters
              </button>
              <Link
                href="/admin/audit"
                className="rounded-full border border-ink-900/15 px-6 py-3 text-sm font-semibold text-strong"
              >
                Reset
              </Link>
            </div>
          </form>
          {result.validationError ? (
            <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">
              One or more filters were invalid, so the default filter set was used.
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-h4 text-strong">
              Audit entries ({result.pagination.total})
            </h2>
            <p className="text-caption text-muted">
              Page {result.pagination.page} of {result.pagination.pageCount}
            </p>
          </div>

          {result.entries.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="py-3 pr-4">Time</th>
                    <th className="py-3 pr-4">Actor</th>
                    <th className="py-3 pr-4">Action</th>
                    <th className="py-3 pr-4">Resource</th>
                    <th className="py-3">Audit ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="py-4 pr-4 text-xs text-muted">
                        <time dateTime={entry.createdAt}>
                          {formatTimestamp(entry.createdAt)} UTC
                        </time>
                      </td>
                      <td className="py-4 pr-4">
                        {entry.actor ? (
                          <>
                            <p className="font-semibold text-strong">
                              {entry.actor.name}
                            </p>
                            <p className="mt-1 text-xs text-muted">
                              {entry.actor.email}
                            </p>
                          </>
                        ) : (
                          <span className="text-muted">System / removed user</span>
                        )}
                      </td>
                      <td className="py-4 pr-4 font-mono text-xs">
                        {entry.action}
                      </td>
                      <td className="py-4 pr-4">
                        <p>{entry.resourceType}</p>
                        <p className="mt-1 max-w-xs break-all font-mono text-xs text-muted">
                          {entry.resourceId ?? "No resource ID"}
                        </p>
                      </td>
                      <td className="py-4 font-mono text-xs text-muted">
                        #{entry.id}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-5 text-body">No audit entries match these filters.</p>
          )}

          <nav
            className="mt-6 flex flex-wrap items-center justify-between gap-4"
            aria-label="Audit log pagination"
          >
            {result.pagination.page > 1 ? (
              <Link
                href={pageHref(result.filters, result.pagination.page - 1)}
                className="font-semibold text-sage-700"
              >
                ← Previous page
              </Link>
            ) : (
              <span className="text-sm text-muted">First page</span>
            )}
            {result.pagination.page < result.pagination.pageCount ? (
              <Link
                href={pageHref(result.filters, result.pagination.page + 1)}
                className="font-semibold text-sage-700"
              >
                Next page →
              </Link>
            ) : (
              <span className="text-sm text-muted">Last page</span>
            )}
          </nav>
        </section>
      </div>
    </section>
  );
}
