import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { CatalogImportForm } from "@/app/admin/catalog/import/CatalogImportForm";
import { requirePermission } from "@/server/auth/rbac";

export const metadata: Metadata = {
  title: "Import catalog CSV",
  robots: { index: false, follow: false },
};

export default async function AdminCatalogImportPage() {
  await connection();
  await requirePermission("catalog.manage", "/admin/catalog/import");

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-4xl">
        <Link href="/admin/catalog" className="text-sm font-semibold text-sage-700">
          ← Catalog administration
        </Link>
        <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">Catalog import</p>
        <h1 className="mt-3 text-h2 text-strong">Validate, then apply CSV updates</h1>
        <p className="mt-4 max-w-3xl text-body">
          This importer updates existing products and variants only. It can update product title/status/publish time, category assignments, variant details/options/MOQ/status, inventory-tracking preference, and the normalized US USD price. It never creates records, changes slugs, deletes omitted records, or stores the uploaded file.
        </p>

        <div className="mt-8 rounded-2xl border border-amber-700/15 bg-amber-50 p-5 text-sm text-amber-950">
          Start with a fresh catalog export. Unknown or moved IDs, duplicate rows, unsafe spreadsheet values, reserved-stock conflicts, and invalid publication states reject the entire file before any write. Apply runs as one database transaction and records only the file hash and aggregate counts in audit/outbox metadata—not CSV contents or price details.
        </div>

        <article className="mt-8 rounded-2xl border border-ink-900/[0.08] bg-surface p-6 sm:p-8">
          <CatalogImportForm />
        </article>
      </div>
    </section>
  );
}
