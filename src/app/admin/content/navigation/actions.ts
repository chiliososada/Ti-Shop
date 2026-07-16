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
  createAdminNavigation,
  createAdminNavigationItem,
  updateAdminNavigation,
  updateAdminNavigationItem,
} from "@/server/admin/navigation/mutations";
import {
  NAVIGATION_CREATE_FORM_FIELDS,
  NAVIGATION_ITEM_CREATE_FORM_FIELDS,
  NAVIGATION_ITEM_UPDATE_FORM_FIELDS,
  NAVIGATION_UPDATE_FORM_FIELDS,
  navigationCreateFormSchema,
  navigationItemCreateFormSchema,
  navigationItemUpdateFormSchema,
  navigationUpdateFormSchema,
} from "@/server/admin/navigation/validators";

type RevalidationTarget = {
  path: string;
  type?: "page" | "layout";
};

const MAX_NAVIGATION_REVALIDATION_TARGETS = 6;

function revalidateNavigation(scope: string, publicId?: string) {
  const targets: RevalidationTarget[] = [
    { path: "/admin/content" },
    { path: "/admin/content/navigation" },
    ...(publicId
      ? [{ path: `/admin/content/navigation/${publicId}` }]
      : []),
    { path: "/", type: "layout" },
  ];
  const uniqueTargets = new Map<string, RevalidationTarget>();
  for (const target of targets) {
    uniqueTargets.set(`${target.path}:${target.type ?? "literal"}`, target);
  }

  let refreshPending = false;
  if (uniqueTargets.size > MAX_NAVIGATION_REVALIDATION_TARGETS) {
    refreshPending = true;
    logUnexpectedAdminActionError(
      `${scope}.cache-refresh`,
      new Error("Navigation cache refresh target limit was exceeded."),
    );
  }
  for (const target of [...uniqueTargets.values()].slice(
    0,
    MAX_NAVIGATION_REVALIDATION_TARGETS,
  )) {
    try {
      revalidatePath(target.path, target.type);
    } catch (error) {
      unstable_rethrow(error);
      refreshPending = true;
      logUnexpectedAdminActionError(`${scope}.cache-refresh`, error);
    }
  }
  return refreshPending;
}

function committedNavigationSuccess(
  message: string,
  refreshPending: boolean,
) {
  return actionSuccess(
    refreshPending
      ? `${message} The database operation is committed, but one or more administration or storefront cache refreshes may be delayed. Do not resubmit this form; reload the affected page later.`
      : message,
  );
}

function mutationFailure(reason: string) {
  if (reason === "permission_changed") {
    return actionFailure(
      "Your content permission changed before the update completed. Refresh and try again.",
    );
  }
  if (reason === "key_conflict") {
    return actionFailure("That navigation key is already in use.");
  }
  if (reason === "idempotency_conflict") {
    return actionFailure(
      "This submission identifier was already used for different data. Refresh and try again.",
    );
  }
  if (reason === "item_limit") {
    return actionFailure(
      "This navigation already has the maximum 100 first-level links.",
    );
  }
  return actionFailure("The navigation record could not be found.");
}

export async function createNavigationAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, NAVIGATION_CREATE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = navigationCreateFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof createAdminNavigation>>;
  try {
    result = await createAdminNavigation(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("content.navigation.create", error);
    return actionFailure("The navigation could not be created. Try again.");
  }
  if (!result.ok) return mutationFailure(result.reason);
  const refreshPending = revalidateNavigation(
    "content.navigation.create",
    result.publicId,
  );
  if (refreshPending) {
    return committedNavigationSuccess("Navigation created.", true);
  }
  redirect(`/admin/content/navigation/${result.publicId}`);
}

export async function updateNavigationAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, NAVIGATION_UPDATE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = navigationUpdateFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminNavigation>>;
  try {
    result = await updateAdminNavigation(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("content.navigation.update", error);
    return actionFailure("The navigation could not be saved. Try again.");
  }
  if (!result.ok) return mutationFailure(result.reason);
  const refreshPending = revalidateNavigation(
    "content.navigation.update",
    result.publicId,
  );
  return committedNavigationSuccess(
    result.duplicate ? "Navigation was already up to date." : "Navigation saved.",
    refreshPending,
  );
}

export async function createNavigationItemAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(
    formData,
    NAVIGATION_ITEM_CREATE_FORM_FIELDS,
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = navigationItemCreateFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof createAdminNavigationItem>>;
  try {
    result = await createAdminNavigationItem(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("content.navigation_item.create", error);
    return actionFailure("The navigation link could not be created. Try again.");
  }
  if (!result.ok) return mutationFailure(result.reason);
  const refreshPending = revalidateNavigation(
    "content.navigation_item.create",
    result.navigationPublicId,
  );
  return committedNavigationSuccess(
    result.duplicate ? "Link was already created." : "Link created.",
    refreshPending,
  );
}

export async function updateNavigationItemAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(
    formData,
    NAVIGATION_ITEM_UPDATE_FORM_FIELDS,
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = navigationItemUpdateFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminNavigationItem>>;
  try {
    result = await updateAdminNavigationItem(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("content.navigation_item.update", error);
    return actionFailure("The navigation link could not be saved. Try again.");
  }
  if (!result.ok) return mutationFailure(result.reason);
  const refreshPending = revalidateNavigation(
    "content.navigation_item.update",
    result.navigationPublicId,
  );
  return committedNavigationSuccess(
    result.duplicate ? "Link was already up to date." : "Link saved.",
    refreshPending,
  );
}
