import type { AdminRoleDto } from "@/server/admin/access/role-dto";

export type AdminUserSummaryDto = {
  publicId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  administrator: {
    exists: boolean;
    isActive: boolean;
    jobTitle: string | null;
  };
};

export type AdminUserDetailDto = AdminUserSummaryDto & {
  isCurrentUser: boolean;
  canManageUsers: boolean;
  canReadRoles: boolean;
};

export type SystemRoleDto = {
  slug: string;
  name: string;
  description: string | null;
  assignmentCount: number;
  actorCanGrant: boolean;
  permissions: Array<{
    slug: string;
    name: string;
    description: string | null;
  }>;
};

export type AdminUserRoleAccessDto = {
  publicId: string;
  actorIsOwner: boolean;
  canManageRoles: boolean;
  assignments: Array<{
    rolePublicId: string;
    roleSlug: string;
    isSystem: boolean;
    assignedAt: string;
  }>;
  systemRoles: SystemRoleDto[];
  customRoles: AdminRoleDto[];
};

export type AdminAuditEntryDto = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  createdAt: string;
  actor: {
    publicId: string;
    name: string;
    email: string;
  } | null;
};
