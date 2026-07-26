import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { buildQueryHref, type SearchParameter } from "@/lib/pagination";
import { getAdminInventoryIndex } from "@/server/admin/inventory/queries";

import {
  adjustInventoryAction,
  createLocationAction,
} from "./actions";
import { DISPLAY_TIME_ZONE } from "@/lib/display-timezone";

export const metadata: Metadata = {
  title: "Inventory administration",
  robots: { index: false, follow: false },
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

function signed(value: number) {
  return value > 0 ? `+${value}` : value.toString();
}

export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const inventory = await getAdminInventoryIndex(await searchParams);
  const submissionId = randomUUID();
  const trackedVariants = inventory.variants.filter(
    (variant) => variant.trackInventory,
  );

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header>
          <Link href="/admin" className="text-sm font-semibold text-sage-700">
            ← Administration
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Operations
          </p>
          <h1 className="mt-3 text-h2 text-strong">Inventory</h1>
          <p className="mt-3 max-w-3xl text-body">
            Review US stock by location and product variant. On-hand changes are
            recorded as immutable adjustments with an administrator-provided reason.
          </p>
        </header>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-h4 text-strong">US locations</h2>
              <p className="mt-2 text-sm text-muted">
                {inventory.locations.length} configured location
                {inventory.locations.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          {inventory.locations.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="py-3 pr-4">Code</th>
                    <th className="py-3 pr-4">Name</th>
                    <th className="py-3 pr-4">Area</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4">Levels</th>
                    <th className="py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {inventory.locations.map((location) => (
                    <tr key={location.publicId}>
                      <td className="py-4 pr-4 font-mono font-semibold text-strong">
                        {location.code}
                      </td>
                      <td className="py-4 pr-4">{location.name}</td>
                      <td className="py-4 pr-4 text-muted">
                        {[location.city, location.region]
                          .filter(Boolean)
                          .join(", ") || "Not specified"}
                      </td>
                      <td className="py-4 pr-4">
                        {location.isActive ? "Active" : "Inactive"}
                      </td>
                      <td className="py-4 pr-4">{location.levelCount}</td>
                      <td className="py-4">
                        <Link
                          href={`/admin/inventory/locations/${location.publicId}`}
                          className="font-semibold text-sage-700"
                        >
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-5 text-body">No US inventory locations exist yet.</p>
          )}
        </section>

        {inventory.canManage ? (
          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
              <h2 className="text-h4 text-strong">Create US location</h2>
              <p className="mt-3 text-sm text-muted">
                Country is fixed to the United States for the current storefront.
              </p>
              <AdminActionForm
                action={createLocationAction}
                submitLabel="Create location"
                className="mt-6 space-y-5"
              >
                <input type="hidden" name="countryCode" value="US" />
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-strong">
                    Code
                    <input
                      name="code"
                      required
                      maxLength={80}
                      placeholder="US-WEST"
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal uppercase"
                    />
                  </label>
                  <label className="text-sm font-semibold text-strong">
                    Name
                    <input
                      name="name"
                      required
                      maxLength={180}
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                    />
                  </label>
                  <label className="text-sm font-semibold text-strong">
                    State / region
                    <input
                      name="region"
                      maxLength={120}
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                    />
                  </label>
                  <label className="text-sm font-semibold text-strong">
                    City
                    <input
                      name="city"
                      maxLength={120}
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                    />
                  </label>
                </div>
                <label className="flex items-start gap-3 text-sm text-body">
                  <input
                    type="checkbox"
                    name="isActive"
                    defaultChecked
                    className="mt-1"
                  />
                  <span>Location is active for inventory allocation.</span>
                </label>
              </AdminActionForm>
            </section>

            <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
              <h2 className="text-h4 text-strong">Adjust on-hand stock</h2>
              <p className="mt-3 text-sm text-muted">
                Use a positive number to receive stock or a negative number to
                remove stock. The server calculates and validates the final balance.
              </p>
              {inventory.locations.length && trackedVariants.length ? (
                <AdminActionForm
                  action={adjustInventoryAction}
                  submitLabel="Record adjustment"
                  className="mt-6 space-y-5"
                >
                  <input
                    type="hidden"
                    name="idempotencyKey"
                    value={submissionId}
                  />
                  <label className="block text-sm font-semibold text-strong">
                    Location
                    <select
                      name="locationPublicId"
                      required
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                    >
                      {inventory.locations.map((location) => (
                        <option key={location.publicId} value={location.publicId}>
                          {location.code} — {location.name}
                          {location.isActive ? "" : " (inactive)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold text-strong">
                    Product variant
                    <select
                      name="variantPublicId"
                      required
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                    >
                      {trackedVariants.map((variant) => (
                        <option key={variant.publicId} value={variant.publicId}>
                          {variant.productTitle} — {variant.title}
                          {variant.sku ? ` (${variant.sku})` : " (no SKU)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold text-strong">
                    Quantity change
                    <input
                      name="quantityDelta"
                      required
                      inputMode="numeric"
                      placeholder="25 or -3"
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                    />
                  </label>
                  <label className="block text-sm font-semibold text-strong">
                    Reason
                    <textarea
                      name="reason"
                      required
                      maxLength={2_000}
                      rows={4}
                      placeholder="Receiving count, cycle-count correction, damage, or another auditable reason."
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal leading-relaxed"
                    />
                  </label>
                </AdminActionForm>
              ) : (
                <p className="mt-5 text-body">
                  Create a US location and ensure at least one variant tracks
                  inventory before recording an adjustment.
                </p>
              )}
            </section>
          </div>
        ) : (
          <p className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 text-body">
            You have inventory.read access. inventory.manage is required to create
            locations or record adjustments.
          </p>
        )}

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-h4 text-strong">
              Inventory levels ({inventory.pagination.total})
            </h2>
            <p className="text-caption text-muted">
              Page {inventory.pagination.page} of {inventory.pagination.pageCount}
            </p>
          </div>
          <form action="/admin/inventory" method="get" className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1 text-sm font-semibold text-strong">
              SKU, product, variant, or location
              <input
                name="q"
                maxLength={120}
                defaultValue={inventory.filters.q}
                placeholder="Search inventory levels"
                className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <button type="submit" className="rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-white">
                Search
              </button>
              <Link href="/admin/inventory" className="rounded-full border border-ink-900/15 px-6 py-3 text-sm font-semibold text-strong">
                Reset
              </Link>
            </div>
          </form>
          {inventory.levels.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="py-3 pr-4">Location</th>
                    <th className="py-3 pr-4">Product / variant</th>
                    <th className="py-3 pr-4">SKU</th>
                    <th className="py-3 pr-4">On hand</th>
                    <th className="py-3 pr-4">Reserved</th>
                    <th className="py-3 pr-4">Safety</th>
                    <th className="py-3 pr-4">Backorder</th>
                    <th className="py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {inventory.levels.map((level) => (
                    <tr
                      key={`${level.locationPublicId}:${level.variantPublicId}`}
                    >
                      <td className="py-4 pr-4">
                        <p className="font-mono font-semibold text-strong">
                          {level.locationCode}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {level.locationName}
                          {level.locationIsActive ? "" : " · inactive"}
                        </p>
                      </td>
                      <td className="py-4 pr-4">
                        <p className="font-semibold text-strong">
                          {level.productTitle}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {level.variantTitle}
                        </p>
                      </td>
                      <td className="py-4 pr-4 font-mono text-xs">
                        {level.sku ?? "—"}
                      </td>
                      <td className="py-4 pr-4 font-semibold text-strong">
                        {level.onHandQuantity}
                      </td>
                      <td className="py-4 pr-4">{level.reservedQuantity}</td>
                      <td className="py-4 pr-4">{level.safetyStockQuantity}</td>
                      <td className="py-4 pr-4">
                        {level.allowBackorder ? "Allowed" : "Blocked"}
                      </td>
                      <td className="py-4 text-xs text-muted">
                        {formatDate(level.updatedAt)} UTC
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-5 text-body">
              {inventory.filters.q
                ? "No inventory levels match this search."
                : "No inventory levels exist. A first positive adjustment initializes the selected location and variant at zero before applying the delta."}
            </p>
          )}
          <nav className="mt-6 flex flex-wrap items-center justify-between gap-4" aria-label="Inventory level pagination">
            {inventory.pagination.page > 1 ? (
              <Link
                href={buildQueryHref("/admin/inventory", {
                  q: inventory.filters.q,
                  page: inventory.pagination.page - 1,
                })}
                className="font-semibold text-sage-700"
              >
                ← Previous page
              </Link>
            ) : (
              <span className="text-sm text-muted">First page</span>
            )}
            {inventory.pagination.page < inventory.pagination.pageCount ? (
              <Link
                href={buildQueryHref("/admin/inventory", {
                  q: inventory.filters.q,
                  page: inventory.pagination.page + 1,
                })}
                className="font-semibold text-sage-700"
              >
                Next page →
              </Link>
            ) : (
              <span className="text-sm text-muted">Last page</span>
            )}
          </nav>
        </section>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-h4 text-strong">Recent movements</h2>
            <p className="text-caption text-muted">Newest 100</p>
          </div>
          {inventory.movements.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="py-3 pr-4">Time</th>
                    <th className="py-3 pr-4">Location</th>
                    <th className="py-3 pr-4">Variant</th>
                    <th className="py-3 pr-4">Type</th>
                    <th className="py-3 pr-4">Delta</th>
                    <th className="py-3 pr-4">After</th>
                    <th className="py-3">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {inventory.movements.map((movement) => (
                    <tr key={movement.publicId}>
                      <td className="py-4 pr-4 text-xs text-muted">
                        {formatDate(movement.occurredAt)} UTC
                      </td>
                      <td className="py-4 pr-4 font-mono">
                        {movement.locationCode}
                      </td>
                      <td className="py-4 pr-4">
                        <p className="font-semibold text-strong">
                          {movement.productTitle}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {movement.variantTitle} · {movement.sku ?? "No SKU"}
                        </p>
                      </td>
                      <td className="py-4 pr-4">{movement.type}</td>
                      <td className="py-4 pr-4 font-semibold">
                        {signed(movement.quantityDelta)}
                      </td>
                      <td className="py-4 pr-4">{movement.onHandAfter}</td>
                      <td className="max-w-sm py-4 text-muted">
                        {movement.reason ?? "No reason recorded"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-5 text-body">No inventory movements recorded.</p>
          )}
        </section>
      </div>
    </section>
  );
}
