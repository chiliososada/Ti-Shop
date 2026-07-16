import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import {
  deleteCustomRoleAction,
  updateCustomRoleAction,
} from "@/app/admin/users/roles/actions";
import { RolePermissionSelector } from "@/app/admin/users/roles/RolePermissionSelector";
import { getCustomRoleDetail } from "@/server/admin/access/role-queries";

export const metadata: Metadata = {
  title: "Custom administrator role",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

export default async function CustomRolePage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const role = await getCustomRoleDetail(publicId);
  if (!role) notFound();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-5xl space-y-10">
        <header>
          <Link
            href="/admin/users/roles"
            className="text-sm font-semibold text-sage-700"
          >
            ← Roles and permissions
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Custom administrator role
          </p>
          <h1 className="mt-3 text-h2 text-strong">{role.name}</h1>
          <p className="mt-3 font-mono text-xs text-muted">{role.slug}</p>
          <p className="mt-3 text-body">
            {role.assignmentCount} administrator
            {role.assignmentCount === 1 ? "" : "s"} currently assigned.
          </p>
        </header>

        {role.canEdit ? (
          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
            <AdminActionForm action={updateCustomRoleAction} submitLabel="Save role">
              <input type="hidden" name="publicId" value={role.publicId} />
              <label className={labelClass}>
                Role name
                <input
                  className={inputClass}
                  name="name"
                  required
                  minLength={2}
                  maxLength={120}
                  defaultValue={role.name}
                  autoComplete="off"
                />
              </label>
              <label className={labelClass}>
                Description
                <textarea
                  className={inputClass}
                  name="description"
                  rows={5}
                  maxLength={2000}
                  defaultValue={role.description ?? ""}
                />
              </label>
              <RolePermissionSelector options={role.permissionOptions} />
            </AdminActionForm>
          </article>
        ) : (
          <article className="rounded-2xl border border-clay-700/15 bg-clay-50 p-6">
            <h2 className="text-h4 text-strong">Read-only role</h2>
            <p className="mt-3 text-sm leading-relaxed text-clay-700">
              You cannot edit this role because it contains at least one permission
              your account does not hold, or your account lacks role-management
              access.
            </p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {role.permissions.map((permission) => (
                <li
                  key={permission.slug}
                  className="rounded-full bg-white px-3 py-1 font-mono text-xs text-muted"
                >
                  {permission.slug}
                </li>
              ))}
            </ul>
          </article>
        )}

        {role.canEdit ? (
          <article className="rounded-2xl border border-red-800/15 bg-red-50 p-6">
            <h2 className="text-h4 text-strong">Delete custom role</h2>
            {role.assignmentCount === 0 ? (
              <AdminActionForm
                action={deleteCustomRoleAction}
                submitLabel="Delete custom role"
                className="mt-4 space-y-4"
              >
                <input type="hidden" name="publicId" value={role.publicId} />
                <p className="text-sm leading-relaxed text-red-800">
                  Deletion is permanent. The audit record remains available.
                </p>
              </AdminActionForm>
            ) : (
              <p className="mt-3 text-sm leading-relaxed text-red-800">
                This role is in use. Remove it from every administrator before
                deletion.
              </p>
            )}
          </article>
        ) : null}
      </div>
    </section>
  );
}
