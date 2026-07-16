import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { updateSeoAction } from "@/app/admin/seo/actions";
import { getAdminSeoTarget } from "@/server/admin/seo/queries";

export const metadata: Metadata = {
  title: "Edit SEO metadata",
  robots: { index: false, follow: false },
};

const inputClass = "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

export default async function AdminSeoTargetPage({
  params,
}: {
  params: Promise<{ entityType: string; publicId: string }>;
}) {
  await connection();
  const { entityType, publicId } = await params;
  const target = await getAdminSeoTarget(entityType, publicId);
  if (!target) notFound();
  const currentMediaIsEligible = target.openGraphMediaCandidates.some(
    (candidate) => candidate.publicId === target.openGraphMediaPublicId,
  );

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-4xl">
        <header>
          <Link
            href="/admin/seo"
            className="text-sm font-semibold text-sage-700"
          >
            ← SEO
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            {target.entityType} metadata
          </p>
          <h1 className="mt-3 text-h2 text-strong">{target.label}</h1>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted">
            <span>
              {target.isManagedPage
                ? `Fixed route: ${target.publicPath}`
                : `Protected slug: /${target.slug}`}
            </span>
            <Link
              className="font-semibold text-sage-700"
              href={target.publicPath}
            >
              View storefront
            </Link>
          </div>
        </header>

        <article className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          {target.isManagedPage ? (
            <p className="mb-6 rounded-xl border border-amber-700/20 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-950">
              This metadata is public. Do not enter payment or bank details,
              NOWPayments keys, Zelle destinations, credentials, email
              addresses, phone numbers, or customer information.
            </p>
          ) : null}
          <AdminActionForm action={updateSeoAction}>
            <input type="hidden" name="entityType" value={target.entityType} />
            <input
              type="hidden"
              name="targetPublicId"
              value={target.targetPublicId}
            />
            <label className={labelClass}>
              SEO title
              <input
                className={inputClass}
                name="title"
                defaultValue={target.title ?? ""}
                maxLength={255}
              />
              <span className="mt-2 block text-xs font-normal text-muted">
                Leave blank to use the page default.
              </span>
            </label>
            <label className={labelClass}>
              Meta description
              <textarea
                className={inputClass}
                name="description"
                rows={5}
                defaultValue={target.description ?? ""}
                maxLength={500}
              />
            </label>
            <label className={labelClass}>
              Canonical URL
              <input
                className={inputClass}
                name="canonicalUrl"
                defaultValue={
                  target.fixedCanonicalPath ?? target.canonicalUrl ?? ""
                }
                placeholder={target.publicPath}
                maxLength={2048}
                readOnly={target.isManagedPage}
              />
              <span className="mt-2 block text-xs font-normal text-muted">
                {target.isManagedPage
                  ? "This managed policy or information page keeps its established fixed canonical route."
                  : "Use a public root-relative path or credential-free HTTPS URL. Query strings, fragments, and HTTP URLs (including localhost) are not accepted."}
              </span>
            </label>
            <label className={labelClass}>
              Open Graph image override
              <select
                className={inputClass}
                name="openGraphMediaPublicId"
                defaultValue={
                  currentMediaIsEligible
                    ? (target.openGraphMediaPublicId ?? "")
                    : ""
                }
              >
                <option value="">
                  Clear override — use the storefront fallback
                </option>
                {target.openGraphMediaCandidates.map((candidate) => {
                  const dimensions =
                    candidate.width && candidate.height
                      ? ` · ${candidate.width}×${candidate.height}`
                      : "";
                  return (
                    <option key={candidate.publicId} value={candidate.publicId}>
                      {candidate.label}
                      {dimensions} · {candidate.publicId.slice(0, 8)}
                    </option>
                  );
                })}
              </select>
              <span className="mt-2 block text-xs font-normal text-muted">
                Select an existing public image. Uploads are managed elsewhere;
                this form never uploads a file.
              </span>
            </label>
            {target.openGraphMediaPublicId && !currentMediaIsEligible ? (
              <div
                role="alert"
                className="rounded-xl border border-amber-700/20 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                The saved Open Graph image is no longer public, safe, or an
                active image. It is ignored on the storefront. Saving with the
                fallback option clears this stale override.
              </div>
            ) : null}
            {target.openGraphMediaCandidates.length === 0 ? (
              <p className="rounded-xl border border-ink-900/10 bg-surface-warm px-4 py-3 text-sm text-muted">
                No eligible public images are available yet. The storefront
                fallback will continue to be used.
              </p>
            ) : null}
            <label className="flex items-center gap-3 text-sm font-semibold text-strong">
              <input
                type="checkbox"
                name="noIndex"
                defaultChecked={target.noIndex}
              />
              Prevent search engines from indexing this page
            </label>
          </AdminActionForm>
        </article>
      </div>
    </section>
  );
}
