import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { getAdminInventoryLocation } from "@/server/admin/inventory/queries";

import { updateLocationAction } from "../../actions";

export const metadata: Metadata = {
  title: "Inventory location administration",
  robots: { index: false, follow: false },
};

export default async function AdminInventoryLocationPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const location = await getAdminInventoryLocation(publicId);
  if (!location) notFound();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x">
        <header>
          <Link
            href="/admin/inventory"
            className="text-sm font-semibold text-sage-700"
          >
            ← Inventory
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            US location
          </p>
          <h1 className="mt-3 text-h2 text-strong">{location.name}</h1>
          <p className="mt-3 text-body">
            {location.code} · {location.levelCount} inventory level
            {location.levelCount === 1 ? "" : "s"} · {location.isActive ? "Active" : "Inactive"}
          </p>
        </header>

        <section className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <h2 className="text-h4 text-strong">Location details</h2>
          {location.canManage ? (
            <AdminActionForm
              action={updateLocationAction}
              submitLabel="Save location"
              className="mt-6 space-y-5"
            >
              <input type="hidden" name="publicId" value={location.publicId} />
              <input type="hidden" name="countryCode" value="US" />
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="text-sm font-semibold text-strong">
                  Code
                  <input
                    name="code"
                    required
                    maxLength={80}
                    defaultValue={location.code}
                    className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal uppercase"
                  />
                </label>
                <label className="text-sm font-semibold text-strong">
                  Name
                  <input
                    name="name"
                    required
                    maxLength={180}
                    defaultValue={location.name}
                    className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                  />
                </label>
                <label className="text-sm font-semibold text-strong">
                  State / region
                  <input
                    name="region"
                    maxLength={120}
                    defaultValue={location.region ?? ""}
                    className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                  />
                </label>
                <label className="text-sm font-semibold text-strong">
                  City
                  <input
                    name="city"
                    maxLength={120}
                    defaultValue={location.city ?? ""}
                    className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                  />
                </label>
              </div>
              <label className="flex items-start gap-3 text-sm text-body">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={location.isActive}
                  className="mt-1"
                />
                <span>Location is active for inventory allocation.</span>
              </label>
            </AdminActionForm>
          ) : (
            <dl className="mt-6 grid gap-5 sm:grid-cols-2">
              <div>
                <dt className="text-caption text-muted">Code</dt>
                <dd className="mt-1 font-semibold text-strong">{location.code}</dd>
              </div>
              <div>
                <dt className="text-caption text-muted">Country</dt>
                <dd className="mt-1 font-semibold text-strong">United States</dd>
              </div>
              <div>
                <dt className="text-caption text-muted">State / region</dt>
                <dd className="mt-1 text-body">{location.region ?? "Not specified"}</dd>
              </div>
              <div>
                <dt className="text-caption text-muted">City</dt>
                <dd className="mt-1 text-body">{location.city ?? "Not specified"}</dd>
              </div>
            </dl>
          )}
        </section>
      </div>
    </section>
  );
}
