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
  createAdminBlogPost,
  createAdminFaq,
  createAdminPage,
  updateAdminBlogPost,
  updateAdminFaq,
  updateAdminPage,
} from "@/server/admin/content/mutations";
import {
  BLOG_CREATE_FORM_FIELDS,
  BLOG_FORM_FIELDS,
  FAQ_CREATE_FORM_FIELDS,
  FAQ_UPDATE_FORM_FIELDS,
  PAGE_CREATE_FORM_FIELDS,
  PAGE_UPDATE_FORM_FIELDS,
  blogCreateFormSchema,
  blogFormSchema,
  faqCreateFormSchema,
  faqUpdateFormSchema,
  pageCreateFormSchema,
  pageUpdateFormSchema,
} from "@/server/admin/content/validators";

type RevalidationTarget = {
  path: string;
  type?: "page" | "layout";
};

const MAX_CONTENT_REVALIDATION_TARGETS = 10;

function revalidateContentTargets(
  scope: string,
  targets: readonly RevalidationTarget[],
) {
  const uniqueTargets = new Map<string, RevalidationTarget>();
  for (const target of targets) {
    uniqueTargets.set(`${target.path}:${target.type ?? "literal"}`, target);
  }

  let refreshPending = false;
  if (uniqueTargets.size > MAX_CONTENT_REVALIDATION_TARGETS) {
    refreshPending = true;
    logUnexpectedAdminActionError(
      `${scope}.cache-refresh`,
      new Error("Content cache refresh target limit was exceeded."),
    );
  }

  for (const target of [...uniqueTargets.values()].slice(
    0,
    MAX_CONTENT_REVALIDATION_TARGETS,
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

function committedContentSuccess(
  message: string,
  refreshPending: boolean,
) {
  return actionSuccess(
    refreshPending
      ? `${message} The database operation is committed, but one or more administration or storefront cache refreshes may be delayed. Do not resubmit this form; reload the affected page later.`
      : message,
  );
}

export async function createBlogPostAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, BLOG_CREATE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = blogCreateFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof createAdminBlogPost>>;
  try {
    result = await createAdminBlogPost(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("content.blog.create", error);
    return actionFailure("The article could not be created. Try again.");
  }
  if (!result.ok) {
    return actionFailure("That article slug is already in use.");
  }
  const refreshPending = revalidateContentTargets("content.blog.create", [
    { path: "/admin/content" },
    { path: "/admin/seo" },
    { path: "/blog" },
    { path: `/blog/${result.slug}` },
    { path: "/" },
    { path: "/sitemap.xml" },
  ]);
  if (refreshPending) {
    return committedContentSuccess("Article created.", true);
  }
  redirect(`/admin/content/blog/${result.publicId}`);
}

export async function updateBlogPostAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, BLOG_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = blogFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminBlogPost>>;
  try {
    result = await updateAdminBlogPost(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("content.blog.update", error);
    return actionFailure("The article could not be saved. Try again.");
  }
  if (!result.ok) return actionFailure("The article could not be found.");
  const refreshPending = revalidateContentTargets("content.blog.update", [
    { path: "/admin/content" },
    { path: `/admin/content/blog/${result.publicId}` },
    { path: "/blog" },
    { path: `/blog/${result.slug}` },
    { path: "/" },
    { path: "/sitemap.xml" },
  ]);
  return committedContentSuccess("Article saved.", refreshPending);
}

export async function createPageAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, PAGE_CREATE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = pageCreateFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof createAdminPage>>;
  try {
    result = await createAdminPage(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("content.page.create", error);
    return actionFailure("The page could not be created. Try again.");
  }
  if (!result.ok) {
    return actionFailure("That page slug is already in use.");
  }
  const refreshPending = revalidateContentTargets("content.page.create", [
    { path: "/admin/content" },
    { path: "/admin/seo" },
    { path: `/pages/${result.slug}` },
    { path: "/sitemap.xml" },
  ]);
  if (refreshPending) {
    return committedContentSuccess("Page created.", true);
  }
  redirect(`/admin/content/pages/${result.publicId}`);
}

export async function updatePageAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, PAGE_UPDATE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = pageUpdateFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminPage>>;
  try {
    result = await updateAdminPage(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("content.page.update", error);
    return actionFailure("The page could not be saved. Try again.");
  }
  if (!result.ok) {
    return actionFailure(
      result.reason === "slug_conflict"
        ? "That page slug is already in use."
        : "The page could not be found.",
    );
  }
  const refreshPending = revalidateContentTargets("content.page.update", [
    { path: "/admin/content" },
    { path: `/admin/content/pages/${result.publicId}` },
    { path: "/admin/seo" },
    { path: `/pages/${result.previousSlug}` },
    ...(result.slug !== result.previousSlug
      ? [{ path: `/pages/${result.slug}` }]
      : []),
    { path: "/sitemap.xml" },
  ]);
  return committedContentSuccess("Page saved.", refreshPending);
}

export async function createFaqAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, FAQ_CREATE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = faqCreateFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof createAdminFaq>>;
  try {
    result = await createAdminFaq(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("content.faq.create", error);
    return actionFailure("The FAQ could not be created. Try again.");
  }
  if (!result.ok) {
    return actionFailure("That FAQ slug is already in use.");
  }
  const refreshPending = revalidateContentTargets("content.faq.create", [
    { path: "/admin/content" },
    { path: "/faq" },
  ]);
  if (refreshPending) {
    return committedContentSuccess("FAQ created.", true);
  }
  redirect(`/admin/content/faq/${result.publicId}`);
}

export async function updateFaqAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, FAQ_UPDATE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = faqUpdateFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminFaq>>;
  try {
    result = await updateAdminFaq(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("content.faq.update", error);
    return actionFailure("The FAQ could not be saved. Try again.");
  }
  if (!result.ok) {
    return actionFailure(
      result.reason === "slug_conflict"
        ? "That FAQ slug is already in use."
        : "The FAQ could not be found.",
    );
  }
  const refreshPending = revalidateContentTargets("content.faq.update", [
    { path: "/admin/content" },
    { path: `/admin/content/faq/${result.publicId}` },
    { path: "/faq" },
  ]);
  return committedContentSuccess("FAQ saved.", refreshPending);
}
