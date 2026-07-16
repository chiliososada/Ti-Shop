import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { PaginationNav } from "@/components/PaginationNav";
import { buildQueryHref, type SearchParameter } from "@/lib/pagination";
import {
  ADMIN_SEO_INDEX_TYPES,
  type AdminSeoFilters,
  type AdminSeoIndexType,
} from "@/server/admin/seo/filters";
import { getAdminSeoIndex } from "@/server/admin/seo/queries";

export const metadata: Metadata = {
  title: "SEO administration",
  robots: { index: false, follow: false },
};

const entityLabels: Record<AdminSeoIndexType, string> = {
  product: "Products",
  category: "Categories",
  blog: "Blog posts",
  page: "Standalone and fixed pages",
  redirect: "Permanent redirects",
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";

function adminSeoHref(
  filters: AdminSeoFilters,
  overrides: Partial<AdminSeoFilters> = {},
) {
  const next = { ...filters, ...overrides };
  return buildQueryHref("/admin/seo", {
    entity: next.entityType === "product" ? undefined : next.entityType,
    page: next.page > 1 ? next.page : undefined,
    q: next.query || undefined,
  });
}

export default async function AdminSeoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const seo = await getAdminSeoIndex(await searchParams);
  const selectedLabel = entityLabels[seo.filters.entityType];

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header>
          <Link href="/admin" className="text-sm font-semibold text-sage-700">
            ← Administration
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            SEO
          </p>
          <h1 className="mt-3 text-h2 text-strong">Search metadata</h1>
          <p className="mt-3 max-w-3xl text-body">
            Manage titles, descriptions, canonicals, indexing directives, and
            public redirects independently of protected storefront slugs.
          </p>
          {seo.validationError ? (
            <p
              role="alert"
              className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800"
            >
              One or more SEO filters were invalid, so safe defaults were used.
            </p>
          ) : null}
        </header>

        <nav
          aria-label="SEO record type"
          className="flex flex-wrap gap-2 rounded-2xl border border-ink-900/[0.08] bg-surface p-3"
        >
          {ADMIN_SEO_INDEX_TYPES.map((entityType) => (
            <Link
              key={entityType}
              href={adminSeoHref(seo.filters, {
                entityType,
                query: "",
                page: 1,
              })}
              aria-current={
                seo.filters.entityType === entityType ? "page" : undefined
              }
              className={
                seo.filters.entityType === entityType
                  ? "rounded-full bg-ink-900 px-4 py-2 text-sm font-semibold text-white"
                  : "rounded-full px-4 py-2 text-sm font-semibold text-strong hover:bg-ink-900/[0.05]"
              }
            >
              {entityLabels[entityType]}
            </Link>
          ))}
        </nav>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <h2 className="text-h4 text-strong">
                {selectedLabel} ({seo.pagination.total})
              </h2>
              <p className="mt-2 text-sm text-muted">
                {seo.filters.entityType === "redirect"
                  ? "Root-relative 301/308 redirects are applied to public storefront requests only."
                  : "Search the complete entity collection and edit its SEO metadata."}
              </p>
            </div>
            {seo.filters.entityType === "redirect" ? (
              <Link
                href="/admin/seo/redirects/new"
                className="shrink-0 rounded-full bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white"
              >
                Create redirect
              </Link>
            ) : null}
          </div>

          <form
            action="/admin/seo"
            method="get"
            className="mt-5 flex flex-wrap items-end gap-3"
          >
            <input
              type="hidden"
              name="entity"
              value={seo.filters.entityType}
            />
            <label className="min-w-64 flex-1 text-sm font-semibold text-strong">
              Search {selectedLabel.toLowerCase()}
              <input
                className={inputClass}
                name="q"
                type="search"
                maxLength={120}
                defaultValue={seo.filters.query}
                placeholder={
                  seo.filters.entityType === "redirect"
                    ? "Source or destination path"
                    : "Page label, slug, or configured metadata"
                }
              />
            </label>
            <button
              type="submit"
              className="rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-white"
            >
              Search
            </button>
            <Link
              href={adminSeoHref(seo.filters, { query: "", page: 1 })}
              className="rounded-full border border-ink-900/15 px-5 py-3 text-sm font-semibold text-strong"
            >
              Reset
            </Link>
          </form>

          {seo.filters.entityType === "redirect" ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[800px] text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="py-3 pr-4">Source</th>
                    <th className="py-3 pr-4">Destination</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4">Hits</th>
                    <th className="py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {seo.records.map((item) =>
                    item.kind === "redirect" ? (
                      <tr key={item.publicId}>
                        <td className="py-4 pr-4 font-mono text-xs text-strong">
                          {item.sourcePath}
                        </td>
                        <td className="py-4 pr-4 font-mono text-xs text-strong">
                          {item.destinationPath}
                        </td>
                        <td className="py-4 pr-4">
                          {item.isActive
                            ? `${item.statusCode} active`
                            : `${item.statusCode} inactive`}
                        </td>
                        <td className="py-4 pr-4">{item.hitCount}</td>
                        <td className="py-4">
                          <Link
                            className="font-semibold text-sage-700"
                            href={`/admin/seo/redirects/${item.publicId}`}
                          >
                            Edit
                          </Link>
                        </td>
                      </tr>
                    ) : null,
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="py-3 pr-4">Page</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4">SEO</th>
                    <th className="py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {seo.records.map((item) =>
                    item.kind === "target" ? (
                      <tr key={item.publicId}>
                        <td className="py-4 pr-4">
                          <p className="font-semibold text-strong">{item.label}</p>
                          <p className="mt-1 font-mono text-xs text-muted">
                            {item.publicPath}
                          </p>
                        </td>
                        <td className="py-4 pr-4">{item.status}</td>
                        <td className="py-4 pr-4">
                          {item.noIndex
                            ? "No index"
                            : item.isConfigured
                              ? "Configured"
                              : "Default metadata"}
                        </td>
                        <td className="py-4">
                          <Link
                            className="font-semibold text-sage-700"
                            href={`/admin/seo/${item.entityType}/${item.publicId}`}
                          >
                            Edit
                          </Link>
                        </td>
                      </tr>
                    ) : null,
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!seo.records.length ? (
            <p className="py-8 text-body">
              No {selectedLabel.toLowerCase()} match this search.
            </p>
          ) : null}

          <PaginationNav
            page={seo.pagination.page}
            pageCount={seo.pagination.pageCount}
            previousHref={
              seo.pagination.page > 1
                ? adminSeoHref(seo.filters, {
                    page: seo.pagination.page - 1,
                  })
                : null
            }
            nextHref={
              seo.pagination.page < seo.pagination.pageCount
                ? adminSeoHref(seo.filters, {
                    page: seo.pagination.page + 1,
                  })
                : null
            }
            label={`Admin ${selectedLabel.toLowerCase()} pagination`}
          />
        </section>
      </div>
    </section>
  );
}
