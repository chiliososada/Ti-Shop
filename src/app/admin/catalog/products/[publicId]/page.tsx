import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import {
  createProductMediaAction,
  createVariantAction,
  detachProductMediaAction,
  updateProductAction,
  updateProductCategoriesAction,
  updateProductMediaAction,
  updateVariantAction,
} from "@/app/admin/catalog/actions";
import { updateProductTagsAction } from "@/app/admin/catalog/organization/actions";
import { getAdminProduct } from "@/server/admin/catalog/queries";

import { ProductImageManager } from "./ProductImageManager";

export const metadata: Metadata = {
  title: "Edit product",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

function VariantFields({
  variant,
}: {
  variant?: {
    publicId: string;
    title: string;
    sku: string | null;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
    priceMode: "FIXED" | "ON_REQUEST";
    usdPrice: string;
    minimumOrderQuantity: number;
    position: number;
    publishedAt: string | null;
    trackInventory: boolean;
    optionValues: string;
  };
}) {
  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        <label className={labelClass}>Variant title<input className={inputClass} name="title" required maxLength={255} defaultValue={variant?.title ?? "Default"} /></label>
        <label className={labelClass}>SKU<input className={inputClass} name="sku" maxLength={120} defaultValue={variant?.sku ?? ""} placeholder="OPTIONAL-SKU" /></label>
        <label className={labelClass}>Status<select className={inputClass} name="status" defaultValue={variant?.status ?? "DRAFT"}><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived (soft delete)</option></select></label>
        <label className={labelClass}>Publish time (ISO with timezone)<input className={inputClass} name="publishedAt" defaultValue={variant?.publishedAt ?? ""} placeholder="2026-07-13T12:00:00Z" maxLength={40} /></label>
        <label className={labelClass}>Price mode<select className={inputClass} name="priceMode" defaultValue={variant?.priceMode ?? "ON_REQUEST"}><option value="FIXED">Fixed USD price</option><option value="ON_REQUEST">Price on request</option></select></label>
        <label className={labelClass}>USD amount<input className={inputClass} name="usdPrice" inputMode="decimal" defaultValue={variant?.usdPrice ?? ""} placeholder="125.00" maxLength={64} /><span className="mt-2 block text-xs font-normal text-muted">Clear for on-request pricing. Amounts are stored as exact integer cents.</span></label>
        <label className={labelClass}>Minimum order quantity<input className={inputClass} name="minimumOrderQuantity" type="number" min="1" max="99" step="1" defaultValue={variant?.minimumOrderQuantity ?? 1} required /><span className="mt-2 block text-xs font-normal text-muted">Stored in the variant&apos;s structured option data and enforced again from the database during checkout.</span></label>
        <label className={labelClass}>Position<input className={inputClass} name="position" type="number" min="0" max="1000000" step="1" defaultValue={variant?.position ?? 0} required /></label>
      </div>
      <label className={labelClass}>Option values JSON<textarea className={`${inputClass} font-mono`} name="optionValues" rows={6} maxLength={10000} defaultValue={variant?.optionValues ?? "{}"} /><span className="mt-2 block text-xs font-normal text-muted">Flat JSON object only. Values may be text, number, true/false, or null.</span></label>
      <label className="flex items-center gap-3 text-sm font-semibold text-strong"><input type="checkbox" name="trackInventory" defaultChecked={variant?.trackInventory ?? true} /> Track inventory</label>
    </>
  );
}

export default async function AdminProductPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const product = await getAdminProduct(publicId);
  if (!product) notFound();
  const assignedIds = product.assignedCategories.map(({ publicId: id }) => id);
  const assignedTagIds = product.assignedTags.map(({ publicId: id }) => id);

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-12">
        <header>
          <Link href="/admin/catalog" className="text-sm font-semibold text-sage-700">← Catalog</Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">Product</p>
          <h1 className="mt-3 text-h2 text-strong">{product.title}</h1>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted">
            <span>Protected legacy-safe slug: /{product.slug}</span>
            <Link className="font-semibold text-sage-700" href={`/products/${product.slug}`}>View storefront</Link>
            <Link className="font-semibold text-sage-700" href={`/admin/seo/product/${product.publicId}`}>Edit SEO</Link>
          </div>
        </header>

        <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <h2 className="text-h4 text-strong">Core product details</h2>
          <p className="mt-2 text-sm text-muted">Choose Archived to soft-delete a product. Its identity and historical order links remain intact.</p>
          <AdminActionForm action={updateProductAction} className="mt-7 space-y-6">
            <input type="hidden" name="publicId" value={product.publicId} />
            <div className="grid gap-5 md:grid-cols-2">
              <label className={labelClass}>Title<input className={inputClass} name="title" defaultValue={product.title} required maxLength={255} /></label>
              <label className={labelClass}>Subtitle<input className={inputClass} name="subtitle" defaultValue={product.subtitle ?? ""} maxLength={255} /></label>
              <label className={labelClass}>Brand<input className={inputClass} name="brand" defaultValue={product.brand ?? ""} maxLength={160} /></label>
              <label className={labelClass}>Purity<input className={inputClass} name="purity" defaultValue={product.purity ?? ""} maxLength={80} /></label>
              <label className={labelClass}>CAS number<input className={inputClass} name="casNumber" defaultValue={product.casNumber ?? ""} maxLength={160} /></label>
              <label className={labelClass}>Position<input className={inputClass} name="position" type="number" min="0" max="1000000" step="1" defaultValue={product.position} required /></label>
              <label className={labelClass}>Status<select className={inputClass} name="status" defaultValue={product.status}><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived (soft delete)</option></select></label>
              <label className={labelClass}>Publish time (ISO with timezone)<input className={inputClass} name="publishedAt" defaultValue={product.publishedAt ?? ""} placeholder="2026-07-13T12:00:00Z" maxLength={40} /></label>
            </div>
            <label className={labelClass}>Short description<textarea className={inputClass} name="shortDescription" rows={4} defaultValue={product.shortDescription ?? ""} maxLength={10000} /></label>
            <label className={labelClass}>Description<textarea className={inputClass} name="description" rows={10} defaultValue={product.description ?? ""} maxLength={100000} /></label>
            <label className={labelClass}>Appearance<textarea className={inputClass} name="appearance" rows={4} defaultValue={product.appearance ?? ""} maxLength={10000} /></label>
            <label className={labelClass}>Storage instructions<textarea className={inputClass} name="storageInstructions" rows={4} defaultValue={product.storageInstructions ?? ""} maxLength={10000} /></label>
            <label className="flex items-center gap-3 text-sm font-semibold text-strong"><input type="checkbox" name="isFeatured" defaultChecked={product.isFeatured} /> Featured product</label>
          </AdminActionForm>
        </article>

        <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <h2 className="text-h4 text-strong">Category assignments</h2>
          <p className="mt-2 text-sm text-muted">Select any number of categories. When categories are selected, one must be explicitly marked primary.</p>
          <AdminActionForm action={updateProductCategoriesAction} className="mt-7 space-y-6" submitLabel="Save category assignments">
            <input type="hidden" name="productPublicId" value={product.publicId} />
            <div className="grid gap-5 md:grid-cols-2">
              <label className={labelClass}>Assigned categories<select className={`${inputClass} min-h-52`} name="categoryPublicIds" multiple defaultValue={assignedIds}>{product.availableCategories.map((category) => <option key={category.publicId} value={category.publicId}>{category.name} · {category.status}</option>)}</select><span className="mt-2 block text-xs font-normal text-muted">Use Ctrl/Command to select multiple values.</span></label>
              <label className={labelClass}>Primary category<select className={inputClass} name="primaryCategoryPublicId" defaultValue={product.primaryCategoryPublicId ?? ""}><option value="">No primary category</option>{product.availableCategories.map((category) => <option key={category.publicId} value={category.publicId}>{category.name}</option>)}</select></label>
            </div>
          </AdminActionForm>
        </article>

        <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-h4 text-strong">Tag assignments</h2>
              <p className="mt-2 text-sm text-muted">
                Active tags appear on the published product page. Archived tags
                cannot be newly assigned and are removed when this form is saved.
              </p>
            </div>
            <Link
              href="/admin/catalog/organization"
              className="text-sm font-semibold text-sage-700"
            >
              Manage tag definitions
            </Link>
          </div>
          <AdminActionForm
            action={updateProductTagsAction}
            className="mt-7 space-y-6"
            submitLabel="Save tag assignments"
          >
            <input type="hidden" name="productPublicId" value={product.publicId} />
            <label className={labelClass}>
              Assigned tags
              <select
                className={`${inputClass} min-h-52`}
                name="tagPublicIds"
                multiple
                defaultValue={assignedTagIds}
              >
                {product.availableTags.map((tag) => (
                  <option
                    key={tag.publicId}
                    value={tag.publicId}
                    disabled={tag.status === "ARCHIVED"}
                  >
                    {tag.name} · {tag.status}
                  </option>
                ))}
              </select>
              <span className="mt-2 block text-xs font-normal text-muted">
                Use Ctrl/Command to select multiple values. Saving an empty
                selection removes all tag assignments.
              </span>
            </label>
            {product.availableTagsTruncated ? (
              <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
                The selector shows the first 200 tag definitions plus every tag
                already assigned to this product. Consolidate unused tags before
                assigning a tag outside this bounded list.
              </p>
            ) : null}
          </AdminActionForm>
        </article>

        <section>
          <h2 className="text-h3 text-strong">Variants ({product.variants.length})</h2>
          <p className="mt-2 text-body">Variant writes update identity, publishing, inventory mode, structured options, MOQ, and exact US/USD pricing together.</p>

          <article className="mt-6 rounded-2xl border border-dashed border-sage-700/30 bg-surface p-6">
            <h3 className="text-h5 text-strong">Create variant</h3>
            <AdminActionForm action={createVariantAction} className="mt-6 space-y-6" submitLabel="Create variant">
              <input type="hidden" name="productPublicId" value={product.publicId} />
              <VariantFields />
            </AdminActionForm>
          </article>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            {product.variants.map((variant) => (
              <article key={variant.publicId} className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
                <h3 className="text-h5 text-strong">{variant.title}</h3>
                <p className="mt-1 font-mono text-xs text-muted">{variant.publicId}</p>
                <AdminActionForm action={updateVariantAction} className="mt-6 space-y-6" submitLabel="Save variant">
                  <input type="hidden" name="productPublicId" value={product.publicId} />
                  <input type="hidden" name="variantPublicId" value={variant.publicId} />
                  <VariantFields variant={variant} />
                </AdminActionForm>
              </article>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-h3 text-strong">Product images ({product.images.length})</h2>
          <p className="mt-3 text-sm text-muted">
            Uploaded images are stored in object storage, re-encoded to WebP
            renditions, and served on every storefront surface. The first image
            with the primary badge is the product&apos;s main image.
          </p>
          <div className="mt-6">
            <ProductImageManager
              productPublicId={product.publicId}
              initialImages={product.images}
              storage={product.storage}
            />
          </div>
        </section>

        <section>
          <h2 className="text-h3 text-strong">Legacy media references ({product.media.length})</h2>
          <div className="mt-3 rounded-xl border border-amber-700/20 bg-amber-50 px-5 py-4 text-sm text-amber-900">
            This section links an existing file under <code>/public</code>, a strict public HTTPS URL, or an existing media record — kept for the imported legacy catalog and non-image media (videos, documents). Use the uploader above for product photos.
          </div>

          <article className="mt-6 rounded-2xl border border-dashed border-sage-700/30 bg-surface p-6">
            <h3 className="text-h5 text-strong">Attach media</h3>
            <AdminActionForm action={createProductMediaAction} className="mt-6 space-y-6" submitLabel="Attach media reference">
              <input type="hidden" name="productPublicId" value={product.publicId} />
              <div className="grid gap-5 md:grid-cols-2">
                <label className={labelClass}>Existing media<select className={inputClass} name="existingMediaPublicId" defaultValue=""><option value="">Enter a new source below</option>{product.mediaLibrary.map((media) => <option key={media.publicId} value={media.publicId}>{media.kind} · {media.altText ?? media.publicUrl}</option>)}</select></label>
                <label className={labelClass}>New source path or URL<input className={inputClass} name="sourceUrl" maxLength={2048} placeholder="/products/example.jpg or https://cdn.example.com/image.jpg" /><span className="mt-2 block text-xs font-normal text-muted">Leave empty when choosing existing media. Protocol-relative, private-network, data, file, JavaScript, traversal, and missing local paths are rejected.</span></label>
                <label className={labelClass}>Kind<select className={inputClass} name="kind" defaultValue="IMAGE"><option value="IMAGE">Image</option><option value="VIDEO">Video</option><option value="DOCUMENT">Document</option></select></label>
                <label className={labelClass}>Role<select className={inputClass} name="role" defaultValue="GALLERY"><option value="PRIMARY">Primary image</option><option value="GALLERY">Gallery image</option><option value="SWATCH">Swatch image</option><option value="VIDEO">Video</option><option value="DOCUMENT">Document</option></select></label>
                <label className={labelClass}>Variant (optional)<select className={inputClass} name="variantPublicId" defaultValue=""><option value="">Product-level media</option>{product.variants.map((variant) => <option key={variant.publicId} value={variant.publicId}>{variant.title}{variant.sku ? ` · ${variant.sku}` : ""}</option>)}</select></label>
                <label className={labelClass}>Position<input className={inputClass} name="position" type="number" min="0" max="1000000" step="1" defaultValue="0" required /></label>
              </div>
              <label className={labelClass}>Alt text<input className={inputClass} name="altText" maxLength={500} /></label>
            </AdminActionForm>
          </article>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            {product.media.map((media) => (
              <article key={media.mediaPublicId} className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h3 className="text-h5 text-strong">{media.altText ?? "Untitled media"}</h3><p className="mt-1 text-xs text-muted">{media.kind} · {media.role}{media.variantTitle ? ` · ${media.variantTitle}` : ""}</p></div>
                  <a href={media.sourceUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-sage-700">Open source</a>
                </div>
                <p className="mt-3 break-all font-mono text-xs text-muted">{media.sourceUrl}</p>
                <AdminActionForm action={updateProductMediaAction} className="mt-6 space-y-5" submitLabel="Save media placement">
                  <input type="hidden" name="productPublicId" value={product.publicId} />
                  <input type="hidden" name="mediaPublicId" value={media.mediaPublicId} />
                  <label className={labelClass}>Alt text<input className={inputClass} name="altText" defaultValue={media.altText ?? ""} maxLength={500} /><span className="mt-2 block text-xs font-normal text-muted">Alt text belongs to the shared media asset and can affect other references to the same asset.</span></label>
                  <div className="grid gap-5 md:grid-cols-2">
                    <label className={labelClass}>Role<select className={inputClass} name="role" defaultValue={media.role}><option value="PRIMARY">Primary image</option><option value="GALLERY">Gallery image</option><option value="SWATCH">Swatch image</option><option value="VIDEO">Video</option><option value="DOCUMENT">Document</option></select></label>
                    <label className={labelClass}>Position<input className={inputClass} name="position" type="number" min="0" max="1000000" step="1" defaultValue={media.position} required /></label>
                    <label className={labelClass}>Variant<select className={inputClass} name="variantPublicId" defaultValue={media.variantPublicId ?? ""}><option value="">Product-level media</option>{product.variants.map((variant) => <option key={variant.publicId} value={variant.publicId}>{variant.title}</option>)}</select></label>
                  </div>
                </AdminActionForm>
                <div className="mt-6 border-t border-line pt-6">
                  <AdminActionForm action={detachProductMediaAction} className="space-y-4" submitLabel="Detach media (asset stays preserved)">
                    <input type="hidden" name="productPublicId" value={product.publicId} />
                    <input type="hidden" name="mediaPublicId" value={media.mediaPublicId} />
                  </AdminActionForm>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
