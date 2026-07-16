import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { updateCategoryAction } from "@/app/admin/catalog/actions";
import { getAdminCategory } from "@/server/admin/catalog/queries";

export const metadata: Metadata = {
  title: "Edit category",
  robots: { index: false, follow: false },
};

const inputClass = "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

export default async function AdminCategoryPage({ params }: { params: Promise<{ publicId: string }> }) {
  await connection();
  const { publicId } = await params;
  const category = await getAdminCategory(publicId);
  if (!category) notFound();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-4xl">
        <header>
          <Link href="/admin/catalog" className="text-sm font-semibold text-sage-700">← Catalog</Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">Category</p>
          <h1 className="mt-3 text-h2 text-strong">{category.name}</h1>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted"><span>Protected legacy-safe slug: /{category.slug}</span><span>{category.productCount} assigned products</span><Link className="font-semibold text-sage-700" href={`/categories/${category.slug}`}>View storefront</Link><Link className="font-semibold text-sage-700" href={`/admin/seo/category/${category.publicId}`}>Edit SEO</Link></div>
        </header>

        <article className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <AdminActionForm action={updateCategoryAction}>
            <input type="hidden" name="publicId" value={category.publicId} />
            <label className={labelClass}>Name<input className={inputClass} name="name" defaultValue={category.name} required maxLength={255} /></label>
            <label className={labelClass}>Description<textarea className={inputClass} name="description" rows={8} defaultValue={category.description ?? ""} maxLength={20000} /></label>
            <div className="grid gap-5 md:grid-cols-2">
              <label className={labelClass}>Status<select className={inputClass} name="status" defaultValue={category.status}><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived (soft delete)</option></select></label>
              <label className={labelClass}>Position<input className={inputClass} name="position" type="number" min="0" max="1000000" step="1" defaultValue={category.position} required /></label>
              <label className={labelClass}>Publish time (ISO with timezone)<input className={inputClass} name="publishedAt" defaultValue={category.publishedAt ?? ""} placeholder="2026-07-13T12:00:00Z" maxLength={40} /></label>
            </div>
          </AdminActionForm>
        </article>

        <article className="mt-8 rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <h2 className="text-h4 text-strong">Assigned products</h2>
          <p className="mt-2 text-sm text-muted">Assignments and primary-category selection are edited from each product.</p>
          {category.products.length ? (
            <ul className="mt-5 divide-y divide-line">
              {category.products.map((product) => (
                <li key={product.publicId} className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
                  <span><span className="font-semibold text-strong">{product.title}</span><span className="ml-2 text-muted">{product.status}</span></span>
                  <Link className="font-semibold text-sage-700" href={`/admin/catalog/products/${product.publicId}`}>Edit product</Link>
                </li>
              ))}
            </ul>
          ) : <p className="mt-5 text-body">No products are assigned.</p>}
        </article>
      </div>
    </section>
  );
}
