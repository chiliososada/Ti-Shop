import "server-only";

import type {
  AdminCustomRoleDetailDto,
  AdminRoleDto,
} from "@/server/admin/access/role-dto";
import { publicIdSchema } from "@/server/admin/audit/validation";
import { PERMISSION_SLUGS } from "@/server/auth/permissions";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";

const roleSelect = {
  publicId: true,
  slug: true,
  name: true,
  description: true,
  isSystem: true,
  permissions: {
    orderBy: { permission: { slug: "asc" as const } },
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
} as const;

function mapRole(
  row: {
    publicId: string;
    slug: string;
    name: string;
    description: string | null;
    isSystem: boolean;
    permissions: Array<{
      permission: {
        slug: string;
        name: string;
        description: string | null;
      };
    }>;
    _count: { userAssignments: number };
  },
  canManageRoles: boolean,
  actorPermissions: ReadonlySet<string>,
): AdminRoleDto {
  const permissions = row.permissions.map(({ permission }) => permission);
  return {
    publicId: row.publicId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    assignmentCount: row._count.userAssignments,
    permissions,
    canEdit:
      !row.isSystem &&
      canManageRoles &&
      permissions.every(({ slug }) => actorPermissions.has(slug)),
  };
}

export async function getAdminRoleIndex() {
  const authorization = await requirePermission(
    "roles.read",
    "/admin/users/roles",
  );
  const rows = await getDb().role.findMany({
    orderBy: [{ isSystem: "desc" }, { name: "asc" }, { publicId: "asc" }],
    select: roleSelect,
  });
  const canManageRoles = authorization.permissions.has("roles.manage");

  return {
    canManageRoles,
    roles: rows.map((row) =>
      mapRole(row, canManageRoles, authorization.permissions),
    ),
  };
}

export async function getCustomRoleCreateContext() {
  const authorization = await requirePermission(
    "roles.manage",
    "/admin/users/roles/new",
  );
  const actorSlugs = PERMISSION_SLUGS.filter((slug) =>
    authorization.permissions.has(slug),
  );
  const permissionOptions = await getDb().permission.findMany({
    where: { slug: { in: actorSlugs } },
    orderBy: { slug: "asc" },
    select: { slug: true, name: true, description: true },
  });

  return { permissionOptions };
}

export async function getCustomRoleDetail(
  candidatePublicId: string,
): Promise<AdminCustomRoleDetailDto | null> {
  const parsedId = publicIdSchema.safeParse(candidatePublicId);
  const returnTo = parsedId.success
    ? `/admin/users/roles/${parsedId.data}`
    : "/admin/users/roles";
  const authorization = await requirePermission("roles.read", returnTo);
  if (!parsedId.success) return null;

  const [row, allPermissions] = await Promise.all([
    getDb().role.findFirst({
      where: { publicId: parsedId.data, isSystem: false },
      select: roleSelect,
    }),
    getDb().permission.findMany({
      where: { slug: { in: [...PERMISSION_SLUGS] } },
      orderBy: { slug: "asc" },
      select: { slug: true, name: true, description: true },
    }),
  ]);
  if (!row) return null;

  const canManageRoles = authorization.permissions.has("roles.manage");
  const role = mapRole(row, canManageRoles, authorization.permissions);
  const selected = new Set(role.permissions.map(({ slug }) => slug));

  return {
    ...role,
    permissionOptions: allPermissions.map((permission) => ({
      ...permission,
      actorGranted: authorization.permissions.has(permission.slug),
      selected: selected.has(permission.slug),
    })),
  };
}

export async function loadCustomRolesForAssignment(
  actorPermissions: ReadonlySet<string>,
) {
  const rows = await getDb().role.findMany({
    where: { isSystem: false },
    orderBy: [{ name: "asc" }, { publicId: "asc" }],
    select: roleSelect,
  });

  return rows.map((row) =>
    mapRole(
      row,
      actorPermissions.has("roles.manage"),
      actorPermissions,
    ),
  );
}
