import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { humanizeCommerceStatus } from "@/domain/order";
import { allowedInquiryTransitions } from "@/server/admin/communications/lifecycle";
import { getAdminCommunicationInquiry } from "@/server/admin/communications/queries";

import {
  addInquiryNoteAction,
  assignInquiryAction,
  updateInquiryStatusAction,
} from "../actions";
import { DISPLAY_TIME_ZONE } from "@/lib/display-timezone";

export const metadata: Metadata = {
  title: "Inquiry administration",
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

export default async function AdminCommunicationInquiryPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const inquiry = await getAdminCommunicationInquiry(publicId);
  if (!inquiry) notFound();

  const transitions = allowedInquiryTransitions(inquiry.status);
  const activeAdministratorIds = new Set(
    inquiry.activeAdministrators.map((administrator) => administrator.publicId),
  );

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header>
          <Link
            href="/admin/communications"
            className="text-sm font-semibold text-sage-700"
          >
            ← Communications
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            {inquiry.inquiryNumber}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-h2 text-strong">{inquiry.subject}</h1>
            <span className="rounded-full bg-sage-100 px-3 py-1 text-caption font-semibold text-sage-700">
              {humanizeCommerceStatus(inquiry.status)}
            </span>
          </div>
          <p className="mt-3 text-body">
            {humanizeCommerceStatus(inquiry.source)} inquiry · Created {formatDate(inquiry.createdAt)} UTC
          </p>
          <p className="mt-2 text-caption text-muted">
            Last updated {formatDate(inquiry.updatedAt)} UTC
          </p>
        </header>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
            <h2 className="text-h4 text-strong">Stored inquiry text</h2>
            <p className="mt-5 whitespace-pre-wrap text-body">
              {inquiry.message}
            </p>
            {inquiry.source === "WHATSAPP" ? (
              <p className="mt-6 rounded-xl bg-surface-alt p-4 text-sm leading-relaxed text-muted">
                A WhatsApp source does not mean this site has a chat transcript.
                Click-to-chat requirements and external conversation messages are
                not imported or synchronized here.
              </p>
            ) : null}
          </section>

          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
            <h2 className="text-h4 text-strong">Customer contact</h2>
            <dl className="mt-6 grid gap-5">
              <div>
                <dt className="text-caption text-muted">Customer account</dt>
                <dd className="mt-1 text-body">
                  {inquiry.customer ? (
                    inquiry.access.canReadCustomers ? (
                      <Link
                        href={`/admin/customers/${inquiry.customer.publicId}`}
                        className="font-semibold text-sage-700"
                      >
                        {inquiry.customer.name} · {inquiry.customer.email}
                      </Link>
                    ) : (
                      `${inquiry.customer.name} · ${inquiry.customer.email}`
                    )
                  ) : (
                    "No linked account"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-muted">Recorded name</dt>
                <dd className="mt-1 text-body">
                  {inquiry.recordedContact.name ?? "Not recorded"}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-muted">Recorded email</dt>
                <dd className="mt-1 break-all text-body">
                  {inquiry.recordedContact.email ?? "Not recorded"}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-muted">Recorded phone</dt>
                <dd className="mt-1 text-body">
                  {inquiry.recordedContact.phone ?? "Not recorded"}
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h5 text-strong">Assignment</h2>
            <p className="mt-3 text-sm text-muted">
              {inquiry.assignedTo
                ? `${inquiry.assignedTo.name} · ${inquiry.assignedTo.email}`
                : "This inquiry is unassigned."}
            </p>
            {inquiry.access.canManage ? (
              <AdminActionForm
                action={assignInquiryAction}
                submitLabel="Save assignment"
                className="mt-5 space-y-4"
              >
                <input
                  type="hidden"
                  name="inquiryPublicId"
                  value={inquiry.publicId}
                />
                <input
                  type="hidden"
                  name="expectedUpdatedAt"
                  value={inquiry.updatedAt}
                />
                <label className="block text-sm font-semibold text-strong">
                  Eligible administrator
                  <select
                    name="assignedToUserId"
                    defaultValue={inquiry.assignedTo?.publicId ?? ""}
                    className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                  >
                    <option value="">Unassigned</option>
                    {inquiry.assignedTo &&
                    !activeAdministratorIds.has(inquiry.assignedTo.publicId) ? (
                      <option value={inquiry.assignedTo.publicId} disabled>
                        {inquiry.assignedTo.name} (inactive)
                      </option>
                    ) : null}
                    {inquiry.activeAdministrators.map((administrator) => (
                      <option
                        key={administrator.publicId}
                        value={administrator.publicId}
                      >
                        {administrator.name} · {administrator.email}
                      </option>
                    ))}
                  </select>
                </label>
              </AdminActionForm>
            ) : null}
          </section>

          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h5 text-strong">Lifecycle</h2>
            <dl className="mt-3 space-y-2 text-sm text-muted">
              <div>
                <dt className="inline font-semibold text-strong">Resolved: </dt>
                <dd className="inline">
                  {inquiry.resolvedAt
                    ? `${formatDate(inquiry.resolvedAt)} UTC`
                    : "Not recorded"}
                </dd>
              </div>
              <div>
                <dt className="inline font-semibold text-strong">Closed: </dt>
                <dd className="inline">
                  {inquiry.closedAt
                    ? `${formatDate(inquiry.closedAt)} UTC`
                    : "Not recorded"}
                </dd>
              </div>
            </dl>
            {inquiry.access.canManage ? (
              <AdminActionForm
                action={updateInquiryStatusAction}
                submitLabel="Update status"
                className="mt-5 space-y-4"
              >
                <input
                  type="hidden"
                  name="inquiryPublicId"
                  value={inquiry.publicId}
                />
                <input
                  type="hidden"
                  name="expectedUpdatedAt"
                  value={inquiry.updatedAt}
                />
                <label className="block text-sm font-semibold text-strong">
                  Allowed next status
                  <select
                    name="status"
                    defaultValue={transitions[0]}
                    className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                  >
                    {transitions.map((status) => (
                      <option key={status} value={status}>
                        {humanizeCommerceStatus(status)}
                      </option>
                    ))}
                  </select>
                </label>
              </AdminActionForm>
            ) : null}
          </section>

          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h5 text-strong">Linked business records</h2>
            <div className="mt-4 space-y-3 text-sm text-body">
              <p>
                {inquiry.order ? (
                  inquiry.access.canReadOrders ? (
                    <Link
                      href={`/admin/orders/${inquiry.order.publicId}`}
                      className="font-semibold text-sage-700"
                    >
                      Order {inquiry.order.orderNumber}
                    </Link>
                  ) : (
                    `Order ${inquiry.order.orderNumber}`
                  )
                ) : (
                  "No linked order"
                )}
              </p>
              <p>
                {inquiry.product ? (
                  inquiry.access.canReadCatalog ? (
                    <Link
                      href={`/admin/catalog/products/${inquiry.product.publicId}`}
                      className="font-semibold text-sage-700"
                    >
                      Product {inquiry.product.title}
                    </Link>
                  ) : (
                    `Product ${inquiry.product.title}`
                  )
                ) : (
                  "No linked product"
                )}
              </p>
            </div>
          </section>
        </div>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-h4 text-strong">Internal notes</h2>
              <p className="mt-2 text-sm text-muted">
                Notes are visible to authorized administrators only. They are not
                sent to the customer or WhatsApp.
              </p>
            </div>
            <p className="text-caption text-muted">
              {inquiry.notes.length} note{inquiry.notes.length === 1 ? "" : "s"}
            </p>
          </div>

          {inquiry.access.canManage ? (
            <AdminActionForm
              action={addInquiryNoteAction}
              submitLabel="Add internal note"
              className="mt-6 space-y-4"
            >
              <input
                type="hidden"
                name="inquiryPublicId"
                value={inquiry.publicId}
              />
              <label className="block text-sm font-semibold text-strong">
                Note
                <textarea
                  name="body"
                  required
                  minLength={1}
                  maxLength={10_000}
                  rows={5}
                  className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                />
              </label>
            </AdminActionForm>
          ) : null}

          {inquiry.notes.length ? (
            <ul className="mt-8 divide-y divide-line">
              {inquiry.notes.map((note) => (
                <li key={note.publicId} className="py-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-semibold text-strong">
                      {note.author.name} · {note.author.email}
                    </p>
                    <p className="text-xs text-muted">
                      {formatDate(note.createdAt)} UTC
                    </p>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-body">{note.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-6 text-body">No internal notes yet.</p>
          )}
        </section>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <h2 className="text-h4 text-strong">Linked WhatsApp intents</h2>
          <p className="mt-2 max-w-4xl text-sm text-muted">
            These records only establish that click-to-chat was prepared or
            opened. They do not establish message delivery, a reply, or a synced
            conversation. Rendered messages and free-form requirements are not
            exposed here because they are not persisted.
          </p>
          {inquiry.intents.length ? (
            <ul className="mt-6 divide-y divide-line">
              {inquiry.intents.map((intent) => (
                <li key={intent.publicId} className="py-5 text-sm text-body">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-semibold text-strong">
                      {intent.sourceArea} · template {intent.templateKey}
                    </p>
                    <p className="text-xs text-muted">
                      {formatDate(intent.createdAt)} UTC
                    </p>
                  </div>
                  <p className="mt-2 text-muted">
                    {intent.wasOpened
                      ? `Click-to-chat handoff prepared ${formatDate(intent.openedAt)} UTC`
                      : "Intent recorded; handoff preparation is not known"}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    {intent.customer ? `Customer ${intent.customer.name}` : "Anonymous intent"}
                    {intent.order ? ` · Order ${intent.order.orderNumber}` : ""}
                    {intent.product ? ` · Product ${intent.product.title}` : ""}
                    {intent.hasCartContext ? " · Cart context" : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-6 text-body">No WhatsApp intent is linked.</p>
          )}
        </section>
      </div>
    </section>
  );
}
