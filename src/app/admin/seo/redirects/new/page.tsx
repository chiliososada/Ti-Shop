import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { createRedirectAction } from "@/app/admin/seo/actions";
import { requirePermission } from "@/server/auth/rbac";

export const metadata: Metadata = {
  title: "Create redirect",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

export default async function CreateRedirectPage() {
  await connection();
  await requirePermission("seo.manage", "/admin/seo/redirects/new");

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-4xl">
        <header>
          <Link href="/admin/seo" className="text-sm font-semibold text-sage-700">← SEO</Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">Permanent redirect</p>
          <h1 className="mt-3 text-h2 text-strong">Create redirect</h1>
          <p className="mt-3 text-body">
            Use root-relative public paths only. Private, API, account, checkout,
            admin, static, self-referential, and circular sources are rejected.
          </p>
        </header>

        <article className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <AdminActionForm action={createRedirectAction} submitLabel="Create redirect">
            <div className="grid gap-5 md:grid-cols-2">
              <label className={labelClass}>
                Source path
                <input className={inputClass} name="sourcePath" required maxLength={2048} placeholder="/old-page" />
              </label>
              <label className={labelClass}>
                Destination path
                <input className={inputClass} name="destinationPath" required maxLength={2048} placeholder="/pages/new-page" />
              </label>
              <label className={labelClass}>
                Permanent status
                <select className={inputClass} name="statusCode" defaultValue="308">
                  <option value="308">308 Permanent Redirect</option>
                  <option value="301">301 Moved Permanently</option>
                </select>
              </label>
              <label className={labelClass}>
                Start time (optional ISO with timezone)
                <input className={inputClass} name="startsAt" maxLength={40} placeholder="2026-07-13T12:00:00Z" />
              </label>
              <label className={labelClass}>
                End time (optional ISO with timezone)
                <input className={inputClass} name="endsAt" maxLength={40} placeholder="2027-07-13T12:00:00Z" />
              </label>
            </div>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-3 text-sm font-semibold text-strong">
                <input type="checkbox" name="preserveQuery" defaultChecked /> Preserve incoming query string
              </label>
              <label className="flex items-center gap-3 text-sm font-semibold text-strong">
                <input type="checkbox" name="isActive" defaultChecked /> Active
              </label>
            </div>
          </AdminActionForm>
        </article>
      </div>
    </section>
  );
}
