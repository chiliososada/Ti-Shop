import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { saveManagedPageAction } from "@/app/admin/content/managed-pages/actions";
import { getAdminManagedPage } from "@/server/admin/content/managed-page-queries";

export const metadata: Metadata = {
  title: "Edit managed storefront page",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

export default async function EditManagedPage({
  params,
}: {
  params: Promise<{ adminSlug: string }>;
}) {
  await connection();
  const { adminSlug } = await params;
  const record = await getAdminManagedPage(adminSlug);
  if (!record) notFound();
  const { definition, page } = record;

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-5xl">
        <header>
          <Link
            href="/admin/content/managed-pages"
            className="text-sm font-semibold text-sage-700"
          >
            ← Managed pages
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Fixed storefront route
          </p>
          <h1 className="mt-3 text-h2 text-strong">{definition.label}</h1>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted">
            <span className="font-mono">{definition.path}</span>
            <Link
              className="font-semibold text-sage-700"
              href={definition.path}
            >
              View storefront
            </Link>
            {page ? (
              <Link
                className="font-semibold text-sage-700"
                href={`/admin/seo/page/${page.publicId}`}
              >
                Edit canonical, Open Graph, and noindex
              </Link>
            ) : null}
          </div>
          <p className="mt-4 max-w-3xl text-body">
            {page
              ? "Only a currently published, non-empty, safe record replaces the hard-coded body."
              : "No managed record exists yet. The current hard-coded page remains public until a reviewed record is published."}
          </p>
        </header>

        <aside className="mt-8 rounded-2xl border border-amber-700/20 bg-amber-50 p-5 text-sm leading-relaxed text-amber-950">
          Do not enter scripts or HTML. Do not place payment secrets, NOWPayments
          keys, bank or Zelle destinations, financial account details, wallet
          addresses, passwords, tokens, private keys, recovery phrases, email
          addresses, phone numbers, or customer data in this public content.
          The fixed compliance notice shown below the managed body cannot be
          removed through this editor.
        </aside>

        <article className="mt-8 rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <AdminActionForm
            action={saveManagedPageAction}
            submitLabel={page ? "Save managed page" : "Create managed page"}
          >
            <input
              type="hidden"
              name="routeKey"
              value={definition.routeKey}
            />
            <div className="grid gap-5 md:grid-cols-2">
              <label className={labelClass}>
                Public title
                <input
                  className={inputClass}
                  name="title"
                  defaultValue={page?.title ?? definition.fallbackTitle}
                  required
                  maxLength={255}
                />
              </label>
              <label className={labelClass}>
                Status
                <select
                  className={inputClass}
                  name="status"
                  defaultValue={page?.status ?? "DRAFT"}
                >
                  <option value="DRAFT">Draft — use hard-coded fallback</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">
                    Archived — use hard-coded fallback
                  </option>
                </select>
              </label>
              <label className={labelClass}>
                Publish time (ISO with timezone)
                <input
                  className={inputClass}
                  name="publishedAt"
                  defaultValue={page?.publishedAt ?? ""}
                  placeholder="2026-07-13T12:00:00Z"
                  maxLength={40}
                />
              </label>
              <div className="rounded-xl bg-surface-warm px-4 py-3 text-sm text-muted">
                Canonical route: <strong>{definition.path}</strong>. Managed SEO
                cannot move this fixed page to another canonical URL.
              </div>
            </div>
            <label className={labelClass}>
              Public body
              <textarea
                className={`${inputClass} font-mono`}
                name="body"
                rows={28}
                defaultValue={page?.body ?? ""}
                required
                maxLength={100000}
                placeholder={
                  "## Reviewed heading\n\nPlain-text paragraph.\n\n- Safe list item"
                }
              />
              <span className="mt-2 block text-xs font-normal text-muted">
                Safe subset only: plain paragraphs, ## or ### headings, and - or
                * list items. HTML and angle brackets are rejected.
              </span>
            </label>
          </AdminActionForm>
        </article>
      </div>
    </section>
  );
}
