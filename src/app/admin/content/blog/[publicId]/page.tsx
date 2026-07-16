import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { updateBlogPostAction } from "@/app/admin/content/actions";
import { getAdminBlogPost } from "@/server/admin/content/queries";

export const metadata: Metadata = {
  title: "Edit article",
  robots: { index: false, follow: false },
};

const inputClass = "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

export default async function AdminBlogPostPage({ params }: { params: Promise<{ publicId: string }> }) {
  await connection();
  const { publicId } = await params;
  const post = await getAdminBlogPost(publicId);
  if (!post) notFound();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-5xl">
        <header>
          <Link href="/admin/content" className="text-sm font-semibold text-sage-700">← Content</Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">Blog article</p>
          <h1 className="mt-3 text-h2 text-strong">{post.title}</h1>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted"><span>Protected slug: /{post.slug}</span><Link className="font-semibold text-sage-700" href={`/blog/${post.slug}`}>View storefront</Link><Link className="font-semibold text-sage-700" href={`/admin/seo/blog/${post.publicId}`}>Edit SEO</Link></div>
        </header>

        <article className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <AdminActionForm action={updateBlogPostAction}>
            <input type="hidden" name="publicId" value={post.publicId} />
            <label className={labelClass}>Title<input className={inputClass} name="title" defaultValue={post.title} required maxLength={255} /></label>
            <div className="grid gap-5 md:grid-cols-2">
              <label className={labelClass}>Category<input className={inputClass} name="category" defaultValue={post.category ?? ""} maxLength={160} /></label>
              <label className={labelClass}>Author display name<input className={inputClass} name="authorDisplayName" defaultValue={post.authorDisplayName ?? ""} maxLength={255} /></label>
              <label className={labelClass}>Reading time (minutes)<input className={inputClass} name="readingMinutes" type="number" min="1" max="1000" step="1" defaultValue={post.readingMinutes ?? ""} /></label>
              <label className={labelClass}>Format<select className={inputClass} name="format" defaultValue={post.format}><option value="MARKDOWN">Markdown</option><option value="RICH_TEXT">Rich text (rendered as safe text)</option><option value="HTML">HTML source (rendered as safe text)</option></select></label>
              <label className={labelClass}>Status<select className={inputClass} name="status" defaultValue={post.status}><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option></select></label>
              <label className={labelClass}>Publish time (ISO with timezone)<input className={inputClass} name="publishedAt" defaultValue={post.publishedAt ?? ""} placeholder="2026-07-13T12:00:00Z" maxLength={40} /></label>
            </div>
            <label className={labelClass}>Excerpt<textarea className={inputClass} name="excerpt" rows={5} defaultValue={post.excerpt ?? ""} maxLength={10000} /></label>
            <label className={labelClass}>Body<textarea className={`${inputClass} font-mono`} name="body" rows={28} defaultValue={post.body} required maxLength={500000} /></label>
          </AdminActionForm>
        </article>
      </div>
    </section>
  );
}
