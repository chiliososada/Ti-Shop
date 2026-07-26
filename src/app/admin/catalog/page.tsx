import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import {
  createCategoryAction,
  createProductAction,
} from "@/app/admin/catalog/actions";
import { PaginationNav } from "@/components/PaginationNav";
import { buildQueryHref, type SearchParameter } from "@/lib/pagination";
import type { AdminCatalogFilters } from "@/server/admin/catalog/filters";
import { getAdminCatalogIndex } from "@/server/admin/catalog/queries";
import { DISPLAY_TIME_ZONE } from "@/lib/display-timezone";

export const metadata: Metadata = {
  title: "Catalog administration",
  robots: { index: false, follow: false },
};

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString("en-US", { timeZone: DISPLAY_TIME_ZONE }) : "Not published";
}

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

function adminCatalogHref(
  filters: AdminCatalogFilters,
  overrides: Partial<AdminCatalogFilters> = {},
) {
  const next = { ...filters, ...overrides };
  return buildQueryHref("/admin/catalog", {
    categoryPage: next.categoryPage > 1 ? next.categoryPage : undefined,
    categoryQ: next.categoryQuery || undefined,
    productPage: next.productPage > 1 ? next.productPage : undefined,
    productQ: next.productQuery || undefined,
  });
}

export default async function AdminCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const catalog = await getAdminCatalogIndex(await searchParams);

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header>
          <Link href="/admin" className="text-sm font-semibold text-sage-700">
            ← Administration
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">Catalog</p>
          <h1 className="mt-3 text-h2 text-strong">Products and categories</h1>
          <p className="mt-3 max-w-3xl text-body">
            Create and maintain products, variants, categories, pricing, and media associations. Existing slugs stay protected.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/admin/catalog/organization"
              className="inline-flex rounded-full border border-ink-900/15 px-5 py-2.5 text-sm font-semibold text-strong"
            >
              Manage tags &amp; merchandising
            </Link>
            <Link
              href="/admin/catalog/export"
              className="inline-flex rounded-full border border-ink-900/15 px-5 py-2.5 text-sm font-semibold text-strong"
            >
              Export catalog CSV
            </Link>
            <Link
              href="/admin/catalog/import"
              className="inline-flex rounded-full border border-ink-900/15 px-5 py-2.5 text-sm font-semibold text-strong"
            >
              Import catalog CSV
            </Link>
          </div>
          {catalog.validationError ? (
            <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">
              One or more catalog filters were invalid, so safe defaults were used.
            </p>
          ) : null}
        </header>

        <section className="grid gap-6 lg:grid-cols-2">
          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h4 text-strong">Create product</h2>
            <p className="mt-2 text-sm text-muted">
              New products start as drafts. Add an active variant before publishing.
            </p>
            <AdminActionForm action={createProductAction} className="mt-6 space-y-5" submitLabel="Create draft product">
              <label className={labelClass}>Title<input className={inputClass} name="title" required maxLength={255} /></label>
              <label className={labelClass}>Slug<input className={inputClass} name="slug" required maxLength={220} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="new-product" /><span className="mt-2 block text-xs font-normal text-muted">Lowercase letters, numbers, and single hyphens. A used slug is never silently reassigned.</span></label>
              <label className={labelClass}>Position<input className={inputClass} name="position" type="number" min="0" max="1000000" step="1" defaultValue="0" required /></label>
            </AdminActionForm>
          </article>

          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h4 text-strong">Create category</h2>
            <p className="mt-2 text-sm text-muted">New categories start as drafts and can be assigned immediately.</p>
            <AdminActionForm action={createCategoryAction} className="mt-6 space-y-5" submitLabel="Create draft category">
              <label className={labelClass}>Name<input className={inputClass} name="name" required maxLength={255} /></label>
              <label className={labelClass}>Slug<input className={inputClass} name="slug" required maxLength={180} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="new-category" /></label>
              <label className={labelClass}>Position<input className={inputClass} name="position" type="number" min="0" max="1000000" step="1" defaultValue="0" required /></label>
            </AdminActionForm>
          </article>
        </section>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-h4 text-strong">
              Products ({catalog.productPagination.total})
            </h2>
            <p className="text-caption text-muted">
              Page {catalog.productPagination.page} of {catalog.productPagination.pageCount}
            </p>
          </div>
          <form action="/admin/catalog" method="get" className="mt-5 flex flex-wrap items-end gap-3">
            {catalog.filters.categoryQuery ? (
              <input type="hidden" name="categoryQ" value={catalog.filters.categoryQuery} />
            ) : null}
            {catalog.filters.categoryPage > 1 ? (
              <input type="hidden" name="categoryPage" value={catalog.filters.categoryPage} />
            ) : null}
            <label className="min-w-64 flex-1 text-sm font-semibold text-strong">
              Search products
              <input
                className={inputClass}
                name="productQ"
                type="search"
                maxLength={120}
                defaultValue={catalog.filters.productQuery}
                placeholder="Title, slug, brand, or CAS number"
              />
            </label>
            <button type="submit" className="rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-white">
              Search
            </button>
            <Link
              href={adminCatalogHref(catalog.filters, { productQuery: "", productPage: 1 })}
              className="rounded-full border border-ink-900/15 px-5 py-3 text-sm font-semibold text-strong"
            >
              Reset products
            </Link>
          </form>
          {catalog.products.length ? (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-line text-muted">
                <tr><th className="py-3 pr-4">Product</th><th className="py-3 pr-4">Status</th><th className="py-3 pr-4">Variants</th><th className="py-3 pr-4">Published</th><th className="py-3">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {catalog.products.map((product) => (
                  <tr key={product.publicId}>
                    <td className="py-4 pr-4"><p className="font-semibold text-strong">{product.title}</p><p className="mt-1 font-mono text-xs text-muted">/{product.slug}</p></td>
                    <td className="py-4 pr-4">{product.status}</td>
                    <td className="py-4 pr-4">{product.variantCount}</td>
                    <td className="py-4 pr-4">{dateLabel(product.publishedAt)}</td>
                    <td className="py-4"><Link className="font-semibold text-sage-700" href={`/admin/catalog/products/${product.publicId}`}>Edit</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          ) : (
            <p className="mt-6 text-body">No products match this search.</p>
          )}
          <PaginationNav
            page={catalog.productPagination.page}
            pageCount={catalog.productPagination.pageCount}
            previousHref={
              catalog.productPagination.page > 1
                ? adminCatalogHref(catalog.filters, {
                    productPage: catalog.productPagination.page - 1,
                  })
                : null
            }
            nextHref={
              catalog.productPagination.page < catalog.productPagination.pageCount
                ? adminCatalogHref(catalog.filters, {
                    productPage: catalog.productPagination.page + 1,
                  })
                : null
            }
            label="Admin product pagination"
          />
        </section>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-h4 text-strong">
              Categories ({catalog.categoryPagination.total})
            </h2>
            <p className="text-caption text-muted">
              Page {catalog.categoryPagination.page} of {catalog.categoryPagination.pageCount}
            </p>
          </div>
          <form action="/admin/catalog" method="get" className="mt-5 flex flex-wrap items-end gap-3">
            {catalog.filters.productQuery ? (
              <input type="hidden" name="productQ" value={catalog.filters.productQuery} />
            ) : null}
            {catalog.filters.productPage > 1 ? (
              <input type="hidden" name="productPage" value={catalog.filters.productPage} />
            ) : null}
            <label className="min-w-64 flex-1 text-sm font-semibold text-strong">
              Search categories
              <input
                className={inputClass}
                name="categoryQ"
                type="search"
                maxLength={120}
                defaultValue={catalog.filters.categoryQuery}
                placeholder="Category name or slug"
              />
            </label>
            <button type="submit" className="rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-white">
              Search
            </button>
            <Link
              href={adminCatalogHref(catalog.filters, { categoryQuery: "", categoryPage: 1 })}
              className="rounded-full border border-ink-900/15 px-5 py-3 text-sm font-semibold text-strong"
            >
              Reset categories
            </Link>
          </form>
          {catalog.categories.length ? (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-line text-muted"><tr><th className="py-3 pr-4">Category</th><th className="py-3 pr-4">Status</th><th className="py-3 pr-4">Products</th><th className="py-3">Action</th></tr></thead>
              <tbody className="divide-y divide-line">
                {catalog.categories.map((category) => (
                  <tr key={category.publicId}>
                    <td className="py-4 pr-4"><p className="font-semibold text-strong">{category.name}</p><p className="mt-1 font-mono text-xs text-muted">/{category.slug}</p></td>
                    <td className="py-4 pr-4">{category.status}</td>
                    <td className="py-4 pr-4">{category.productCount}</td>
                    <td className="py-4"><Link className="font-semibold text-sage-700" href={`/admin/catalog/categories/${category.publicId}`}>Edit</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          ) : (
            <p className="mt-6 text-body">No categories match this search.</p>
          )}
          <PaginationNav
            page={catalog.categoryPagination.page}
            pageCount={catalog.categoryPagination.pageCount}
            previousHref={
              catalog.categoryPagination.page > 1
                ? adminCatalogHref(catalog.filters, {
                    categoryPage: catalog.categoryPagination.page - 1,
                  })
                : null
            }
            nextHref={
              catalog.categoryPagination.page < catalog.categoryPagination.pageCount
                ? adminCatalogHref(catalog.filters, {
                    categoryPage: catalog.categoryPagination.page + 1,
                  })
                : null
            }
            label="Admin category pagination"
          />
        </section>
      </div>
    </section>
  );
}
