import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import {
  getAdminUserDetail,
  getAdminUserRoleAccess,
} from "@/server/admin/access/queries";

import {
  assignCustomRoleAction,
  assignSystemRoleAction,
  removeCustomRoleAction,
  removeSystemRoleAction,
  setAdminProfileActiveAction,
} from "../actions";
import { DISPLAY_TIME_ZONE } from "@/lib/display-timezone";

export const metadata: Metadata = {
  title: "User access administration",
  robots: { index: false, follow: false },
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const user = await getAdminUserDetail(publicId);
  if (!user) notFound();

  const roleAccess = user.canReadRoles
    ? await getAdminUserRoleAccess(publicId)
    : null;
  if (user.canReadRoles && !roleAccess) notFound();

  const assignedSystemRoles = new Map(
    roleAccess?.assignments
      .filter((assignment) => assignment.isSystem)
      .map((assignment) => [assignment.roleSlug, assignment.assignedAt]) ?? [],
  );
  const assignedCustomRoles = new Map(
    roleAccess?.assignments
      .filter((assignment) => !assignment.isSystem)
      .map((assignment) => [assignment.rolePublicId, assignment.assignedAt]) ??
      [],
  );
  const targetIsOwner = assignedSystemRoles.has("owner");
  const canChangeStatus =
    user.canManageUsers &&
    !user.isCurrentUser &&
    (user.administrator.isActive || user.emailVerified) &&
    !(targetIsOwner && roleAccess && !roleAccess.actorIsOwner);

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header>
          <Link
            href="/admin/users"
            className="text-sm font-semibold text-sage-700"
          >
            ← Users and administrators
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Account access
          </p>
          <h1 className="mt-3 text-h2 text-strong">
            {user.name}{user.isCurrentUser ? " (you)" : ""}
          </h1>
          <p className="mt-3 text-body">
            {user.email} · {user.emailVerified ? "Email verified" : "Email not verified"}
          </p>
          <p className="mt-2 text-caption text-muted">
            Created {formatDate(user.createdAt)} CT · Updated {formatDate(user.updatedAt)} CT
          </p>
          {!user.emailVerified ? (
            <p className="mt-4 rounded-xl bg-clay-50 p-4 text-sm text-clay-700">
              Administrator roles and profile activation are blocked until email
              ownership is verified. Existing roles can still be removed and an
              active profile can still be deactivated.
            </p>
          ) : null}
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
            <h2 className="text-h4 text-strong">Safe account identity</h2>
            <dl className="mt-6 grid gap-5 sm:grid-cols-2">
              <div>
                <dt className="text-caption text-muted">Display name</dt>
                <dd className="mt-1 text-body">{user.name}</dd>
              </div>
              <div>
                <dt className="text-caption text-muted">Email</dt>
                <dd className="mt-1 break-all text-body">{user.email}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-caption text-muted">Public account ID</dt>
                <dd className="mt-1 break-all font-mono text-xs text-body">
                  {user.publicId}
                </dd>
              </div>
            </dl>
            <p className="mt-6 rounded-xl bg-surface-alt p-4 text-sm leading-relaxed text-body">
              Authentication secrets, password records, sessions, provider account
              records, and tokens are not selected by this page.
            </p>
          </section>

          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
            <h2 className="text-h4 text-strong">Administrator status</h2>
            <p className="mt-4 text-body">
              {!user.administrator.exists
                ? "No administrator profile"
                : user.administrator.isActive
                  ? "Active administrator profile"
                  : "Inactive administrator profile"}
            </p>
            {user.administrator.jobTitle ? (
              <p className="mt-2 text-sm text-muted">
                Job title: {user.administrator.jobTitle}
              </p>
            ) : null}

            {canChangeStatus ? (
              <AdminActionForm
                action={setAdminProfileActiveAction}
                submitLabel={
                  user.administrator.isActive
                    ? "Deactivate administrator"
                    : "Enable administrator"
                }
                className="mt-6 space-y-4"
              >
                <input type="hidden" name="userPublicId" value={user.publicId} />
                <input
                  type="hidden"
                  name="isActive"
                  value={user.administrator.isActive ? "false" : "true"}
                />
                <p className="text-sm leading-relaxed text-muted">
                  Deactivation keeps role assignments for later restoration, but
                  blocks all administrator permissions while inactive.
                </p>
              </AdminActionForm>
            ) : user.isCurrentUser && user.canManageUsers ? (
              <p className="mt-6 rounded-xl bg-clay-50 p-4 text-sm text-clay-700">
                Self-deactivation is blocked. Ask another authorized administrator
                to change this profile.
              </p>
            ) : null}
          </section>
        </div>

        {roleAccess ? (
          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-h4 text-strong">System role assignments</h2>
                <p className="mt-2 text-sm text-muted">
                  Assign only pre-seeded system roles. Permission definitions cannot
                  be changed here.
                </p>
              </div>
              <p className="text-caption text-muted">
                {roleAccess.canManageRoles ? "Assignment enabled" : "Read only"}
              </p>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              {roleAccess.systemRoles.map((role) => {
                const assignedAt = assignedSystemRoles.get(role.slug);
                const isAssigned = assignedAt !== undefined;
                const ownerChangeAllowed =
                  role.slug !== "owner" ||
                  (roleAccess.actorIsOwner &&
                    !(user.isCurrentUser && isAssigned));
                const canMutate =
                  roleAccess.canManageRoles &&
                  ownerChangeAllowed &&
                  role.actorCanGrant &&
                  (isAssigned || user.emailVerified);

                return (
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
                      <span
                        className={`rounded-full px-3 py-1 text-caption font-semibold ${
                          isAssigned
                            ? "bg-sage-100 text-sage-700"
                            : "bg-white text-muted"
                        }`}
                      >
                        {isAssigned ? "Assigned" : "Not assigned"}
                      </span>
                    </div>
                    {role.description ? (
                      <p className="mt-3 text-sm leading-relaxed text-body">
                        {role.description}
                      </p>
                    ) : null}
                    {assignedAt ? (
                      <p className="mt-3 text-xs text-muted">
                        Assigned {formatDate(assignedAt)} UTC
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
                            className="rounded-full bg-white px-3 py-1 font-mono text-xs text-muted"
                          >
                            {permission.slug}
                          </li>
                        ))}
                      </ul>
                    </details>

                    {canMutate ? (
                      <AdminActionForm
                        action={
                          isAssigned
                            ? removeSystemRoleAction
                            : assignSystemRoleAction
                        }
                        submitLabel={isAssigned ? "Remove role" : "Assign role"}
                        className="mt-5 space-y-3"
                      >
                        <input
                          type="hidden"
                          name="userPublicId"
                          value={user.publicId}
                        />
                        <input type="hidden" name="roleSlug" value={role.slug} />
                      </AdminActionForm>
                    ) : role.slug === "owner" && !ownerChangeAllowed ? (
                      <p className="mt-5 text-xs leading-relaxed text-muted">
                        Owner access can only be changed by another owner. An owner
                        cannot remove their own owner role.
                      </p>
                    ) : !isAssigned && !user.emailVerified ? (
                      <p className="mt-5 text-xs leading-relaxed text-clay-700">
                        Verify this account&apos;s email ownership before assigning
                        an administrator role.
                      </p>
                    ) : !role.actorCanGrant ? (
                      <p className="mt-5 text-xs leading-relaxed text-muted">
                        You cannot assign or remove a system role containing
                        permissions your account does not hold.
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {roleAccess ? (
          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-h4 text-strong">Custom role assignments</h2>
                <p className="mt-2 text-sm text-muted">
                  Custom roles use the same verified-account and active-profile
                  safeguards as system roles. Assignments never change Owner policy.
                </p>
              </div>
              <Link
                href="/admin/users/roles"
                className="text-sm font-semibold text-sage-700"
              >
                Manage role definitions →
              </Link>
            </div>

            {roleAccess.customRoles.length ? (
              <div className="mt-6 grid gap-5 lg:grid-cols-2">
                {roleAccess.customRoles.map((role) => {
                  const assignedAt = assignedCustomRoles.get(role.publicId);
                  const isAssigned = assignedAt !== undefined;
                  const canMutate =
                    roleAccess.canManageRoles &&
                    role.canEdit &&
                    (isAssigned || user.emailVerified);

                  return (
                    <article
                      key={role.publicId}
                      className="rounded-xl border border-ink-900/[0.08] bg-surface-alt p-5"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="font-semibold text-strong">{role.name}</h3>
                          <p className="mt-1 font-mono text-xs text-muted">
                            {role.slug}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-caption font-semibold ${
                            isAssigned
                              ? "bg-sage-100 text-sage-700"
                              : "bg-white text-muted"
                          }`}
                        >
                          {isAssigned ? "Assigned" : "Not assigned"}
                        </span>
                      </div>
                      {role.description ? (
                        <p className="mt-3 text-sm leading-relaxed text-body">
                          {role.description}
                        </p>
                      ) : null}
                      {assignedAt ? (
                        <p className="mt-3 text-xs text-muted">
                          Assigned {formatDate(assignedAt)} UTC
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
                              className="rounded-full bg-white px-3 py-1 font-mono text-xs text-muted"
                            >
                              {permission.slug}
                            </li>
                          ))}
                        </ul>
                      </details>

                      {canMutate ? (
                        <AdminActionForm
                          action={
                            isAssigned
                              ? removeCustomRoleAction
                              : assignCustomRoleAction
                          }
                          submitLabel={isAssigned ? "Remove role" : "Assign role"}
                          className="mt-5 space-y-3"
                        >
                          <input
                            type="hidden"
                            name="userPublicId"
                            value={user.publicId}
                          />
                          <input
                            type="hidden"
                            name="rolePublicId"
                            value={role.publicId}
                          />
                        </AdminActionForm>
                      ) : !isAssigned && !user.emailVerified ? (
                        <p className="mt-5 text-xs leading-relaxed text-clay-700">
                          Verify this account&apos;s email ownership before assigning
                          an administrator role.
                        </p>
                      ) : !role.canEdit ? (
                        <p className="mt-5 text-xs leading-relaxed text-muted">
                          You cannot assign or remove a role containing permissions
                          your account does not hold.
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="mt-6 rounded-xl bg-surface-alt p-5 text-sm text-body">
                No custom roles exist. Create one from Roles and permissions.
              </p>
            )}
          </section>
        ) : null}
      </div>
    </section>
  );
}
