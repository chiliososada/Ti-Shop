"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import {
  actionFailure,
  actionSuccess,
  formDataFailure,
  logUnexpectedAdminActionError,
  type AdminActionState,
  validationFailure,
} from "@/server/admin/audit/action-state";
import { readStrictFormData } from "@/server/admin/audit/form-data";
import {
  createCustomRole,
  deleteCustomRole,
  type CustomRoleMutationResult,
  updateCustomRole,
} from "@/server/admin/access/role-mutations";
import {
  CUSTOM_ROLE_CREATE_FIELDS,
  CUSTOM_ROLE_DELETE_FIELDS,
  CUSTOM_ROLE_UPDATE_FIELDS,
  customRoleCreateSchema,
  customRoleDeleteSchema,
  customRoleUpdateSchema,
} from "@/server/admin/access/role-validators";
import { requirePermission } from "@/server/auth/rbac";

function mutationFailure(
  result: Extract<CustomRoleMutationResult, { ok: false }>,
) {
  switch (result.reason) {
    case "permission_changed":
      return actionFailure(
        "Your administrator access changed. Refresh before trying again.",
      );
    case "permission_escalation":
      return actionFailure(
        "A role can contain only permissions you currently hold.",
      );
    case "permission_not_found":
      return actionFailure(
        "One or more permissions are no longer available. Refresh and try again.",
      );
    case "custom_role_not_found":
      return actionFailure("That custom role could not be found.");
    case "system_role_protected":
      return actionFailure(
        "System roles are immutable and cannot be changed or deleted here.",
      );
    case "role_in_use":
      return actionFailure(
        "Remove this role from every administrator before deleting it.",
      );
    case "submission_conflict":
      return actionFailure(
        "This create form was already used with different values. Refresh and try again.",
      );
    case "account_disabled":
    case "email_unverified":
    case "not_found":
      return actionFailure("The requested role operation is no longer available.");
  }
}

function revalidateRolePages(rolePublicId?: string) {
  const paths = [
    "/admin",
    "/admin/users",
    "/admin/users/roles",
    "/admin/audit",
    ...(rolePublicId ? [`/admin/users/roles/${rolePublicId}`] : []),
  ];
  let refreshPending = false;
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch (error) {
      refreshPending = true;
      logUnexpectedAdminActionError("admin.role.revalidate", error);
    }
  }
  return refreshPending;
}

export async function createCustomRoleAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requirePermission("roles.manage", "/admin/users/roles/new");
  const fields = readStrictFormData(formData, CUSTOM_ROLE_CREATE_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = customRoleCreateSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  try {
    const result = await createCustomRole(parsed.data);
    if (!result.ok) return mutationFailure(result);
    revalidateRolePages(result.rolePublicId);
    redirect(`/admin/users/roles/${result.rolePublicId}`);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("admin.role.create", error);
    return actionFailure("The custom role could not be created. Try again.");
  }
}

export async function updateCustomRoleAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requirePermission("roles.manage", "/admin/users/roles");
  const fields = readStrictFormData(formData, CUSTOM_ROLE_UPDATE_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = customRoleUpdateSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  try {
    const result = await updateCustomRole(parsed.data);
    if (!result.ok) return mutationFailure(result);
    const refreshPending = revalidateRolePages(result.rolePublicId);
    return actionSuccess(
      refreshPending
        ? "Role saved. Some administration pages may need a manual refresh."
        : result.duplicate
          ? "The role was already up to date."
          : "Custom role saved.",
    );
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("admin.role.update", error);
    return actionFailure("The custom role could not be saved. Try again.");
  }
}

export async function deleteCustomRoleAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requirePermission("roles.manage", "/admin/users/roles");
  const fields = readStrictFormData(formData, CUSTOM_ROLE_DELETE_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = customRoleDeleteSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  try {
    const result = await deleteCustomRole(parsed.data);
    if (!result.ok) return mutationFailure(result);
    revalidateRolePages(result.rolePublicId);
    redirect("/admin/users/roles");
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("admin.role.delete", error);
    return actionFailure("The custom role could not be deleted. Try again.");
  }
}
