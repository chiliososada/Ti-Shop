import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { getAdminRoleIndex } from "@/server/admin/access/role-queries";

export const metadata: Metadata = {
  title: "Administrator roles and permissions",
  robots: { index: false, follow: false },
};

function RoleCard({
  role,
}: {
  role: Awaited<ReturnType<typeof getAdminRoleIndex>>["roles"][number];
}) {
  return (
    <article className="rounded-xl border border-ink-900/[0.08] bg-surface-alt p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-strong">{role.name}</h3>
          <p className="mt-1 font-mono text-xs text-muted">{role.slug}</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-caption font-semibold text-muted">
          {role.assignmentCount} assigned
        </span>
      </div>
      {role.description ? (
        <p className="mt-3 text-sm leading-relaxed text-body">
          {role.description}
        </p>
      ) : null}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold text-sage-700">
          {role.permissions.length} permissions
        </summary>
        <ul className="mt-3 flex flex-wrap gap-2">
          {role.permissions.map((permission) => (
            <li
              key={permission.slug}
              title={permission.description ?? permission.name}
              className="rounded-full bg-white px-3 py-1 font-mono text-xs text-muted"
            >
              {permission.slug}
            </li>
          ))}
        </ul>
      </details>
      {!role.isSystem ? (
        <Link
          href={`/admin/users/roles/${role.publicId}`}
          className="mt-5 inline-block text-sm font-semibold text-sage-700"
        >
          {role.canEdit ? "Edit custom role →" : "View custom role →"}
        </Link>
      ) : (
        <p className="mt-5 text-xs leading-relaxed text-muted">
          System policy: name, permissions, and deletion are protected.
        </p>
      )}
    </article>
  );
}

export default async function AdminRolesPage() {
  await connection();
  const result = await getAdminRoleIndex();
  const systemRoles = result.roles.filter((role) => role.isSystem);
  const customRoles = result.roles.filter((role) => !role.isSystem);

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header>
          <Link href="/admin/users" className="text-sm font-semibold text-sage-700">
            ← Users and administrators
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Identity and access
          </p>
          <h1 className="mt-3 text-h2 text-strong">Roles and permissions</h1>
          <p className="mt-3 max-w-3xl text-body">
            Review immutable system policy and maintain least-privilege custom
            administrator roles. A manager cannot grant a permission their own
            account does not hold.
          </p>
          {result.canManageRoles ? (
            <Link
              href="/admin/users/roles/new"
              className="mt-6 inline-flex rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-white"
            >
              Create custom role
            </Link>
          ) : null}
        </header>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-h4 text-strong">Custom roles</h2>
              <p className="mt-2 text-sm text-muted">
                Custom roles may be renamed and reconfigured by an authorized
                manager. They can be deleted only when no user is assigned.
              </p>
            </div>
            <span className="text-caption text-muted">
              {customRoles.length} custom roles
            </span>
          </div>
          {customRoles.length ? (
            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              {customRoles.map((role) => (
                <RoleCard key={role.publicId} role={role} />
              ))}
            </div>
          ) : (
            <p className="mt-6 rounded-xl bg-surface-alt p-5 text-sm text-body">
              No custom roles exist. System roles remain available for assignment.
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <h2 className="text-h4 text-strong">Protected system roles</h2>
          <p className="mt-2 text-sm text-muted">
            These seeded roles remain immutable in the administration interface.
          </p>
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {systemRoles.map((role) => (
              <RoleCard key={role.publicId} role={role} />
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
