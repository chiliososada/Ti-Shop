import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import {
  createNavigationItemAction,
  updateNavigationAction,
  updateNavigationItemAction,
} from "@/app/admin/content/navigation/actions";
import { getAdminNavigation } from "@/server/admin/navigation/queries";

export const metadata: Metadata = {
  title: "Edit navigation",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

function LinkFields({
  item,
}: {
  item?: {
    label: string;
    url: string;
    position: number;
    isVisible: boolean;
    openInNewTab: boolean;
  };
}) {
  return (
    <>
      <div className="grid gap-5 md:grid-cols-3">
        <label className={`${labelClass} md:col-span-1`}>
          Label
          <input
            className={inputClass}
            name="label"
            required
            maxLength={160}
            defaultValue={item?.label ?? ""}
          />
        </label>
        <label className={`${labelClass} md:col-span-2`}>
          URL
          <input
            className={`${inputClass} font-mono`}
            name="url"
            required
            maxLength={2048}
            inputMode="url"
            placeholder="/products or https://docs.example.com/"
            defaultValue={item?.url ?? ""}
          />
        </label>
        <label className={labelClass}>
          Position
          <input
            className={inputClass}
            name="position"
            type="number"
            min={0}
            max={1000000}
            step={1}
            required
            defaultValue={item?.position ?? 0}
          />
        </label>
        <label className="flex items-center gap-3 self-end py-3 text-sm font-semibold text-strong">
          <input
            type="checkbox"
            name="isVisible"
            defaultChecked={item?.isVisible ?? true}
          />
          Visible on storefront
        </label>
        <label className="flex items-center gap-3 self-end py-3 text-sm font-semibold text-strong">
          <input
            type="checkbox"
            name="openInNewTab"
            defaultChecked={item?.openInNewTab ?? false}
          />
          Open in a new tab
        </label>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Only a public same-site path beginning with one slash or an absolute HTTPS
        URL without credentials is accepted. /admin, /api, /account, /checkout,
        /_next, protocol-relative, javascript:, data:, control-character, and
        ambiguous backslash destinations are rejected.
      </p>
    </>
  );
}

export default async function EditAdminNavigationPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const navigation = await getAdminNavigation(publicId);
  if (!navigation) notFound();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-6xl space-y-10">
        <header>
          <Link
            href="/admin/content/navigation"
            className="text-sm font-semibold text-sage-700"
          >
            ← Navigation
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Named menu · {navigation.key}
          </p>
          <h1 className="mt-3 text-h2 text-strong">{navigation.name}</h1>
          <p className="mt-3 max-w-3xl text-body">
            Only the first-level links below are managed and rendered. Published
            <code> header </code> and <code>footer</code> menus replace their fixed
            fallback only when at least one safe visible item remains.
          </p>
        </header>

        {navigation.nestedCount > 0 ? (
          <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            This record contains {navigation.nestedCount} legacy nested item(s).
            They are intentionally ignored by this first-level editor and by the
            storefront renderer.
          </p>
        ) : null}
        {navigation.truncated ? (
          <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            Only the first 100 first-level items are shown. No additional item can
            be created until the record is cleaned up directly by an operator.
          </p>
        ) : null}

        <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <h2 className="text-h4 text-strong">Navigation settings</h2>
          <AdminActionForm action={updateNavigationAction} className="mt-6 space-y-6">
            <input type="hidden" name="publicId" value={navigation.publicId} />
            <div className="grid gap-5 md:grid-cols-2">
              <label className={labelClass}>
                Key
                <input
                  className={inputClass}
                  name="key"
                  required
                  maxLength={100}
                  defaultValue={navigation.key}
                />
              </label>
              <label className={labelClass}>
                Administrative name
                <input
                  className={inputClass}
                  name="name"
                  required
                  maxLength={160}
                  defaultValue={navigation.name}
                />
              </label>
              <label className={labelClass}>
                Status
                <select className={inputClass} name="status" defaultValue={navigation.status}>
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </label>
            </div>
          </AdminActionForm>
        </article>

        <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <h2 className="text-h4 text-strong">Add first-level link</h2>
          <p className="mt-2 text-sm text-muted">
            Position controls ascending display order. Matching positions use stable
            creation order.
          </p>
          <AdminActionForm
            action={createNavigationItemAction}
            submitLabel="Add link"
            className="mt-6 space-y-6"
          >
            <input type="hidden" name="submissionId" value={randomUUID()} />
            <input
              type="hidden"
              name="navigationPublicId"
              value={navigation.publicId}
            />
            <LinkFields />
          </AdminActionForm>
        </article>

        <section className="space-y-5">
          <div>
            <h2 className="text-h3 text-strong">
              First-level links ({navigation.topLevelCount})
            </h2>
            <p className="mt-2 text-sm text-muted">
              Hide an item to remove it from the storefront while retaining its
              administrative history.
            </p>
          </div>
          {navigation.items.map((item) => (
            <article
              key={item.publicId}
              className="rounded-2xl border border-ink-900/[0.08] bg-surface p-7"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-h5 text-strong">{item.label}</h3>
                  <p className="mt-1 break-all font-mono text-xs text-muted">
                    {item.url}
                  </p>
                </div>
                <span className="rounded-full bg-surface-alt px-3 py-1 text-xs font-semibold text-muted">
                  {item.isVisible ? "Visible" : "Hidden"}
                </span>
              </div>
              <AdminActionForm
                action={updateNavigationItemAction}
                className="mt-6 space-y-6"
              >
                <input type="hidden" name="publicId" value={item.publicId} />
                <input
                  type="hidden"
                  name="navigationPublicId"
                  value={navigation.publicId}
                />
                <LinkFields item={item} />
              </AdminActionForm>
            </article>
          ))}
          {!navigation.items.length ? (
            <p className="rounded-2xl border border-dashed border-ink-900/15 bg-surface p-8 text-body">
              No first-level links exist. The storefront will continue using its
              reviewed fixed fallback even if this navigation is published.
            </p>
          ) : null}
        </section>
      </div>
    </section>
  );
}
