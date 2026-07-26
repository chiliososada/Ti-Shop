import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import {
  getAdminUserIndex,
  getSystemRoleMatrix,
} from "@/server/admin/access/queries";
import { DISPLAY_TIME_ZONE } from "@/lib/display-timezone";

export const metadata: Metadata = {
  title: "User and access administration",
  robots: { index: false, follow: false },
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

export default async function AdminUsersPage() {
  await connection();
  const result = await getAdminUserIndex();
  const roleMatrix = result.canReadRoles ? await getSystemRoleMatrix() : null;

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header>
          <Link href="/admin" className="text-sm font-semibold text-sage-700">
            ← Administration
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Identity and access
          </p>
          <h1 className="mt-3 text-h2 text-strong">Users and administrators</h1>
          <p className="mt-3 max-w-3xl text-body">
            Review account identities and administrator status. Password hashes,
            sessions, provider accounts, and tokens are deliberately excluded from
            every query and view.
          </p>
          {result.canReadAudit || result.canReadRoles ? (
            <div className="mt-5 flex flex-wrap gap-4 text-sm font-semibold">
              {result.canReadRoles ? (
                <Link href="/admin/users/roles" className="text-sage-700">
                  Roles and permissions →
                </Link>
              ) : null}
              {result.canReadAudit ? (
                <Link href="/admin/audit" className="text-sage-700">
                  Open audit log →
                </Link>
              ) : null}
            </div>
          ) : null}
        </header>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-h4 text-strong">
              User accounts ({result.users.length})
            </h2>
            <p className="text-caption text-muted">Newest 500 accounts</p>
          </div>
          {result.users.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="py-3 pr-4">User</th>
                    <th className="py-3 pr-4">Email status</th>
                    <th className="py-3 pr-4">Administrator</th>
                    <th className="py-3 pr-4">Created</th>
                    <th className="py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.users.map((user) => (
                    <tr key={user.publicId}>
                      <td className="py-4 pr-4">
                        <p className="font-semibold text-strong">
                          {user.name}
                          {user.publicId === result.currentUserPublicId
                            ? " (you)"
                            : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted">{user.email}</p>
                      </td>
                      <td className="py-4 pr-4">
                        {user.emailVerified ? "Verified" : "Not verified"}
                      </td>
                      <td className="py-4 pr-4">
                        {!user.administrator.exists
                          ? "Customer only"
                          : user.administrator.isActive
                            ? "Active"
                            : "Inactive"}
                        {user.administrator.jobTitle ? (
                          <p className="mt-1 text-xs text-muted">
                            {user.administrator.jobTitle}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-4 pr-4 text-xs text-muted">
                        {formatDate(user.createdAt)} UTC
                      </td>
                      <td className="py-4">
                        <Link
                          href={`/admin/users/${user.publicId}`}
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
            <p className="mt-5 text-body">No user accounts exist.</p>
          )}
        </section>

        {roleMatrix ? (
          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-h4 text-strong">System role matrix</h2>
                <p className="mt-2 text-sm text-muted">
                  Permissions shown here are protected seeded policy. Custom role
                  definitions are managed from Roles and permissions.
                </p>
              </div>
              <p className="text-caption text-muted">
                {roleMatrix.canManageRoles ? "Assignment enabled" : "Read only"}
              </p>
            </div>
            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              {roleMatrix.roles.map((role) => (
                <article
                  key={role.slug}
                  className="rounded-xl border border-ink-900/[0.08] bg-surface-alt p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-strong">{role.name}</h3>
                      <p className="mt-1 font-mono text-xs text-muted">
                        {role.slug}
                      </p>
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
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
