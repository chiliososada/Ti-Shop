import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { createBlogPostAction } from "@/app/admin/content/actions";
import { requirePermission } from "@/server/auth/rbac";

export const metadata: Metadata = {
  title: "Create article",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

export default async function CreateAdminBlogPost() {
  await connection();
  await requirePermission("content.manage", "/admin/content/blog/new");

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-5xl">
        <header>
          <Link
            href="/admin/content"
            className="text-sm font-semibold text-sage-700"
          >
            ← Content
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Blog article
          </p>
          <h1 className="mt-3 text-h2 text-strong">Create article</h1>
          <p className="mt-3 text-body">
            Articles start as drafts by default. The slug becomes protected after
            creation; SEO metadata can then be managed from the article editor.
          </p>
        </header>

        <article className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <AdminActionForm
            action={createBlogPostAction}
            submitLabel="Create article"
          >
            <div className="grid gap-5 md:grid-cols-2">
              <label className={labelClass}>
                Slug
                <input
                  className={inputClass}
                  name="slug"
                  required
                  maxLength={220}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  placeholder="research-procurement-guide"
                />
              </label>
              <label className={labelClass}>
                Title
                <input
                  className={inputClass}
                  name="title"
                  required
                  maxLength={255}
                />
              </label>
              <label className={labelClass}>
                Category
                <input className={inputClass} name="category" maxLength={160} />
              </label>
              <label className={labelClass}>
                Author display name
                <input
                  className={inputClass}
                  name="authorDisplayName"
                  maxLength={255}
                />
              </label>
              <label className={labelClass}>
                Reading time (minutes)
                <input
                  className={inputClass}
                  name="readingMinutes"
                  type="number"
                  min="1"
                  max="1000"
                  step="1"
                />
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
                <input
                  className={inputClass}
                  name="publishedAt"
                  placeholder="2026-07-13T12:00:00Z"
                  maxLength={40}
                />
              </label>
            </div>
            <label className={labelClass}>
              Excerpt
              <textarea
                className={inputClass}
                name="excerpt"
                rows={5}
                maxLength={10_000}
              />
            </label>
            <label className={labelClass}>
              Body
              <textarea
                className={`${inputClass} font-mono`}
                name="body"
                rows={28}
                required
                maxLength={500_000}
              />
            </label>
          </AdminActionForm>
        </article>
      </div>
    </section>
  );
}
