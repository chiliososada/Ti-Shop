"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import {
  assignAdminSystemRole,
  removeAdminSystemRole,
  setAdminProfileActive,
} from "@/server/admin/access/mutations";
import {
  assignAdminCustomRole,
  type CustomRoleMutationResult,
  removeAdminCustomRole,
} from "@/server/admin/access/role-mutations";
import {
  CUSTOM_ROLE_ASSIGNMENT_FIELDS,
  customRoleAssignmentSchema,
  type CustomRoleAssignmentInput,
} from "@/server/admin/access/role-validators";
import {
  ADMIN_STATUS_FIELDS,
  adminStatusSchema,
  ROLE_ASSIGNMENT_FIELDS,
  roleAssignmentSchema,
  type RoleAssignmentInput,
} from "@/server/admin/access/validators";
import {
  actionFailure,
  actionSuccess,
  formDataFailure,
  logUnexpectedAdminActionError,
  type AdminActionState,
  validationFailure,
} from "@/server/admin/audit/action-state";
import { readStrictFormData } from "@/server/admin/audit/form-data";
import { requirePermission } from "@/server/auth/rbac";

type MutationResult = Awaited<ReturnType<typeof assignAdminSystemRole>>;

export type AccessActionState = AdminActionState & {
  refreshPending?: boolean;
};

function failureFor(result: Extract<MutationResult, { ok: false }>) {
  switch (result.reason) {
    case "account_disabled":
      return actionFailure(
        "Restore the customer account before granting or enabling administrator access.",
      );
    case "email_unverified":
      return actionFailure(
        "Administrator access requires a verified email address. Verify account ownership before assigning a role or enabling the profile.",
      );
    case "not_found":
      return actionFailure("The user account could not be found.");
    case "system_role_not_found":
      return actionFailure("That system role no longer exists. Refresh and try again.");
    case "owner_required":
      return actionFailure("Only an owner can change owner access.");
    case "self_owner_removal":
      return actionFailure("You cannot remove your own owner role.");
    case "self_deactivation":
      return actionFailure("You cannot deactivate your own administrator profile.");
    case "last_active_owner":
      return actionFailure("The final active owner cannot be removed or deactivated.");
    case "permission_changed":
      return actionFailure("Your administrator access changed. Refresh before trying again.");
    case "permission_escalation":
      return actionFailure(
        "You cannot change access for a role or administrator account containing permissions you do not currently hold.",
      );
  }
}

const MAX_ACCESS_REVALIDATION_TARGETS = 6;

function revalidateAccessPages(
  userPublicId: string,
  errorScope: `${string}.cache-refresh`,
  rolePublicId?: string,
) {
  const targets = new Set([
    "/admin",
    "/admin/users",
    `/admin/users/${userPublicId}`,
    "/admin/users/roles",
    "/admin/audit",
    ...(rolePublicId ? [`/admin/users/roles/${rolePublicId}`] : []),
  ]);
  let firstError: unknown;
  if (targets.size > MAX_ACCESS_REVALIDATION_TARGETS) {
    firstError = new Error("Access cache refresh target limit was exceeded.");
  }

  for (const path of [...targets].slice(0, MAX_ACCESS_REVALIDATION_TARGETS)) {
    try {
      revalidatePath(path);
    } catch (error) {
      unstable_rethrow(error);
      firstError ??= error;
    }
  }

  if (firstError !== undefined) {
    logUnexpectedAdminActionError(errorScope, firstError);
    return true;
  }
  return false;
}

function committedAccessSuccess(
  message: string,
  refreshPending: boolean,
): AccessActionState {
  if (!refreshPending) return actionSuccess(message);
  return {
    status: "success",
    message: `${message} The database operation is committed, but one or more administration page refreshes may be delayed. Do not resubmit solely to retry the refresh; reload the affected page later.`,
    refreshPending: true,
  };
}

function customRoleFailure(
  result: Extract<CustomRoleMutationResult, { ok: false }>,
) {
  switch (result.reason) {
    case "account_disabled":
      return actionFailure(
        "Restore the customer account before granting administrator access.",
      );
    case "email_unverified":
      return actionFailure(
        "Verify this account's email ownership before assigning an administrator role.",
      );
    case "not_found":
      return actionFailure("The user account could not be found.");
    case "custom_role_not_found":
      return actionFailure("That custom role no longer exists. Refresh and try again.");
    case "system_role_protected":
      return actionFailure("Use the system-role controls for seeded system roles.");
    case "permission_changed":
      return actionFailure(
        "Your administrator access changed. Refresh before trying again.",
      );
    case "permission_escalation":
      return actionFailure(
        "You cannot assign or remove a role containing permissions you do not currently hold.",
      );
    case "permission_not_found":
    case "role_in_use":
    case "submission_conflict":
      return actionFailure("The custom role assignment could not be updated.");
  }
}

async function customRoleAction(
  formData: FormData,
  operation: (
    input: CustomRoleAssignmentInput,
  ) => Promise<CustomRoleMutationResult>,
  successMessage: string,
  duplicateMessage: string,
  errorScope: string,
): Promise<AccessActionState> {
  const fields = readStrictFormData(formData, CUSTOM_ROLE_ASSIGNMENT_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = customRoleAssignmentSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: CustomRoleMutationResult;
  try {
    result = await operation(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError(errorScope, error);
    return actionFailure("The custom role assignment could not be updated. Try again.");
  }
  if (!result.ok) return customRoleFailure(result);

  const refreshPending = revalidateAccessPages(
    result.userPublicId ?? parsed.data.userPublicId,
    `${errorScope}.cache-refresh`,
    result.rolePublicId,
  );
  return committedAccessSuccess(
    result.duplicate ? duplicateMessage : successMessage,
    refreshPending,
  );
}

async function roleAction(
  formData: FormData,
  operation: (input: RoleAssignmentInput) => Promise<MutationResult>,
  successMessage: string,
  duplicateMessage: string,
  errorScope: string,
): Promise<AccessActionState> {
  const fields = readStrictFormData(formData, ROLE_ASSIGNMENT_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = roleAssignmentSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: MutationResult;
  try {
    result = await operation(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError(errorScope, error);
    return actionFailure("Administrator access could not be updated. Try again.");
  }
  if (!result.ok) return failureFor(result);

  const refreshPending = revalidateAccessPages(
    result.userPublicId,
    `${errorScope}.cache-refresh`,
  );
  return committedAccessSuccess(
    result.duplicate ? duplicateMessage : successMessage,
    refreshPending,
  );
}

export async function assignSystemRoleAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AccessActionState> {
  // Server Actions are independent entry points; page authorization is not
  // inherited. The DAL repeats this check before opening its transaction.
  await requirePermission("roles.manage", "/admin/users");
  return roleAction(
    formData,
    assignAdminSystemRole,
    "System role assigned.",
    "The user already has this system role.",
    "admin.access.role.assign",
  );
}

export async function removeSystemRoleAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AccessActionState> {
  await requirePermission("roles.manage", "/admin/users");
  return roleAction(
    formData,
    removeAdminSystemRole,
    "System role removed.",
    "The role was already absent.",
    "admin.access.role.remove",
  );
}

export async function setAdminProfileActiveAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AccessActionState> {
  await requirePermission("users.manage", "/admin/users");
  const fields = readStrictFormData(formData, ADMIN_STATUS_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = adminStatusSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: MutationResult;
  try {
    result = await setAdminProfileActive(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("admin.access.profile.status", error);
    return actionFailure("Administrator status could not be updated. Try again.");
  }
  if (!result.ok) return failureFor(result);

  const refreshPending = revalidateAccessPages(
    result.userPublicId,
    "admin.access.profile.status.cache-refresh",
  );
  return committedAccessSuccess(
    result.duplicate
      ? "Administrator status was already up to date."
      : parsed.data.isActive
        ? "Administrator profile enabled."
        : "Administrator profile disabled.",
    refreshPending,
  );
}

export async function assignCustomRoleAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AccessActionState> {
  await requirePermission("roles.manage", "/admin/users");
  return customRoleAction(
    formData,
    assignAdminCustomRole,
    "Custom role assigned.",
    "The user already has this custom role.",
    "admin.access.custom_role.assign",
  );
}

export async function removeCustomRoleAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AccessActionState> {
  await requirePermission("roles.manage", "/admin/users");
  return customRoleAction(
    formData,
    removeAdminCustomRole,
    "Custom role removed.",
    "The role was already absent.",
    "admin.access.custom_role.remove",
  );
}
