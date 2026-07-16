import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { getAdminManagedPageIndex } from "@/server/admin/content/managed-page-queries";

export const metadata: Metadata = {
  title: "Managed storefront pages",
  robots: { index: false, follow: false },
};

export default async function AdminManagedPagesIndex() {
  await connection();
  const pages = await getAdminManagedPageIndex();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header>
          <Link
            href="/admin/content"
            className="text-sm font-semibold text-sage-700"
          >
            ← Content
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Fixed storefront routes
          </p>
          <h1 className="mt-3 text-h2 text-strong">
            Managed policy and information pages
          </h1>
          <p className="mt-3 max-w-3xl text-body">
            Edit reviewed content without changing established public URLs. A
            missing, draft, archived, future-dated, empty, or unsafe record
            keeps the current hard-coded page as its safe fallback.
          </p>
        </header>

        <aside className="rounded-2xl border border-amber-700/20 bg-amber-50 p-5 text-sm leading-relaxed text-amber-950">
          These public fields are not a secret vault. Never enter payment API or
          IPN keys, bank or Zelle destinations, account numbers, wallet
          addresses, passwords, tokens, private keys, recovery phrases, email
          addresses, phone numbers, or customer information. Required
          research-use and payment-verification notices remain visible outside
          the editable body.
        </aside>

        <div className="overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="py-3 pr-4">Route</th>
                <th className="py-3 pr-4">Current source</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">SEO</th>
                <th className="py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {pages.map((page) => (
                <tr key={page.routeKey}>
                  <td className="py-4 pr-4">
                    <p className="font-semibold text-strong">{page.label}</p>
                    <p className="mt-1 font-mono text-xs text-muted">
                      {page.path}
                    </p>
                  </td>
                  <td className="py-4 pr-4">
                    {page.configured ? "Managed record" : "Hard-coded fallback"}
                  </td>
                  <td className="py-4 pr-4">{page.status}</td>
                  <td className="py-4 pr-4">
                    {page.seoConfigured ? "Configured" : "Route default"}
                  </td>
                  <td className="py-4">
                    <Link
                      className="font-semibold text-sage-700"
                      href={`/admin/content/managed-pages/${page.adminSlug}`}
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-sm leading-relaxed text-muted">
          Contact remains a purpose-built communication page, and FAQ remains
          an ordered collection of FAQ records. They are intentionally not
          included in this free-text page editor.
        </p>
      </div>
    </section>
  );
}
