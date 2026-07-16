import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type {
  AdminAuditEntryDto,
  AdminUserDetailDto,
  AdminUserRoleAccessDto,
  AdminUserSummaryDto,
  SystemRoleDto,
} from "@/server/admin/access/dto";
import { loadCustomRolesForAssignment } from "@/server/admin/access/role-queries";
import {
  auditFilterSchema,
  DEFAULT_AUDIT_FILTERS,
  type AuditFilters,
} from "@/server/admin/access/validators";
import { publicIdSchema } from "@/server/admin/audit/validation";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";

type SearchParameter = string | string[] | undefined;

function mapUserSummary(row: {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  adminProfile: {
    isActive: boolean;
    jobTitle: string | null;
  } | null;
}): AdminUserSummaryDto {
  return {
    publicId: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    administrator: {
      exists: row.adminProfile !== null,
      isActive: row.adminProfile?.isActive === true,
      jobTitle: row.adminProfile?.jobTitle ?? null,
    },
  };
}

const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  createdAt: true,
  updatedAt: true,
  adminProfile: {
    select: {
      isActive: true,
      jobTitle: true,
    },
  },
} as const;

export async function getAdminUserIndex() {
  const authorization = await requirePermission("users.read", "/admin/users");
  const rows = await getDb().user.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
    select: safeUserSelect,
  });

  return {
    currentUserPublicId: authorization.session.user.id,
    canManageUsers: authorization.permissions.has("users.manage"),
    canReadRoles: authorization.permissions.has("roles.read"),
    canReadAudit: authorization.permissions.has("audit.read"),
    users: rows.map(mapUserSummary),
  };
}

export async function getAdminUserDetail(
  candidatePublicId: string,
): Promise<AdminUserDetailDto | null> {
  const parsedId = publicIdSchema.safeParse(candidatePublicId);
  const returnTo = parsedId.success
    ? `/admin/users/${parsedId.data}`
    : "/admin/users";
  const authorization = await requirePermission("users.read", returnTo);
  if (!parsedId.success) return null;

  const row = await getDb().user.findUnique({
    where: { id: parsedId.data },
    select: safeUserSelect,
  });
  if (!row) return null;

  return {
    ...mapUserSummary(row),
    isCurrentUser: row.id === authorization.session.user.id,
    canManageUsers: authorization.permissions.has("users.manage"),
    canReadRoles: authorization.permissions.has("roles.read"),
  };
}

async function loadSystemRoles(
  actorPermissions: ReadonlySet<string>,
): Promise<SystemRoleDto[]> {
  const rows = await getDb().role.findMany({
    where: { isSystem: true },
    orderBy: [{ slug: "asc" }],
    select: {
      slug: true,
      name: true,
      description: true,
      permissions: {
        orderBy: { permission: { slug: "asc" } },
        select: {
          permission: {
            select: {
              slug: true,
              name: true,
              description: true,
            },
          },
        },
      },
      _count: { select: { userAssignments: true } },
    },
  });

  return rows.map((row) => {
    const permissions = row.permissions.map(({ permission }) => permission);
    return {
      slug: row.slug,
      name: row.name,
      description: row.description,
      assignmentCount: row._count.userAssignments,
      actorCanGrant: permissions.every(({ slug }) =>
        actorPermissions.has(slug),
      ),
      permissions,
    };
  });
}

export async function getSystemRoleMatrix() {
  const authorization = await requirePermission("roles.read", "/admin/users");
  return {
    canManageRoles: authorization.permissions.has("roles.manage"),
    roles: await loadSystemRoles(authorization.permissions),
  };
}

export async function getAdminUserRoleAccess(
  candidatePublicId: string,
): Promise<AdminUserRoleAccessDto | null> {
  const parsedId = publicIdSchema.safeParse(candidatePublicId);
  const returnTo = parsedId.success
    ? `/admin/users/${parsedId.data}`
    : "/admin/users";
  const authorization = await requirePermission("roles.read", returnTo);
  if (!parsedId.success) return null;

  const target = await getDb().user.findUnique({
    where: { id: parsedId.data },
    select: {
      id: true,
      roleAssignments: {
        orderBy: { role: { slug: "asc" } },
        select: {
          createdAt: true,
          role: {
            select: { publicId: true, slug: true, isSystem: true },
          },
        },
      },
    },
  });
  if (!target) return null;

  return {
    publicId: target.id,
    actorIsOwner: authorization.roles.includes("owner"),
    canManageRoles: authorization.permissions.has("roles.manage"),
    assignments: target.roleAssignments.map((assignment) => ({
      rolePublicId: assignment.role.publicId,
      roleSlug: assignment.role.slug,
      isSystem: assignment.role.isSystem,
      assignedAt: assignment.createdAt.toISOString(),
    })),
    systemRoles: await loadSystemRoles(authorization.permissions),
    customRoles: await loadCustomRolesForAssignment(authorization.permissions),
  };
}

function parseAuditFilters(
  searchParams: Record<string, SearchParameter>,
): { filters: AuditFilters; validationError: boolean } {
  const parsed = auditFilterSchema.safeParse(searchParams);
  if (parsed.success) {
    return { filters: parsed.data, validationError: false };
  }
  return { filters: DEFAULT_AUDIT_FILTERS, validationError: true };
}

function nextUtcDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function auditWhere(filters: AuditFilters): Prisma.AuditLogWhereInput {
  return {
    ...(filters.action
      ? { action: { contains: filters.action, mode: "insensitive" as const } }
      : {}),
    ...(filters.resourceType
      ? {
          resourceType: {
            contains: filters.resourceType,
            mode: "insensitive" as const,
          },
        }
      : {}),
    ...(filters.actorPublicId
      ? { actorUserId: filters.actorPublicId }
      : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from
              ? { gte: new Date(`${filters.from}T00:00:00.000Z`) }
              : {}),
            ...(filters.to ? { lt: nextUtcDay(filters.to) } : {}),
          },
        }
      : {}),
  };
}

export async function getAdminAuditIndex(
  searchParams: Record<string, SearchParameter>,
) {
  await requirePermission("audit.read", "/admin/audit");
  const { filters, validationError } = parseAuditFilters(searchParams);
  const db = getDb();
  const where = auditWhere(filters);
  const total = await db.auditLog.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));
  const page = Math.min(filters.page, pageCount);
  const rows = await db.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * filters.pageSize,
    take: filters.pageSize,
    select: {
      id: true,
      action: true,
      resourceType: true,
      resourceId: true,
      createdAt: true,
      actor: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  const entries: AdminAuditEntryDto[] = rows.map((row) => ({
    id: row.id.toString(),
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    createdAt: row.createdAt.toISOString(),
    actor: row.actor
      ? {
          publicId: row.actor.id,
          name: row.actor.name,
          email: row.actor.email,
        }
      : null,
  }));

  return {
    entries,
    filters: { ...filters, page },
    validationError,
    pagination: {
      page,
      pageSize: filters.pageSize,
      pageCount,
      total,
    },
  };
}
