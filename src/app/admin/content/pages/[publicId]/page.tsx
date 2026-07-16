import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { updatePageAction } from "@/app/admin/content/actions";
import { getAdminPage } from "@/server/admin/content/queries";

export const metadata: Metadata = {
  title: "Edit page",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

export default async function EditAdminPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const page = await getAdminPage(publicId);
  if (!page) notFound();

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
          <h1 className="mt-3 text-h2 text-strong">{page.title}</h1>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted">
            <span>/pages/{page.slug}</span>
            <Link className="font-semibold text-sage-700" href={`/pages/${page.slug}`}>
              View storefront
            </Link>
            <Link className="font-semibold text-sage-700" href={`/admin/seo/page/${page.publicId}`}>
              Edit SEO
            </Link>
          </div>
        </header>

        <article className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <AdminActionForm action={updatePageAction}>
            <input type="hidden" name="publicId" value={page.publicId} />
            <div className="grid gap-5 md:grid-cols-2">
              <label className={labelClass}>
                Slug
                <input className={inputClass} name="slug" defaultValue={page.slug} required maxLength={220} />
              </label>
              <label className={labelClass}>
                Title
                <input className={inputClass} name="title" defaultValue={page.title} required maxLength={255} />
              </label>
              <label className={labelClass}>
                Format
                <select className={inputClass} name="format" defaultValue={page.format}>
                  <option value="MARKDOWN">Markdown</option>
                  <option value="RICH_TEXT">Rich text (rendered as safe text)</option>
                  <option value="HTML">HTML source (rendered as safe text)</option>
                </select>
              </label>
              <label className={labelClass}>
                Status
                <select className={inputClass} name="status" defaultValue={page.status}>
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </label>
              <label className={labelClass}>
                Publish time (ISO with timezone)
                <input className={inputClass} name="publishedAt" defaultValue={page.publishedAt ?? ""} placeholder="2026-07-13T12:00:00Z" maxLength={40} />
              </label>
            </div>
            <label className={labelClass}>
              Body
              <textarea className={`${inputClass} font-mono`} name="body" rows={28} defaultValue={page.body} required maxLength={500000} />
            </label>
          </AdminActionForm>
        </article>
      </div>
    </section>
  );
}
