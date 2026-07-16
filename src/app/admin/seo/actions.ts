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
  createAdminRedirect,
  updateAdminRedirect,
  updateAdminSeo,
} from "@/server/admin/seo/mutations";
import {
  REDIRECT_CREATE_FORM_FIELDS,
  REDIRECT_UPDATE_FORM_FIELDS,
  SEO_FORM_FIELDS,
  redirectCreateFormSchema,
  redirectUpdateFormSchema,
  seoFormSchema,
} from "@/server/admin/seo/validators";

type RevalidationTarget = {
  path: string;
  type?: "page" | "layout";
};

type SeoActionState = AdminActionState & {
  refreshPending?: boolean;
};

const MAX_SEO_REVALIDATION_TARGETS = 8;

function revalidateSeoTargets(
  scope: string,
  targets: readonly RevalidationTarget[],
) {
  const uniqueTargets = new Map<string, RevalidationTarget>();
  for (const target of targets) {
    uniqueTargets.set(`${target.path}:${target.type ?? "literal"}`, target);
  }

  let refreshPending = false;
  if (uniqueTargets.size > MAX_SEO_REVALIDATION_TARGETS) {
    refreshPending = true;
    logUnexpectedAdminActionError(
      `${scope}.cache-refresh`,
      new Error("SEO cache refresh target limit was exceeded."),
    );
  }
  for (const target of [...uniqueTargets.values()].slice(
    0,
    MAX_SEO_REVALIDATION_TARGETS,
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

function committedSeoSuccess(
  message: string,
  refreshPending: boolean,
): SeoActionState {
  if (!refreshPending) return actionSuccess(message);
  return {
    status: "success",
    message: `${message} The database operation is committed, but one or more administration or storefront cache refreshes may be delayed. Do not resubmit this form; reload the affected page later.`,
    refreshPending: true,
  };
}

function seoFailure(
  reason:
    | "not_found"
    | "permission_changed"
    | "media_not_eligible"
    | "canonical_mismatch"
    | "sensitive_content",
) {
  if (reason === "permission_changed") {
    return actionFailure(
      "Your SEO management permission changed. Refresh before trying again.",
    );
  }
  if (reason === "media_not_eligible") {
    return actionFailure(
      "That Open Graph image is no longer an eligible public image. Choose another image or clear the override.",
    );
  }
  if (reason === "canonical_mismatch") {
    return actionFailure(
      "Managed policy and information pages must keep their fixed storefront canonical path.",
    );
  }
  if (reason === "sensitive_content") {
    return actionFailure(
      "Managed public-page SEO cannot contain scripts, payment or bank details, API/IPN secrets, credentials, or personal contact information.",
    );
  }
  return actionFailure("The SEO target could not be found.");
}

export async function updateSeoAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<SeoActionState> {
  const fields = readStrictFormData(formData, SEO_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = seoFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminSeo>>;
  try {
    result = await updateAdminSeo(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("seo.metadata.update", error);
    return actionFailure("SEO metadata could not be saved. Try again.");
  }
  if (!result.ok) return seoFailure(result.reason);
  const refreshPending = revalidateSeoTargets("seo.metadata.update", [
    { path: "/admin/seo" },
    { path: `/admin/seo/${result.entityType}/${result.publicId}` },
    { path: result.publicPath },
    ...(result.isManagedPage
      ? [{ path: "/admin/content/managed-pages" }]
      : []),
    { path: "/sitemap.xml" },
  ]);
  return committedSeoSuccess("SEO metadata saved.", refreshPending);
}

function redirectFailure(reason: "source_conflict" | "cycle" | "not_found") {
  if (reason === "source_conflict") {
    return actionFailure("That redirect source path is already in use.");
  }
  if (reason === "cycle") {
    return actionFailure("This redirect would create a redirect loop.");
  }
  return actionFailure("The redirect could not be found.");
}

export async function createRedirectAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<SeoActionState> {
  const fields = readStrictFormData(formData, REDIRECT_CREATE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = redirectCreateFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof createAdminRedirect>>;
  try {
    result = await createAdminRedirect(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("seo.redirect.create", error);
    return actionFailure("The redirect could not be created. Try again.");
  }
  if (!result.ok) return redirectFailure(result.reason);
  const refreshPending = revalidateSeoTargets("seo.redirect.create", [
    { path: "/admin/seo" },
  ]);
  if (refreshPending) {
    return committedSeoSuccess("Redirect created.", true);
  }
  redirect(`/admin/seo/redirects/${result.publicId}`);
}

export async function updateRedirectAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<SeoActionState> {
  const fields = readStrictFormData(formData, REDIRECT_UPDATE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = redirectUpdateFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminRedirect>>;
  try {
    result = await updateAdminRedirect(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("seo.redirect.update", error);
    return actionFailure("The redirect could not be saved. Try again.");
  }
  if (!result.ok) return redirectFailure(result.reason);
  const refreshPending = revalidateSeoTargets("seo.redirect.update", [
    { path: "/admin/seo" },
    { path: `/admin/seo/redirects/${result.publicId}` },
  ]);
  return committedSeoSuccess("Redirect saved.", refreshPending);
}
