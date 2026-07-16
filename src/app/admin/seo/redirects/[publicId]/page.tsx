import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { updateRedirectAction } from "@/app/admin/seo/actions";
import { getAdminRedirect } from "@/server/admin/seo/queries";

export const metadata: Metadata = {
  title: "Edit redirect",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

export default async function EditRedirectPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const redirect = await getAdminRedirect(publicId);
  if (!redirect) notFound();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-4xl">
        <header>
          <Link href="/admin/seo" className="text-sm font-semibold text-sage-700">← SEO</Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">Permanent redirect</p>
          <h1 className="mt-3 break-all text-h2 text-strong">{redirect.sourcePath}</h1>
          <p className="mt-3 text-sm text-muted">
            Recorded hits: {redirect.hitCount}
            {redirect.lastHitAt ? ` · Last hit ${redirect.lastHitAt}` : " · No recorded hits"}
          </p>
        </header>

        <article className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <AdminActionForm action={updateRedirectAction}>
            <input type="hidden" name="publicId" value={redirect.publicId} />
            <div className="grid gap-5 md:grid-cols-2">
              <label className={labelClass}>
                Source path
                <input className={inputClass} name="sourcePath" defaultValue={redirect.sourcePath} required maxLength={2048} />
              </label>
              <label className={labelClass}>
                Destination path
                <input className={inputClass} name="destinationPath" defaultValue={redirect.destinationPath} required maxLength={2048} />
              </label>
              <label className={labelClass}>
                Permanent status
                <select className={inputClass} name="statusCode" defaultValue={String(redirect.statusCode)}>
                  <option value="308">308 Permanent Redirect</option>
                  <option value="301">301 Moved Permanently</option>
                </select>
              </label>
              <label className={labelClass}>
                Start time (optional ISO with timezone)
                <input className={inputClass} name="startsAt" defaultValue={redirect.startsAt ?? ""} maxLength={40} />
              </label>
              <label className={labelClass}>
                End time (optional ISO with timezone)
                <input className={inputClass} name="endsAt" defaultValue={redirect.endsAt ?? ""} maxLength={40} />
              </label>
            </div>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-3 text-sm font-semibold text-strong">
                <input type="checkbox" name="preserveQuery" defaultChecked={redirect.preserveQuery} /> Preserve incoming query string
              </label>
              <label className="flex items-center gap-3 text-sm font-semibold text-strong">
                <input type="checkbox" name="isActive" defaultChecked={redirect.isActive} /> Active
              </label>
            </div>
          </AdminActionForm>
        </article>
      </div>
    </section>
  );
}
