import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { getAdminNavigationIndex } from "@/server/admin/navigation/queries";

export const metadata: Metadata = {
  title: "Navigation administration",
  robots: { index: false, follow: false },
};

export default async function AdminNavigationIndexPage() {
  await connection();
  const result = await getAdminNavigationIndex();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-8">
        <header>
          <Link href="/admin/content" className="text-sm font-semibold text-sage-700">
            ← Content
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Navigation
          </p>
          <div className="mt-3 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <h1 className="text-h2 text-strong">Navigation administration</h1>
              <p className="mt-3 max-w-3xl text-body">
                Manage named menus such as <code>header</code> and <code>footer</code>.
                This first operational version intentionally supports one level of
                links only—nested menu trees are not edited or rendered.
              </p>
            </div>
            <Link
              href="/admin/content/navigation/new"
              className="shrink-0 rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-white"
            >
              Create navigation
            </Link>
          </div>
        </header>

        {result.truncated ? (
          <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            Only the first 100 named navigations are shown. Consolidate unused
            records before adding more.
          </p>
        ) : null}

        <div className="overflow-x-auto rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="py-3 pr-4">Navigation</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Items</th>
                <th className="py-3 pr-4">Updated</th>
                <th className="py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.navigations.map((navigation) => (
                <tr key={navigation.publicId}>
                  <td className="py-4 pr-4">
                    <p className="font-semibold text-strong">{navigation.name}</p>
                    <p className="mt-1 font-mono text-xs text-muted">{navigation.key}</p>
                  </td>
                  <td className="py-4 pr-4">{navigation.status}</td>
                  <td className="py-4 pr-4">{navigation.itemCount}</td>
                  <td className="py-4 pr-4">
                    {new Date(navigation.updatedAt).toLocaleString("en-US")}
                  </td>
                  <td className="py-4">
                    <Link
                      className="font-semibold text-sage-700"
                      href={`/admin/content/navigation/${navigation.publicId}`}
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!result.navigations.length ? (
            <p className="py-8 text-body">
              No named navigation exists. The storefront continues using its fixed,
              reviewed fallback links.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

