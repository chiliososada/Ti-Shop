import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { createPageAction } from "@/app/admin/content/actions";
import { requirePermission } from "@/server/auth/rbac";

export const metadata: Metadata = {
  title: "Create page",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

export default async function CreateAdminPage() {
  await connection();
  await requirePermission("content.manage", "/admin/content/pages/new");

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-5xl">
        <header>
          <Link href="/admin/content" className="text-sm font-semibold text-sage-700">
            ← Content
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Standalone page
          </p>
          <h1 className="mt-3 text-h2 text-strong">Create page</h1>
          <p className="mt-3 text-body">
            New pages are served under /pages. Existing legal and policy routes are
            intentionally not replaced by this content.
          </p>
        </header>

        <article className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <AdminActionForm action={createPageAction} submitLabel="Create page">
            <div className="grid gap-5 md:grid-cols-2">
              <label className={labelClass}>
                Slug
                <input className={inputClass} name="slug" required maxLength={220} placeholder="laboratory-procurement" />
              </label>
              <label className={labelClass}>
                Title
                <input className={inputClass} name="title" required maxLength={255} />
              </label>
              <label className={labelClass}>
                Format
                <select className={inputClass} name="format" defaultValue="MARKDOWN">
                  <option value="MARKDOWN">Markdown</option>
                  <option value="RICH_TEXT">Rich text (rendered as safe text)</option>
                  <option value="HTML">HTML source (rendered as safe text)</option>
                </select>
              </label>
              <label className={labelClass}>
                Status
                <select className={inputClass} name="status" defaultValue="DRAFT">
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </label>
              <label className={labelClass}>
                Publish time (ISO with timezone)
                <input className={inputClass} name="publishedAt" placeholder="2026-07-13T12:00:00Z" maxLength={40} />
              </label>
            </div>
            <label className={labelClass}>
              Body
              <textarea className={`${inputClass} font-mono`} name="body" rows={28} required maxLength={500000} />
            </label>
          </AdminActionForm>
        </article>
      </div>
    </section>
  );
}
