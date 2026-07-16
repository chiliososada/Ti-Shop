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
  createAdminCategory,
  createAdminProduct,
  createAdminProductMedia,
  createAdminVariant,
  detachAdminProductMedia,
  updateAdminCategory,
  updateAdminProduct,
  updateAdminProductCategories,
  updateAdminProductMedia,
  updateAdminVariant,
  updateAdminVariantPrice,
} from "@/server/admin/catalog/mutations";
import {
  CATEGORY_ASSIGNMENT_FORM_FIELDS,
  categoryAssignmentFormSchema,
  CATEGORY_FORM_FIELDS,
  categoryFormSchema,
  CREATE_CATEGORY_FORM_FIELDS,
  createCategoryFormSchema,
  CREATE_PRODUCT_FORM_FIELDS,
  createProductFormSchema,
  CREATE_PRODUCT_MEDIA_FORM_FIELDS,
  createProductMediaFormSchema,
  CREATE_VARIANT_FORM_FIELDS,
  createVariantFormSchema,
  DETACH_PRODUCT_MEDIA_FORM_FIELDS,
  detachProductMediaFormSchema,
  PRODUCT_FORM_FIELDS,
  productFormSchema,
  UPDATE_PRODUCT_MEDIA_FORM_FIELDS,
  updateProductMediaFormSchema,
  VARIANT_FORM_FIELDS,
  variantFormSchema,
  VARIANT_PRICE_FORM_FIELDS,
  variantPriceFormSchema,
} from "@/server/admin/catalog/validators";

type ProductRevalidation = {
  productPublicId?: string;
  publicId?: string;
  slug: string;
  categorySlugs: string[];
  refreshHome: boolean;
};

type RevalidationTarget = {
  path: string;
  type?: "page" | "layout";
};

const MAX_CATALOG_REVALIDATION_TARGETS = 16;

function revalidateCatalogTargets(
  scope: string,
  targets: readonly RevalidationTarget[],
) {
  const uniqueTargets = new Map<string, RevalidationTarget>();
  for (const target of targets) {
    uniqueTargets.set(`${target.path}:${target.type ?? "literal"}`, target);
  }

  let refreshPending = false;
  if (uniqueTargets.size > MAX_CATALOG_REVALIDATION_TARGETS) {
    refreshPending = true;
    logUnexpectedAdminActionError(
      `${scope}.cache-refresh`,
      new Error("Catalog cache refresh target limit was exceeded."),
    );
  }

  for (const target of [...uniqueTargets.values()].slice(
    0,
    MAX_CATALOG_REVALIDATION_TARGETS,
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

function committedCatalogSuccess(
  message: string,
  refreshPending: boolean,
) {
  return actionSuccess(
    refreshPending
      ? `${message} The database operation is committed, but one or more administration or storefront cache refreshes may be delayed. Do not resubmit this form; reload the affected page later.`
      : message,
  );
}

function productRevalidationTargets(result: ProductRevalidation) {
  const publicId = result.productPublicId ?? result.publicId;
  return [
    { path: "/admin/catalog" },
    ...(publicId
      ? [{ path: `/admin/catalog/products/${publicId}` }]
      : []),
    { path: "/products" },
    { path: `/products/${result.slug}` },
    ...(result.categorySlugs.length
      ? [{ path: "/categories/[slug]", type: "page" as const }]
      : []),
    ...(result.refreshHome ? [{ path: "/" }] : []),
    { path: "/sitemap.xml" },
  ];
}

function catalogActionError(scope: string, error: unknown, message: string) {
  unstable_rethrow(error);
  logUnexpectedAdminActionError(scope, error);
  return actionFailure(message);
}

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

export async function createProductAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, CREATE_PRODUCT_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = createProductFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);
  let result: Awaited<ReturnType<typeof createAdminProduct>>;
  try {
    result = await createAdminProduct(parsed.data);
  } catch (error) {
    return catalogActionError(
      "catalog.product.create",
      error,
      "The product could not be created. The slug or another unique value may already exist.",
    );
  }
  if (!result.ok) {
    return actionFailure("That product slug is already reserved, including by archived data.");
  }
  const refreshPending = revalidateCatalogTargets(
    "catalog.product.create",
    productRevalidationTargets(result),
  );
  return committedCatalogSuccess(
    "Draft product created. Open it below to add variants and publish it.",
    refreshPending,
  );
}

export async function updateProductAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, PRODUCT_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = productFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);
  let result: Awaited<ReturnType<typeof updateAdminProduct>>;
  try {
    result = await updateAdminProduct(parsed.data);
  } catch (error) {
    return catalogActionError(
      "catalog.product.update",
      error,
      "The product could not be saved. Try again.",
    );
  }
  if (!result.ok) {
    return actionFailure(
      result.reason === "missing_active_variant"
        ? "Add and activate at least one published variant before activating this product."
        : "The product could not be found.",
    );
  }
  const refreshPending = revalidateCatalogTargets(
    "catalog.product.update",
    productRevalidationTargets(result),
  );
  return committedCatalogSuccess(
    parsed.data.status === "ARCHIVED"
      ? "Product archived. Historical order references were preserved."
      : "Product details saved.",
    refreshPending,
  );
}

export async function createCategoryAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, CREATE_CATEGORY_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = createCategoryFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);
  let result: Awaited<ReturnType<typeof createAdminCategory>>;
  try {
    result = await createAdminCategory(parsed.data);
  } catch (error) {
    return catalogActionError(
      "catalog.category.create",
      error,
      "The category could not be created. Its slug may already exist.",
    );
  }
  if (!result.ok) {
    return actionFailure("That category slug is already reserved, including by archived data.");
  }
  const refreshPending = revalidateCatalogTargets(
    "catalog.category.create",
    [
      { path: "/admin/catalog" },
      { path: `/admin/catalog/categories/${result.publicId}` },
      { path: `/categories/${result.slug}` },
      { path: "/" },
      { path: "/sitemap.xml" },
    ],
  );
  return committedCatalogSuccess(
    "Draft category created. Open it below to finish and publish it.",
    refreshPending,
  );
}

export async function updateCategoryAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, CATEGORY_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = categoryFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);
  let result: Awaited<ReturnType<typeof updateAdminCategory>>;
  try {
    result = await updateAdminCategory(parsed.data);
  } catch (error) {
    return catalogActionError(
      "catalog.category.update",
      error,
      "The category could not be saved. Try again.",
    );
  }
  if (!result.ok) return actionFailure("The category could not be found.");
  const refreshPending = revalidateCatalogTargets(
    "catalog.category.update",
    [
      { path: "/admin/catalog" },
      { path: `/admin/catalog/categories/${result.publicId}` },
      { path: "/products" },
      { path: `/categories/${result.slug}` },
      ...(result.productSlugs.length
        ? [{ path: "/products/[id]", type: "page" as const }]
        : []),
      { path: "/" },
      { path: "/sitemap.xml" },
    ],
  );
  return committedCatalogSuccess(
    parsed.data.status === "ARCHIVED"
      ? "Category archived. Product associations were preserved."
      : "Category details saved.",
    refreshPending,
  );
}

export async function createVariantAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, CREATE_VARIANT_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = createVariantFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);
  let result: Awaited<ReturnType<typeof createAdminVariant>>;
  try {
    result = await createAdminVariant(parsed.data);
  } catch (error) {
    return catalogActionError(
      "catalog.variant.create",
      error,
      "The variant could not be created. Its SKU may already exist.",
    );
  }
  if (!result.ok) {
    return actionFailure(
      result.reason === "sku_conflict"
        ? "That SKU is already reserved, including by an archived variant."
        : result.reason === "invalid_price"
          ? "Enter a valid fixed USD price."
          : "The product could not be found.",
    );
  }
  const refreshPending = revalidateCatalogTargets(
    "catalog.variant.create",
    productRevalidationTargets(result),
  );
  return committedCatalogSuccess("Variant created.", refreshPending);
}

export async function updateVariantAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, VARIANT_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = variantFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);
  let result: Awaited<ReturnType<typeof updateAdminVariant>>;
  try {
    result = await updateAdminVariant(parsed.data);
  } catch (error) {
    return catalogActionError(
      "catalog.variant.update",
      error,
      "The variant could not be saved. Try again.",
    );
  }
  if (!result.ok) {
    const messages = {
      sku_conflict: "That SKU is already reserved, including by an archived variant.",
      inventory_conflict:
        "Inventory tracking cannot be disabled while stock is reserved for orders.",
      invalid_price: "Enter a valid fixed USD price.",
      not_found: "The product variant could not be found.",
    } as const;
    return actionFailure(messages[result.reason]);
  }
  const refreshPending = revalidateCatalogTargets(
    "catalog.variant.update",
    productRevalidationTargets(result),
  );
  return committedCatalogSuccess(
    parsed.data.status === "ARCHIVED"
      ? "Variant archived. Historical order references were preserved."
      : "Variant and USD pricing saved.",
    refreshPending,
  );
}

export async function updateVariantPriceAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, VARIANT_PRICE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = variantPriceFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);
  let result: Awaited<ReturnType<typeof updateAdminVariantPrice>>;
  try {
    result = await updateAdminVariantPrice(parsed.data);
  } catch (error) {
    return catalogActionError(
      "catalog.variant.price.update",
      error,
      "The variant price could not be saved. Try again.",
    );
  }
  if (!result.ok) {
    return actionFailure(
      result.reason === "invalid_price"
        ? "Enter a valid fixed USD price."
        : "The product variant could not be found.",
    );
  }
  const refreshPending = revalidateCatalogTargets(
    "catalog.variant.price.update",
    productRevalidationTargets(result),
  );
  return committedCatalogSuccess("Variant pricing saved.", refreshPending);
}

export async function updateProductCategoriesAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictListFormData(
    formData,
    CATEGORY_ASSIGNMENT_FORM_FIELDS,
    ["categoryPublicIds"],
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = categoryAssignmentFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);
  let result: Awaited<ReturnType<typeof updateAdminProductCategories>>;
  try {
    result = await updateAdminProductCategories(parsed.data);
  } catch (error) {
    return catalogActionError(
      "catalog.product.categories.update",
      error,
      "The category assignments could not be saved. Try again.",
    );
  }
  if (!result.ok) {
    return actionFailure(
      result.reason === "category_not_found"
        ? "One or more categories no longer exist. Refresh and try again."
        : "The product could not be found.",
    );
  }
  const refreshPending = revalidateCatalogTargets(
    "catalog.product.categories.update",
    productRevalidationTargets(result),
  );
  return committedCatalogSuccess(
    "Product categories and primary category saved.",
    refreshPending,
  );
}

const MEDIA_ERROR_MESSAGES = {
  source_not_found: "That local /public resource does not exist or is not a regular file.",
  not_found: "The product could not be found.",
  variant_not_found: "The selected variant does not belong to this product.",
  media_not_found: "The selected media item no longer exists.",
  invalid_media_source: "The media source is not a valid public path or public HTTPS URL.",
  source_conflict: "That source is reserved by an archived media record.",
  kind_conflict: "The selected media kind does not match the existing media record.",
  role_conflict: "The media role does not match its media kind.",
  already_attached: "That media item is already attached to this product.",
} as const;

export async function createProductMediaAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, CREATE_PRODUCT_MEDIA_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = createProductMediaFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);
  let result: Awaited<ReturnType<typeof createAdminProductMedia>>;
  try {
    result = await createAdminProductMedia(parsed.data);
  } catch (error) {
    return catalogActionError(
      "catalog.product.media.attach",
      error,
      "The media item could not be attached. Try again.",
    );
  }
  if (!result.ok) return actionFailure(MEDIA_ERROR_MESSAGES[result.reason]);
  const refreshPending = revalidateCatalogTargets(
    "catalog.product.media.attach",
    productRevalidationTargets(result),
  );
  return committedCatalogSuccess(
    "Media attached. No file was uploaded.",
    refreshPending,
  );
}

export async function updateProductMediaAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, UPDATE_PRODUCT_MEDIA_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = updateProductMediaFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);
  let result: Awaited<ReturnType<typeof updateAdminProductMedia>>;
  try {
    result = await updateAdminProductMedia(parsed.data);
  } catch (error) {
    return catalogActionError(
      "catalog.product.media.update",
      error,
      "The media metadata could not be saved. Try again.",
    );
  }
  if (!result.ok) return actionFailure(MEDIA_ERROR_MESSAGES[result.reason]);
  const refreshPending = revalidateCatalogTargets(
    "catalog.product.media.update",
    productRevalidationTargets(result),
  );
  return committedCatalogSuccess(
    "Media metadata and placement saved.",
    refreshPending,
  );
}

export async function detachProductMediaAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const fields = readStrictFormData(formData, DETACH_PRODUCT_MEDIA_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = detachProductMediaFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);
  let result: Awaited<ReturnType<typeof detachAdminProductMedia>>;
  try {
    result = await detachAdminProductMedia(parsed.data);
  } catch (error) {
    return catalogActionError(
      "catalog.product.media.detach",
      error,
      "The media item could not be detached. Try again.",
    );
  }
  if (!result.ok) return actionFailure(MEDIA_ERROR_MESSAGES[result.reason]);
  const refreshPending = revalidateCatalogTargets(
    "catalog.product.media.detach",
    productRevalidationTargets(result),
  );
  return committedCatalogSuccess(
    "Media detached. The shared asset record was preserved.",
    refreshPending,
  );
}
