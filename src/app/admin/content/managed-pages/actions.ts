"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import {
  actionFailure,
  formDataFailure,
  logUnexpectedAdminActionError,
  type AdminActionState,
  validationFailure,
} from "@/server/admin/audit/action-state";
import { readStrictFormData } from "@/server/admin/audit/form-data";
import { upsertAdminManagedPage } from "@/server/admin/content/managed-page-mutations";
import {
  MANAGED_PAGE_FORM_FIELDS,
  managedPageFormSchema,
} from "@/server/admin/content/validators";

export type ManagedPageActionState = AdminActionState & {
  refreshPending?: boolean;
};

const MAX_MANAGED_PAGE_REVALIDATION_TARGETS = 8;

function revalidateManagedPage(result: {
  adminSlug: string;
  publicPath: string;
}) {
  const targets = new Set([
    "/admin/content",
    "/admin/content/managed-pages",
    `/admin/content/managed-pages/${result.adminSlug}`,
    "/admin/seo",
    result.publicPath,
    "/sitemap.xml",
  ]);
  if (targets.size > MAX_MANAGED_PAGE_REVALIDATION_TARGETS) {
    throw new Error("Managed page cache refresh target limit was exceeded.");
  }

  let firstError: unknown;
  for (const path of targets) {
    try {
      revalidatePath(path);
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) throw firstError;
}

export async function saveManagedPageAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<ManagedPageActionState> {
  const fields = readStrictFormData(formData, MANAGED_PAGE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = managedPageFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof upsertAdminManagedPage>>;
  try {
    result = await upsertAdminManagedPage(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("content.managed_page.save", error);
    return actionFailure("The managed page could not be saved. Try again.");
  }

  if (!result.ok) {
    if (result.reason === "permission_changed") {
      return actionFailure(
        "Your content-management permission changed. Refresh before trying again.",
      );
    }
    if (result.reason === "slug_conflict") {
      return actionFailure(
        "A legacy standalone page occupies this managed route's reserved internal slug. Resolve that collision before saving.",
      );
    }
    return actionFailure("The managed storefront page could not be found.");
  }

  let refreshPending = false;
  try {
    revalidateManagedPage(result);
  } catch (error) {
    refreshPending = true;
    logUnexpectedAdminActionError(
      "content.managed_page.cache-refresh",
      error,
    );
  }

  const committedMessage = result.duplicate
    ? "No content changes were needed."
    : "Managed page saved.";
  return {
    status: "success",
    message: refreshPending
      ? `${committedMessage} The database operation is committed, but one or more administration or storefront refreshes may be delayed. Do not resubmit solely to recover the refresh; reload the affected page later.`
      : committedMessage,
    refreshPending,
  };
}
