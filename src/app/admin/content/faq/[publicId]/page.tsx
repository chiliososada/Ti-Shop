import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { updateFaqAction } from "@/app/admin/content/actions";
import { getAdminFaq } from "@/server/admin/content/queries";

export const metadata: Metadata = {
  title: "Edit FAQ",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

export default async function EditAdminFaq({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const faq = await getAdminFaq(publicId);
  if (!faq) notFound();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-5xl">
        <header>
          <Link href="/admin/content" className="text-sm font-semibold text-sage-700">
            ← Content
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">FAQ</p>
          <h1 className="mt-3 text-h2 text-strong">{faq.question}</h1>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted">
            <span>Internal slug: {faq.slug}</span>
            <Link className="font-semibold text-sage-700" href="/faq">View FAQ page</Link>
          </div>
        </header>

        <article className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <AdminActionForm action={updateFaqAction}>
            <input type="hidden" name="publicId" value={faq.publicId} />
            <div className="grid gap-5 md:grid-cols-2">
              <label className={labelClass}>
                Internal slug
                <input className={inputClass} name="slug" defaultValue={faq.slug} required maxLength={220} />
              </label>
              <label className={labelClass}>
                Category
                <input className={inputClass} name="category" defaultValue={faq.category ?? ""} maxLength={160} />
              </label>
              <label className={labelClass}>
                Position
                <input className={inputClass} name="position" type="number" min="0" max="1000000" step="1" defaultValue={faq.position} required />
              </label>
              <label className={labelClass}>
                Status
                <select className={inputClass} name="status" defaultValue={faq.status}>
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </label>
              <label className={labelClass}>
                Publish time (ISO with timezone)
                <input className={inputClass} name="publishedAt" defaultValue={faq.publishedAt ?? ""} placeholder="2026-07-13T12:00:00Z" maxLength={40} />
              </label>
            </div>
            <label className={labelClass}>
              Question
              <textarea className={inputClass} name="question" rows={3} defaultValue={faq.question} required maxLength={500} />
            </label>
            <label className={labelClass}>
              Answer
              <textarea className={inputClass} name="answer" rows={12} defaultValue={faq.answer} required maxLength={100000} />
            </label>
          </AdminActionForm>
        </article>
      </div>
    </section>
  );
}
