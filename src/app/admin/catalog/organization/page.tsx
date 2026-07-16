import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import {
  archiveOrDeleteTagAction,
  createPlacementAction,
  createTagAction,
  deletePlacementAction,
  updatePlacementAction,
  updateTagAction,
} from "@/app/admin/catalog/organization/actions";
import { getAdminCatalogOrganization } from "@/server/admin/catalog/organization-queries";
import {
  CORE_MERCHANDISING_MANUAL_POSITION_START,
  CORE_MERCHANDISING_PLACEMENT_KEYS,
} from "@/domain/merchandising";

export const metadata: Metadata = {
  title: "Catalog organization",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";
const CORE_PLACEMENT_KEY_SET = new Set<string>(
  CORE_MERCHANDISING_PLACEMENT_KEYS,
);

function firstFreePosition(positions: readonly number[], start = 0) {
  const used = new Set(positions);
  for (let position = start; position <= 1_000_000; position += 1) {
    if (!used.has(position)) return position;
  }
  return 0;
}

export default async function AdminCatalogOrganizationPage() {
  await connection();
  const catalog = await getAdminCatalogOrganization();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-12">
        <header>
          <Link href="/admin/catalog" className="text-sm font-semibold text-sage-700">
            ← Catalog
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Organization
          </p>
          <h1 className="mt-3 text-h2 text-strong">Tags and merchandising</h1>
          <p className="mt-3 max-w-3xl text-body">
            Maintain product tags and the products shown by existing storefront
            placement keys. Legacy presentation metadata stays read-only, so the
            importer&apos;s three independent placement sets remain intact.
          </p>
        </header>

        <section className="space-y-6">
          <div>
            <h2 className="text-h3 text-strong">Product tags</h2>
            <p className="mt-2 text-body">
              Active tags appear on published product details. A tag still assigned
              to products is archived instead of hard-deleted.
            </p>
          </div>

          <article className="rounded-2xl border border-dashed border-sage-700/30 bg-surface p-6">
            <h3 className="text-h5 text-strong">Create tag</h3>
            <AdminActionForm
              action={createTagAction}
              className="mt-6 space-y-5"
              submitLabel="Create tag"
            >
              <input type="hidden" name="submissionId" value={randomUUID()} />
              <div className="grid gap-5 md:grid-cols-3">
                <label className={labelClass}>
                  Name
                  <input className={inputClass} name="name" required maxLength={160} />
                </label>
                <label className={labelClass}>
                  Slug
                  <input
                    className={inputClass}
                    name="slug"
                    required
                    maxLength={180}
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    placeholder="new-tag"
                  />
                </label>
                <label className={labelClass}>
                  Status
                  <select className={inputClass} name="status" defaultValue="DRAFT">
                    <option value="DRAFT">Draft</option>
                    <option value="ACTIVE">Active</option>
                    <option value="ARCHIVED">Archived</option>
                  </select>
                </label>
              </div>
            </AdminActionForm>
          </article>

          {catalog.tagsTruncated ? (
            <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              Showing the first 200 of {catalog.tagTotal} tags. Consolidate unused
              tags before adding more.
            </p>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-2">
            {catalog.tags.map((tag) => (
              <article
                key={tag.publicId}
                className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-h5 text-strong">{tag.name}</h3>
                    <p className="mt-1 font-mono text-xs text-muted">{tag.publicId}</p>
                  </div>
                  <p className="text-sm text-muted">
                    {tag.productCount} product{tag.productCount === 1 ? "" : "s"}
                  </p>
                </div>
                <AdminActionForm
                  action={updateTagAction}
                  className="mt-6 space-y-5"
                  submitLabel="Save tag"
                >
                  <input type="hidden" name="publicId" value={tag.publicId} />
                  <div className="grid gap-5 md:grid-cols-2">
                    <label className={labelClass}>
                      Name
                      <input
                        className={inputClass}
                        name="name"
                        required
                        maxLength={160}
                        defaultValue={tag.name}
                      />
                    </label>
                    <label className={labelClass}>
                      Slug
                      <input
                        className={inputClass}
                        name="slug"
                        required
                        maxLength={180}
                        pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                        defaultValue={tag.slug}
                      />
                    </label>
                    <label className={labelClass}>
                      Status
                      <select className={inputClass} name="status" defaultValue={tag.status}>
                        <option value="DRAFT">Draft</option>
                        <option value="ACTIVE">Active</option>
                        <option value="ARCHIVED">Archived</option>
                      </select>
                    </label>
                  </div>
                </AdminActionForm>
                <div className="mt-6 border-t border-line pt-6">
                  <AdminActionForm
                    action={archiveOrDeleteTagAction}
                    className="space-y-4"
                    submitLabel={
                      tag.productCount
                        ? "Archive tag and preserve assignments"
                        : "Delete unused tag permanently"
                    }
                  >
                    <input type="hidden" name="publicId" value={tag.publicId} />
                  </AdminActionForm>
                </div>
              </article>
            ))}
          </div>
          {!catalog.tags.length ? (
            <p className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 text-body">
              No tags exist yet.
            </p>
          ) : null}
        </section>

        <section className="space-y-8">
          <div>
            <h2 className="text-h3 text-strong">Merchandising placement sets</h2>
            <p className="mt-2 text-body">
              Add only to an existing managed key. Each product and position is
              unique within its key. Moving onto an occupied position swaps the two
              rows atomically; inactive rows stay stored but are excluded from the
              storefront.
            </p>
          </div>

          {catalog.productsTruncated || catalog.placementKeysTruncated || catalog.placementsTruncated ? (
            <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              This view reached a safety display limit. Products: {catalog.productTotal};
              shown placement rows are capped at 1,000 and keys at 100. No hidden row
              was changed.
            </p>
          ) : null}

          {catalog.placementGroups.map((group) => {
            const usedProductIds = new Set(
              group.placements.map(({ product }) => product.publicId),
            );
            const availableProducts = catalog.products.filter(
              (product) => !usedProductIds.has(product.publicId),
            );
            const defaultPosition = firstFreePosition(
              group.placements.map(({ position }) => position),
              CORE_PLACEMENT_KEY_SET.has(group.key)
                ? CORE_MERCHANDISING_MANUAL_POSITION_START
                : 0,
            );
            return (
              <article
                key={group.key}
                className="rounded-2xl border border-ink-900/[0.08] bg-surface p-7"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-h4 text-strong">{group.key}</h3>
                    <p className="mt-2 text-sm text-muted">
                      {group.placements.length} managed placement
                      {group.placements.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="rounded-full bg-sage-50 px-3 py-1 text-xs font-semibold text-sage-800">
                    Existing key only
                  </span>
                </div>

                <div className="mt-6 rounded-xl border border-dashed border-sage-700/30 p-5">
                  <h4 className="text-h5 text-strong">Add product</h4>
                  {availableProducts.length ? (
                    <AdminActionForm
                      action={createPlacementAction}
                      className="mt-5 space-y-5"
                      submitLabel="Add product to placement"
                    >
                      <input type="hidden" name="submissionId" value={randomUUID()} />
                      <input type="hidden" name="placementKey" value={group.key} />
                      <div className="grid gap-5 md:grid-cols-2">
                        <label className={labelClass}>
                          Product
                          <select className={inputClass} name="productPublicId" required defaultValue="">
                            <option value="" disabled>
                              Select a product
                            </option>
                            {availableProducts.map((product) => (
                              <option key={product.publicId} value={product.publicId}>
                                {product.title} · {product.status}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={labelClass}>
                          Unused position
                          <input
                            className={inputClass}
                            name="position"
                            type="number"
                            min="0"
                            max="1000000"
                            step="1"
                            defaultValue={defaultPosition}
                            required
                          />
                        </label>
                      </div>
                      {CORE_PLACEMENT_KEY_SET.has(group.key) ? (
                        <p className="text-xs text-muted">
                          Positions 0–99 are reserved for repeatable legacy imports;
                          manually added products use 100 or higher.
                        </p>
                      ) : null}
                      <label className="flex items-center gap-3 text-sm font-semibold text-strong">
                        <input type="checkbox" name="isActive" defaultChecked /> Active on storefront
                      </label>
                    </AdminActionForm>
                  ) : (
                    <p className="mt-3 text-sm text-muted">
                      Every product currently shown in this bounded selector is already assigned.
                    </p>
                  )}
                </div>

                <div className="mt-6 grid gap-5 xl:grid-cols-2">
                  {group.placements.map((placement) => (
                    <div key={placement.publicId} className="rounded-xl border border-line p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="font-semibold text-strong">{placement.product.title}</h4>
                          <p className="mt-1 font-mono text-xs text-muted">
                            /{placement.product.slug} · {placement.product.status}
                            {placement.product.deleted ? " · deleted" : ""}
                          </p>
                        </div>
                        {placement.isLegacyManaged ? (
                          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
                            Legacy metadata preserved
                          </span>
                        ) : null}
                      </div>
                      <AdminActionForm
                        action={updatePlacementAction}
                        className="mt-5 space-y-5"
                        submitLabel="Save placement"
                      >
                        <input
                          type="hidden"
                          name="placementPublicId"
                          value={placement.publicId}
                        />
                        <input type="hidden" name="placementKey" value={group.key} />
                        <label className={labelClass}>
                          Position
                          <input
                            className={inputClass}
                            name="position"
                            type="number"
                            min="0"
                            max="1000000"
                            step="1"
                            defaultValue={placement.position}
                            readOnly={placement.isLegacyManaged}
                            required
                          />
                          {placement.isLegacyManaged ? (
                            <span className="mt-2 block text-xs font-normal text-muted">
                              Imported positions are read-only so the legacy import can be rerun safely.
                            </span>
                          ) : null}
                        </label>
                        <label className="flex items-center gap-3 text-sm font-semibold text-strong">
                          <input
                            type="checkbox"
                            name="isActive"
                            defaultChecked={placement.isActive}
                          />{" "}
                          Active on storefront
                        </label>
                      </AdminActionForm>
                      {!placement.isLegacyManaged ? (
                        <div className="mt-5 border-t border-line pt-5">
                          <AdminActionForm
                            action={deletePlacementAction}
                            className="space-y-4"
                            submitLabel="Remove product from placement"
                          >
                            <input
                              type="hidden"
                              name="placementPublicId"
                              value={placement.publicId}
                            />
                            <input
                              type="hidden"
                              name="placementKey"
                              value={group.key}
                            />
                          </AdminActionForm>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                {!group.placements.length ? (
                  <p className="mt-6 text-sm text-muted">
                    This core key is empty. It remains available so a product can
                    be added again.
                  </p>
                ) : null}
              </article>
            );
          })}
        </section>
      </div>
    </section>
  );
}
