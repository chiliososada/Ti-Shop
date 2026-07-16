"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

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
  disableAdminCustomerAccount,
  restoreAdminCustomerAccount,
  updateAdminCustomerProfile,
} from "@/server/admin/customers/mutations";
import {
  DISABLE_CUSTOMER_ACCOUNT_FIELDS,
  RESTORE_CUSTOMER_ACCOUNT_FIELDS,
  UPDATE_CUSTOMER_PROFILE_FIELDS,
  disableCustomerAccountSchema,
  restoreCustomerAccountSchema,
  updateCustomerProfileSchema,
} from "@/server/admin/customers/validators";

type CustomersActionState = AdminActionState & {
  refreshPending?: boolean;
};

const MAX_CUSTOMER_REVALIDATION_TARGETS = 2;

function revalidateCustomer(
  errorScope: `${string}.cache-refresh`,
  customerPublicId: string,
) {
  const targets = new Set([
    "/admin/customers",
    `/admin/customers/${customerPublicId}`,
  ]);
  let refreshPending = false;

  if (targets.size > MAX_CUSTOMER_REVALIDATION_TARGETS) {
    refreshPending = true;
    logUnexpectedAdminActionError(
      errorScope,
      new Error("Customer cache refresh target limit was exceeded."),
    );
  }

  for (const path of [...targets].slice(0, MAX_CUSTOMER_REVALIDATION_TARGETS)) {
    try {
      revalidatePath(path);
    } catch (error) {
      unstable_rethrow(error);
      refreshPending = true;
      logUnexpectedAdminActionError(errorScope, error);
    }
  }

  return refreshPending;
}

function committedCustomerSuccess(
  message: string,
  refreshPending: boolean,
): CustomersActionState {
  if (!refreshPending) return actionSuccess(message);
  return {
    status: "success",
    message: `${message} The database operation is committed, but one or more affected page refreshes may be delayed. Do not resubmit this form; reload the affected page later.`,
    refreshPending: true,
  };
}

function accountControlFailure(reason: string) {
  switch (reason) {
    case "confirmation_mismatch":
      return actionFailure(
        "The confirmation email did not match this customer account.",
      );
    case "permission_changed":
      return actionFailure(
        "Your account-control permission changed. Refresh before trying again.",
      );
    default:
      return actionFailure(
        "This account is not eligible for customer account controls.",
      );
  }
}

export async function updateCustomerProfileAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<CustomersActionState> {
  const fields = readStrictFormData(
    formData,
    UPDATE_CUSTOMER_PROFILE_FIELDS,
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = updateCustomerProfileSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminCustomerProfile>>;
  try {
    result = await updateAdminCustomerProfile(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("customers.profile.update", error);
    return actionFailure("The customer profile could not be saved. Try again.");
  }
  if (!result.ok) {
    return actionFailure("The customer account could not be found.");
  }
  const refreshPending = revalidateCustomer(
    "customers.profile.update.cache-refresh",
    result.publicId,
  );
  return committedCustomerSuccess("Customer profile saved.", refreshPending);
}

export async function disableCustomerAccountAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<CustomersActionState> {
  const fields = readStrictFormData(
    formData,
    DISABLE_CUSTOMER_ACCOUNT_FIELDS,
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = disableCustomerAccountSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof disableAdminCustomerAccount>>;
  try {
    result = await disableAdminCustomerAccount(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("customers.account.disable", error);
    return actionFailure("The customer account could not be disabled. Try again.");
  }
  if (!result.ok) return accountControlFailure(result.reason);
  const refreshPending = revalidateCustomer(
    "customers.account.disable.cache-refresh",
    result.publicId,
  );
  return committedCustomerSuccess(
    result.duplicate
      ? "The account was already disabled. Any remaining sessions were revoked."
      : `Customer account disabled. ${result.revokedSessionCount} active session${result.revokedSessionCount === 1 ? " was" : "s were"} revoked.`,
    refreshPending,
  );
}

export async function restoreCustomerAccountAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<CustomersActionState> {
  const fields = readStrictFormData(
    formData,
    RESTORE_CUSTOMER_ACCOUNT_FIELDS,
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = restoreCustomerAccountSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof restoreAdminCustomerAccount>>;
  try {
    result = await restoreAdminCustomerAccount(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("customers.account.restore", error);
    return actionFailure("The customer account could not be restored. Try again.");
  }
  if (!result.ok) return accountControlFailure(result.reason);
  const refreshPending = revalidateCustomer(
    "customers.account.restore.cache-refresh",
    result.publicId,
  );
  return committedCustomerSuccess(
    result.duplicate
      ? "The account was already active. No previous session was restored."
      : "Customer account restored. The customer must sign in again.",
    refreshPending,
  );
}
