import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { createNavigationAction } from "@/app/admin/content/navigation/actions";
import { requirePermission } from "@/server/auth/rbac";

export const metadata: Metadata = {
  title: "Create navigation",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

export default async function CreateAdminNavigationPage() {
  await connection();
  await requirePermission("content.manage", "/admin/content/navigation/new");

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-4xl">
        <header>
          <Link
            href="/admin/content/navigation"
            className="text-sm font-semibold text-sage-700"
          >
            ← Navigation
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Named menu
          </p>
          <h1 className="mt-3 text-h2 text-strong">Create navigation</h1>
          <p className="mt-3 max-w-3xl text-body">
            Use the exact keys <code>header</code> or <code>footer</code> to replace
            the corresponding reviewed fallback after publishing at least one safe,
            visible first-level link.
          </p>
        </header>

        <article className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <AdminActionForm action={createNavigationAction} submitLabel="Create navigation">
            <input type="hidden" name="submissionId" value={randomUUID()} />
            <div className="grid gap-5 md:grid-cols-2">
              <label className={labelClass}>
                Key
                <input
                  className={inputClass}
                  name="key"
                  required
                  maxLength={100}
                  placeholder="header"
                />
              </label>
              <label className={labelClass}>
                Administrative name
                <input
                  className={inputClass}
                  name="name"
                  required
                  maxLength={160}
                  placeholder="Primary header navigation"
                />
              </label>
              <label className={labelClass}>
                Status
                <select className={inputClass} name="status" defaultValue="DRAFT">
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </label>
            </div>
          </AdminActionForm>
        </article>
      </div>
    </section>
  );
}

