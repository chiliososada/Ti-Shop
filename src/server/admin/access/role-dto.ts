export type AdminPermissionDto = {
  slug: string;
  name: string;
  description: string | null;
};

export type AdminRoleDto = {
  publicId: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  assignmentCount: number;
  permissions: AdminPermissionDto[];
  canEdit: boolean;
};

export type AdminCustomRoleDetailDto = AdminRoleDto & {
  permissionOptions: Array<
    AdminPermissionDto & {
      actorGranted: boolean;
      selected: boolean;
    }
  >;
};
