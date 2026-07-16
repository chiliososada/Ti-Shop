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
  archiveOrDeleteAdminTag,
  createAdminPlacement,
  createAdminTag,
  deleteAdminPlacement,
  updateAdminPlacement,
  updateAdminProductTags,
  updateAdminTag,
} from "@/server/admin/catalog/organization-mutations";
import {
  PLACEMENT_CREATE_FORM_FIELDS,
  placementCreateFormSchema,
  PLACEMENT_DELETE_FORM_FIELDS,
  placementDeleteFormSchema,
  PLACEMENT_UPDATE_FORM_FIELDS,
  placementUpdateFormSchema,
  PRODUCT_TAG_ASSIGNMENT_FORM_FIELDS,
  productTagAssignmentFormSchema,
  TAG_ARCHIVE_OR_DELETE_FORM_FIELDS,
  tagArchiveOrDeleteFormSchema,
  TAG_CREATE_FORM_FIELDS,
  tagCreateFormSchema,
  TAG_UPDATE_FORM_FIELDS,
  tagUpdateFormSchema,
} from "@/server/admin/catalog/organization-validators";

type AffectedProduct = {
  productPublicId: string;
  slug: string;
  categorySlugs: string[];
};

export type CatalogOrganizationActionState = AdminActionState & {
  refreshPending?: boolean;
};

type RevalidationTarget = { path: string };
const MAX_ORGANIZATION_REVALIDATION_TARGETS = 4_096;

function readStrictListFormData(
  formData: FormData,
  allowedFields: readonly string[],
  listFields: readonly string[],
) {
  const allowed = new Set(allowedFields);
  const lists = new Set(listFields);
  const seen = new Set<string>();
  const data: Record<string, string | string[]> = {};
  for (const field of listFields) data[field] = [];

  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION_")) continue;
    if (!allowed.has(key)) {
      return {
        success: false as const,
        message: "The form contained unexpected fields. Refresh and try again.",
      };
    }
    if (typeof value !== "string") {
      return {
        success: false as const,
        message: "File uploads are not supported by this form.",
      };
    }
    if (lists.has(key)) {
      (data[key] as string[]).push(value);
      continue;
    }
    if (seen.has(key)) {
      return {
        success: false as const,
        message: "The form contained duplicate fields. Refresh and try again.",
      };
    }
    seen.add(key);
    data[key] = value;
  }
  return { success: true as const, data };
}

function catalogRevalidationTargets(
  affectedProducts: readonly AffectedProduct[],
  options: { home?: boolean } = {},
) {
  const targets: RevalidationTarget[] = [
    { path: "/admin/catalog" },
    { path: "/admin/catalog/organization" },
  ];
  if (affectedProducts.length) targets.push({ path: "/products" });
  const productIds = new Set<string>();
  const productSlugs = new Set<string>();
  const categorySlugs = new Set<string>();
  for (const product of affectedProducts) {
    productIds.add(product.productPublicId);
    productSlugs.add(product.slug);
    for (const slug of product.categorySlugs) categorySlugs.add(slug);
  }
  for (const publicId of productIds) {
    targets.push({ path: `/admin/catalog/products/${publicId}` });
  }
  for (const slug of productSlugs) targets.push({ path: `/products/${slug}` });
  for (const slug of categorySlugs) {
    targets.push({ path: `/categories/${slug}` });
  }
  if (options.home) targets.push({ path: "/" });
  return targets;
}

function revalidateCatalogTargets(targets: readonly RevalidationTarget[]) {
  const unique = new Map(targets.map((target) => [target.path, target]));
  if (unique.size > MAX_ORGANIZATION_REVALIDATION_TARGETS) {
    throw new Error("Catalog cache refresh target limit was exceeded.");
  }

  let firstError: unknown;
  for (const target of unique.values()) {
    try {
      revalidatePath(target.path);
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) throw firstError;
}

function successfulState(
  message: string,
  refreshPending = false,
): CatalogOrganizationActionState {
  return { ...actionSuccess(message), refreshPending };
}

function committedSuccess(
  scope: string,
  message: string,
  affectedProducts: readonly AffectedProduct[],
  options: { home?: boolean } = {},
): CatalogOrganizationActionState {
  let refreshPending = false;
  try {
    revalidateCatalogTargets(
      catalogRevalidationTargets(affectedProducts, options),
    );
  } catch (error) {
    refreshPending = true;
    logUnexpectedAdminActionError(`${scope}.cache-refresh`, error);
  }
  return successfulState(
    refreshPending
      ? `${message} The database change was committed, but one or more cache refreshes are delayed. Do not submit the form again; refresh this page later to see the updated view.`
      : message,
    refreshPending,
  );
}

function mutationFailure(reason: string) {
  switch (reason) {
    case "permission_changed":
      return actionFailure(
        "Your catalog permission changed before the update completed. Refresh and try again.",
      );
    case "slug_conflict":
      return actionFailure(
        "That tag slug is already reserved, including by an archived record.",
      );
    case "idempotency_conflict":
      return actionFailure(
        "This submission identifier was already used for different data. Refresh and try again.",
      );
    case "tag_not_found":
      return actionFailure(
        "One or more selected tags no longer exist or were archived. Refresh and try again.",
      );
    case "key_not_found":
      return actionFailure(
        "That placement key is not an existing managed placement set.",
      );
    case "product_not_found":
      return actionFailure("The selected product no longer exists.");
    case "position_conflict":
      return actionFailure(
        "That position is already used in this placement set. Choose another position or edit the existing row to swap positions.",
      );
    case "product_conflict":
      return actionFailure(
        "That product is already present in this placement set.",
      );
    case "placement_limit":
      return actionFailure(
        "This placement set already has the maximum 100 products.",
      );
    case "last_placement":
      return actionFailure(
        "The final row of a non-core placement set cannot be deleted because its key would become unrecoverable. Deactivate it instead.",
      );
    case "legacy_managed":
      return actionFailure(
        "This imported placement keeps its source position and identity so a safe legacy import can be rerun. You may activate or deactivate it, but not move or delete it.",
      );
    case "legacy_position_conflict":
      return actionFailure(
        "That destination is reserved by an imported placement. Choose another position so a future legacy import remains safe.",
      );
    case "legacy_reserved_position":
      return actionFailure(
        "Positions 0–99 are reserved for the legacy importer on core placement keys. Use position 100 or higher for a manually added product.",
      );
    default:
      return actionFailure("The requested catalog record could not be found.");
  }
}

function unexpected(scope: string, error: unknown, message: string) {
  unstable_rethrow(error);
  logUnexpectedAdminActionError(scope, error);
  return actionFailure(message);
}

export async function createTagAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<CatalogOrganizationActionState> {
  const fields = readStrictFormData(formData, TAG_CREATE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = tagCreateFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof createAdminTag>>;
  try {
    result = await createAdminTag(parsed.data);
  } catch (error) {
    return unexpected(
      "catalog.tag.create",
      error,
      "The tag could not be created. Try again.",
    );
  }

  if (!result.ok) return mutationFailure(result.reason);
  const message = result.duplicate
    ? "Tag was already created."
    : "Tag created.";
  return result.duplicate
    ? successfulState(message)
    : committedSuccess(
        "catalog.tag.create",
        message,
        result.affectedProducts,
      );
}

export async function updateTagAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<CatalogOrganizationActionState> {
  const fields = readStrictFormData(formData, TAG_UPDATE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = tagUpdateFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminTag>>;
  try {
    result = await updateAdminTag(parsed.data);
  } catch (error) {
    return unexpected(
      "catalog.tag.update",
      error,
      "The tag could not be saved. Try again.",
    );
  }

  if (!result.ok) return mutationFailure(result.reason);
  const message = result.duplicate
    ? "Tag was already up to date."
    : "Tag saved.";
  return result.duplicate
    ? successfulState(message)
    : committedSuccess(
        "catalog.tag.update",
        message,
        result.affectedProducts,
      );
}

export async function archiveOrDeleteTagAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<CatalogOrganizationActionState> {
  const fields = readStrictFormData(
    formData,
    TAG_ARCHIVE_OR_DELETE_FORM_FIELDS,
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = tagArchiveOrDeleteFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof archiveOrDeleteAdminTag>>;
  try {
    result = await archiveOrDeleteAdminTag(parsed.data);
  } catch (error) {
    return unexpected(
      "catalog.tag.archive_or_delete",
      error,
      "The tag could not be archived or deleted. Try again.",
    );
  }

  if (!result.ok) return mutationFailure(result.reason);
  const message = result.duplicate
    ? result.mode === "deleted"
      ? "Tag was already deleted."
      : "Tag was already archived."
    : result.mode === "archived"
      ? "Tag archived because products still use it. Associations were preserved."
      : "Unused tag permanently deleted.";
  return result.duplicate
    ? successfulState(message)
    : committedSuccess(
        "catalog.tag.archive_or_delete",
        message,
        result.affectedProducts,
      );
}

export async function updateProductTagsAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<CatalogOrganizationActionState> {
  const fields = readStrictListFormData(
    formData,
    PRODUCT_TAG_ASSIGNMENT_FORM_FIELDS,
    ["tagPublicIds"],
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = productTagAssignmentFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminProductTags>>;
  try {
    result = await updateAdminProductTags(parsed.data);
  } catch (error) {
    return unexpected(
      "catalog.product.tags.update",
      error,
      "The product tags could not be saved. Try again.",
    );
  }

  if (!result.ok) return mutationFailure(result.reason);
  const message = result.duplicate
    ? "Product tags were already up to date."
    : "Product tags saved.";
  return result.duplicate
    ? successfulState(message)
    : committedSuccess(
        "catalog.product.tags.update",
        message,
        result.affectedProducts,
      );
}

export async function createPlacementAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<CatalogOrganizationActionState> {
  const fields = readStrictFormData(formData, PLACEMENT_CREATE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = placementCreateFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof createAdminPlacement>>;
  try {
    result = await createAdminPlacement(parsed.data);
  } catch (error) {
    return unexpected(
      "catalog.merchandising_placement.create",
      error,
      "The placement could not be created. Try again.",
    );
  }

  if (!result.ok) return mutationFailure(result.reason);
  const message = result.duplicate
    ? "Placement was already created."
    : "Product added to the placement set.";
  return result.duplicate
    ? successfulState(message)
    : committedSuccess(
        "catalog.merchandising_placement.create",
        message,
        result.affectedProducts,
        { home: true },
      );
}

export async function updatePlacementAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<CatalogOrganizationActionState> {
  const fields = readStrictFormData(formData, PLACEMENT_UPDATE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = placementUpdateFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminPlacement>>;
  try {
    result = await updateAdminPlacement(parsed.data);
  } catch (error) {
    return unexpected(
      "catalog.merchandising_placement.update",
      error,
      "The placement could not be saved. Try again.",
    );
  }

  if (!result.ok) return mutationFailure(result.reason);
  const message = result.duplicate
    ? "Placement was already up to date."
    : "Placement saved. An occupied destination position is swapped safely.";
  return result.duplicate
    ? successfulState(message)
    : committedSuccess(
        "catalog.merchandising_placement.update",
        message,
        result.affectedProducts,
        { home: true },
      );
}

export async function deletePlacementAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<CatalogOrganizationActionState> {
  const fields = readStrictFormData(formData, PLACEMENT_DELETE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = placementDeleteFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof deleteAdminPlacement>>;
  try {
    result = await deleteAdminPlacement(parsed.data);
  } catch (error) {
    return unexpected(
      "catalog.merchandising_placement.delete",
      error,
      "The placement could not be removed. Try again.",
    );
  }

  if (!result.ok) return mutationFailure(result.reason);
  const message = result.duplicate
    ? "Placement was already removed."
    : "Product removed from the placement set.";
  return result.duplicate
    ? successfulState(message)
    : committedSuccess(
        "catalog.merchandising_placement.delete",
        message,
        result.affectedProducts,
        { home: true },
      );
}
