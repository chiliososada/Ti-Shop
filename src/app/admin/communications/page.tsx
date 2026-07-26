import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { PaginationNav } from "@/components/PaginationNav";
import { humanizeCommerceStatus } from "@/domain/order";
import { buildQueryHref, type SearchParameter } from "@/lib/pagination";
import type { AdminCommunicationsFilters } from "@/server/admin/communications/filters";
import { getAdminCommunicationsIndex } from "@/server/admin/communications/queries";

import { createWhatsAppFollowUpAction } from "./actions";
import { DISPLAY_TIME_ZONE } from "@/lib/display-timezone";

export const metadata: Metadata = {
  title: "Customer communications administration",
  robots: { index: false, follow: false },
};

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

function linkedContext(intent: {
  order: { orderNumber: string } | null;
  product: { title: string } | null;
  hasCartContext: boolean;
}) {
  return [
    intent.order ? `Order ${intent.order.orderNumber}` : null,
    intent.product ? `Product ${intent.product.title}` : null,
    intent.hasCartContext ? "Cart context" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";

function adminCommunicationsHref(
  filters: AdminCommunicationsFilters,
  overrides: Partial<AdminCommunicationsFilters> = {},
) {
  const next = { ...filters, ...overrides };
  return buildQueryHref("/admin/communications", {
    inquiryPage: next.inquiryPage > 1 ? next.inquiryPage : undefined,
    inquiryQ: next.inquiryQuery || undefined,
    inquiryStatus: next.inquiryStatus || undefined,
    intentPage: next.intentPage > 1 ? next.intentPage : undefined,
    intentQ: next.intentQuery || undefined,
    intentStatus: next.intentStatus || undefined,
  });
}

export default async function AdminCommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const result = await getAdminCommunicationsIndex(await searchParams);
  const statuses = Object.entries(result.counts.byStatus);

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header>
          <Link href="/admin" className="text-sm font-semibold text-sage-700">
            ← Administration
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Customer service
          </p>
          <h1 className="mt-3 text-h2 text-strong">Communications</h1>
          <p className="mt-3 max-w-4xl text-body">
            Manage inquiry ownership, lifecycle, and internal notes. WhatsApp
            records below are click-to-chat intents only: this site does not send
            WhatsApp messages, import conversations, or claim that a customer
            message was delivered.
          </p>
          {result.validationError ? (
            <p
              role="alert"
              className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800"
            >
              One or more communication filters were invalid, so safe defaults
              were used.
            </p>
          ) : null}
        </header>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-5">
            <p className="text-caption font-semibold uppercase tracking-wider text-muted">
              All inquiries
            </p>
            <p className="mt-2 text-h3 text-strong">{result.counts.inquiries}</p>
          </article>
          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-5">
            <p className="text-caption font-semibold uppercase tracking-wider text-muted">
              Active workload
            </p>
            <p className="mt-2 text-h3 text-strong">
              {result.counts.byStatus.OPEN +
                result.counts.byStatus.IN_PROGRESS +
                result.counts.byStatus.WAITING_CUSTOMER}
            </p>
          </article>
          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-5">
            <p className="text-caption font-semibold uppercase tracking-wider text-muted">
              Resolved / closed
            </p>
            <p className="mt-2 text-h3 text-strong">
              {result.counts.byStatus.RESOLVED + result.counts.byStatus.CLOSED}
            </p>
          </article>
          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-5">
            <p className="text-caption font-semibold uppercase tracking-wider text-muted">
              WhatsApp intents
            </p>
            <p className="mt-2 text-h3 text-strong">{result.counts.intents}</p>
          </article>
        </div>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-h4 text-strong">Inquiry queue</h2>
              <p className="mt-2 text-sm text-muted">
                {result.inquiryPagination.total} matching inquiries · Overall status totals: {statuses.map(([status, count]) =>
                  `${humanizeCommerceStatus(status)} ${count}`
                ).join(" · ")}
              </p>
            </div>
          </div>

          <form
            action="/admin/communications"
            method="get"
            className="mt-5 flex flex-wrap items-end gap-3"
          >
            {result.filters.intentQuery ? (
              <input type="hidden" name="intentQ" value={result.filters.intentQuery} />
            ) : null}
            {result.filters.intentStatus ? (
              <input type="hidden" name="intentStatus" value={result.filters.intentStatus} />
            ) : null}
            {result.filters.intentPage > 1 ? (
              <input type="hidden" name="intentPage" value={result.filters.intentPage} />
            ) : null}
            <label className="min-w-64 flex-1 text-sm font-semibold text-strong">
              Search inquiries
              <input
                className={inputClass}
                name="inquiryQ"
                type="search"
                maxLength={120}
                defaultValue={result.filters.inquiryQuery}
                placeholder="Inquiry, customer, order, product, or subject"
              />
            </label>
            <label className="min-w-52 text-sm font-semibold text-strong">
              Status
              <select
                className={inputClass}
                name="inquiryStatus"
                defaultValue={result.filters.inquiryStatus}
              >
                <option value="">All statuses</option>
                {Object.keys(result.counts.byStatus).map((status) => (
                  <option key={status} value={status}>
                    {humanizeCommerceStatus(status)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-white"
            >
              Apply
            </button>
            <Link
              href={adminCommunicationsHref(result.filters, {
                inquiryQuery: "",
                inquiryStatus: "",
                inquiryPage: 1,
              })}
              className="rounded-full border border-ink-900/15 px-5 py-3 text-sm font-semibold text-strong"
            >
              Reset inquiries
            </Link>
          </form>

          {result.inquiries.length ? (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="py-3 pr-4">Inquiry</th>
                    <th className="py-3 pr-4">Customer</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4">Assignee</th>
                    <th className="py-3 pr-4">Linked context</th>
                    <th className="py-3 pr-4">Activity</th>
                    <th className="py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.inquiries.map((inquiry) => {
                    const customerName =
                      inquiry.customer?.name ??
                      inquiry.recordedCustomerName ??
                      "Customer name not recorded";
                    const customerEmail =
                      inquiry.customer?.email ?? inquiry.recordedCustomerEmail;
                    return (
                      <tr key={inquiry.publicId}>
                        <td className="py-4 pr-4 align-top">
                          <p className="font-mono font-semibold text-sage-700">
                            {inquiry.inquiryNumber}
                          </p>
                          <p className="mt-1 max-w-sm font-semibold text-strong">
                            {inquiry.subject}
                          </p>
                          <p className="mt-1 text-xs text-muted">
                            {humanizeCommerceStatus(inquiry.source)}
                          </p>
                        </td>
                        <td className="py-4 pr-4 align-top">
                          <p className="font-semibold text-strong">{customerName}</p>
                          <p className="mt-1 text-xs text-muted">
                            {customerEmail ?? "No email snapshot"}
                          </p>
                        </td>
                        <td className="py-4 pr-4 align-top">
                          {humanizeCommerceStatus(inquiry.status)}
                        </td>
                        <td className="py-4 pr-4 align-top">
                          {inquiry.assignedTo?.name ?? "Unassigned"}
                        </td>
                        <td className="py-4 pr-4 align-top text-xs text-muted">
                          {inquiry.order
                            ? `Order ${inquiry.order.orderNumber}`
                            : ""}
                          {inquiry.product
                            ? `${inquiry.order ? " · " : ""}Product ${inquiry.product.title}`
                            : ""}
                          {!inquiry.order && !inquiry.product
                            ? "No linked order or product"
                            : ""}
                        </td>
                        <td className="py-4 pr-4 align-top text-xs text-muted">
                          {inquiry.whatsappIntentCount} intent
                          {inquiry.whatsappIntentCount === 1 ? "" : "s"} · {" "}
                          {inquiry.internalNoteCount} internal note
                          {inquiry.internalNoteCount === 1 ? "" : "s"}
                          <br />
                          Updated {formatDate(inquiry.updatedAt)} UTC
                        </td>
                        <td className="py-4 align-top">
                          <Link
                            href={`/admin/communications/${inquiry.publicId}`}
                            className="font-semibold text-sage-700"
                          >
                            Review
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-6 text-body">No inquiries match these filters.</p>
          )}
          <PaginationNav
            page={result.inquiryPagination.page}
            pageCount={result.inquiryPagination.pageCount}
            previousHref={
              result.inquiryPagination.page > 1
                ? adminCommunicationsHref(result.filters, {
                    inquiryPage: result.inquiryPagination.page - 1,
                  })
                : null
            }
            nextHref={
              result.inquiryPagination.page < result.inquiryPagination.pageCount
                ? adminCommunicationsHref(result.filters, {
                    inquiryPage: result.inquiryPagination.page + 1,
                  })
                : null
            }
            label="Admin inquiry pagination"
          />
        </section>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-h4 text-strong">WhatsApp contact intents</h2>
              <p className="mt-2 max-w-4xl text-sm text-muted">
                {result.intentPagination.total} matching intents. Only coarse source, controlled template label,
                business-record links, and timestamps are shown. Free-form contact
                requirements and rendered WhatsApp text are not persisted, so no
                transcript exists in this system.
              </p>
            </div>
          </div>

          <form
            action="/admin/communications"
            method="get"
            className="mt-5 flex flex-wrap items-end gap-3"
          >
            {result.filters.inquiryQuery ? (
              <input type="hidden" name="inquiryQ" value={result.filters.inquiryQuery} />
            ) : null}
            {result.filters.inquiryStatus ? (
              <input type="hidden" name="inquiryStatus" value={result.filters.inquiryStatus} />
            ) : null}
            {result.filters.inquiryPage > 1 ? (
              <input type="hidden" name="inquiryPage" value={result.filters.inquiryPage} />
            ) : null}
            <label className="min-w-64 flex-1 text-sm font-semibold text-strong">
              Search intents
              <input
                className={inputClass}
                name="intentQ"
                type="search"
                maxLength={120}
                defaultValue={result.filters.intentQuery}
                placeholder="Source, template, customer, order, product, or inquiry"
              />
            </label>
            <label className="min-w-52 text-sm font-semibold text-strong">
              State
              <select
                className={inputClass}
                name="intentStatus"
                defaultValue={result.filters.intentStatus}
              >
                <option value="">All states</option>
                <option value="RECORDED">Intent recorded</option>
                <option value="OPENED">Click-to-chat prepared</option>
              </select>
            </label>
            <button
              type="submit"
              className="rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-white"
            >
              Apply
            </button>
            <Link
              href={adminCommunicationsHref(result.filters, {
                intentQuery: "",
                intentStatus: "",
                intentPage: 1,
              })}
              className="rounded-full border border-ink-900/15 px-5 py-3 text-sm font-semibold text-strong"
            >
              Reset intents
            </Link>
          </form>

          {result.intents.length ? (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[1160px] text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="py-3 pr-4">Recorded intent</th>
                    <th className="py-3 pr-4">Customer</th>
                    <th className="py-3 pr-4">Safe context</th>
                    <th className="py-3 pr-4">State</th>
                    <th className="py-3">Follow-up</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.intents.map((intent) => (
                    <tr key={intent.publicId}>
                      <td className="py-4 pr-4 align-top">
                        <p className="font-semibold text-strong">
                          {intent.sourceArea}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          Template: {intent.templateKey}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          Recorded {formatDate(intent.createdAt)} UTC
                        </p>
                      </td>
                      <td className="py-4 pr-4 align-top">
                        {intent.customer?.name ?? "Anonymous intent"}
                      </td>
                      <td className="py-4 pr-4 align-top text-xs text-muted">
                        {linkedContext(intent) || "No linked business record"}
                      </td>
                      <td className="py-4 pr-4 align-top">
                        <p>
                          {intent.wasOpened
                            ? "Click-to-chat handoff prepared"
                            : "Intent recorded"}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {intent.openedAt
                            ? `${formatDate(intent.openedAt)} UTC`
                            : "Handoff status is not known"}
                        </p>
                      </td>
                      <td className="py-4 align-top">
                        {intent.inquiry ? (
                          <Link
                            href={`/admin/communications/${intent.inquiry.publicId}`}
                            className="font-semibold text-sage-700"
                          >
                            {intent.inquiry.inquiryNumber}
                          </Link>
                        ) : result.access.canManage && intent.canCreateFollowUp ? (
                          <AdminActionForm
                            action={createWhatsAppFollowUpAction}
                            submitLabel="Create follow-up"
                            className="min-w-56 space-y-3"
                          >
                            <input
                              type="hidden"
                              name="intentPublicId"
                              value={intent.publicId}
                            />
                            <p className="text-xs leading-relaxed text-muted">
                              Creates an operational inquiry, not a customer
                              message.
                            </p>
                          </AdminActionForm>
                        ) : (
                          <p className="max-w-xs text-xs leading-relaxed text-muted">
                            {result.access.canManage
                              ? "No stored identity or order contact is available for a follow-up record."
                              : "No linked inquiry."}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-6 text-body">
              No WhatsApp contact intents match these filters.
            </p>
          )}
          <PaginationNav
            page={result.intentPagination.page}
            pageCount={result.intentPagination.pageCount}
            previousHref={
              result.intentPagination.page > 1
                ? adminCommunicationsHref(result.filters, {
                    intentPage: result.intentPagination.page - 1,
                  })
                : null
            }
            nextHref={
              result.intentPagination.page < result.intentPagination.pageCount
                ? adminCommunicationsHref(result.filters, {
                    intentPage: result.intentPagination.page + 1,
                  })
                : null
            }
            label="Admin WhatsApp intent pagination"
          />
        </section>
      </div>
    </section>
  );
}
