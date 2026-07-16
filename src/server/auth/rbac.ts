import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import {
  isPermissionGranted,
  type PermissionSlug,
} from "@/server/auth/permissions";
import { getCurrentSession, requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";

export async function readAdminAuthorization(userId: string) {
  const db = getDb();
  const account = await db.user.findUnique({
    where: { id: userId },
    select: {
      emailVerified: true,
      disabledAt: true,
      adminProfile: { select: { isActive: true } },
      roleAssignments: {
        select: {
          role: {
            select: {
              slug: true,
              permissions: {
                select: {
                  permission: { select: { slug: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const permissions = new Set<string>();
  const roles: string[] = [];

  for (const assignment of account?.roleAssignments ?? []) {
    roles.push(assignment.role.slug);
    for (const relation of assignment.role.permissions) {
      permissions.add(relation.permission.slug);
    }
  }

  return {
    isActiveAdmin:
      account?.emailVerified === true &&
      account.disabledAt === null &&
      account.adminProfile?.isActive === true,
    permissions,
    roles,
  };
}

const getAuthorization = cache(readAdminAuthorization);

export async function requirePermission(
  permission: PermissionSlug,
  returnTo = "/admin",
) {
  const session = await requireUser(returnTo);
  const authorization = await getAuthorization(session.user.id);

  if (
    !isPermissionGranted(
      authorization.isActiveAdmin,
      authorization.permissions,
      permission,
    )
  ) {
    redirect("/account?notice=admin-access-required");
  }

  return {
    session,
    roles: authorization.roles,
    permissions: authorization.permissions,
  };
}

export type ApiAuthorization =
  | {
      ok: true;
      session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;
      roles: string[];
      permissions: Set<string>;
    }
  | { ok: false; status: 401 | 403 };

/**
 * Permission check for JSON route handlers. Mirrors requirePermission but
 * reports the failure instead of issuing a page redirect, so API responses
 * stay machine-readable.
 */
export async function authorizeApiPermission(
  permission: PermissionSlug,
): Promise<ApiAuthorization> {
  const session = await getCurrentSession();
  if (!session) {
    return { ok: false, status: 401 };
  }

  const authorization = await getAuthorization(session.user.id);
  if (
    !isPermissionGranted(
      authorization.isActiveAdmin,
      authorization.permissions,
      permission,
    )
  ) {
    return { ok: false, status: 403 };
  }

  return {
    ok: true,
    session,
    roles: authorization.roles,
    permissions: authorization.permissions,
  };
}
