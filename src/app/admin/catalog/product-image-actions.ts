"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { logUnexpectedAdminActionError } from "@/server/admin/audit/action-state";
import { authorizeApiPermission } from "@/server/auth/rbac";
import {
  deleteProductImages,
  reorderProductImages,
  setPrimaryProductImage,
  updateProductImageText,
} from "@/server/admin/catalog/product-images/mutations";
import { getDb } from "@/server/db/client";

/**
 * JSON-shaped server actions for the interactive image manager. Server
 * Actions keep Next's built-in same-origin enforcement; every mutation
 * re-verifies catalog.manage internally.
 */
export type ProductImageActionResult =
  | { ok: true; skipped?: { mediaPublicId: string; reason: string }[] }
  | { ok: false; message: string };

const uuidSchema = z.uuid();

const textInputSchema = z.object({
  productPublicId: uuidSchema,
  mediaPublicId: uuidSchema,
  altText: z.string().max(500).nullable(),
  title: z.string().max(255).nullable(),
});

const orderInputSchema = z.object({
  productPublicId: uuidSchema,
  orderedMediaPublicIds: z.array(uuidSchema).min(1).max(64),
});

const targetInputSchema = z.object({
  productPublicId: uuidSchema,
  mediaPublicId: uuidSchema,
});

const deleteInputSchema = z.object({
  productPublicId: uuidSchema,
  mediaPublicIds: z.array(uuidSchema).min(1).max(64),
});

async function revalidateProductImageTargets(productPublicId: string) {
  try {
    const product = await getDb().product.findUnique({
      where: { publicId: productPublicId },
      select: {
        slug: true,
        isFeatured: true,
        placements: { select: { id: true }, take: 1 },
        categories: { select: { category: { select: { slug: true } } } },
      },
    });
    revalidatePath(`/admin/catalog/products/${productPublicId}`);
    revalidatePath("/admin/catalog");
    revalidatePath("/products");
    if (product) {
      revalidatePath(`/products/${product.slug}`);
      if (product.categories.length > 0) {
        revalidatePath("/categories/[slug]", "page");
      }
      if (product.isFeatured || product.placements.length > 0) {
        revalidatePath("/");
      }
    }
    return false;
  } catch (error) {
    unstable_rethrow(error);
    // A failed cache refresh must never masquerade as a failed write: the
    // database change is committed; the page just may serve stale data briefly.
    logUnexpectedAdminActionError("catalog.product-images.cache-refresh", error);
    return true;
  }
}

function failure(message: string): ProductImageActionResult {
  return { ok: false, message };
}

export async function setPrimaryProductImageAction(
  input: z.infer<typeof targetInputSchema>,
): Promise<ProductImageActionResult> {
  const parsed = targetInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("Invalid request.");
  }
  try {
    const result = await setPrimaryProductImage(parsed.data);
    if (!result.ok) return failure(result.message);
    await revalidateProductImageTargets(parsed.data.productPublicId);
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("catalog.product-images.set-primary", error);
    return failure("Setting the primary image failed. Try again.");
  }
}

export async function reorderProductImagesAction(
  input: z.infer<typeof orderInputSchema>,
): Promise<ProductImageActionResult> {
  const parsed = orderInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("Invalid request.");
  }
  try {
    const result = await reorderProductImages(parsed.data);
    if (!result.ok) return failure(result.message);
    await revalidateProductImageTargets(parsed.data.productPublicId);
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("catalog.product-images.reorder", error);
    return failure("Saving the new order failed. Try again.");
  }
}

export async function updateProductImageTextAction(
  input: z.infer<typeof textInputSchema>,
): Promise<ProductImageActionResult> {
  const parsed = textInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("Alt text may use at most 500 characters and title 255.");
  }
  try {
    const result = await updateProductImageText(parsed.data);
    if (!result.ok) return failure(result.message);
    await revalidateProductImageTargets(parsed.data.productPublicId);
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("catalog.product-images.text", error);
    return failure("Saving the text failed. Try again.");
  }
}

export async function deleteProductImagesAction(
  input: z.infer<typeof deleteInputSchema>,
): Promise<ProductImageActionResult> {
  const parsed = deleteInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("Invalid request.");
  }
  try {
    const result = await deleteProductImages(parsed.data);
    if (!result.ok) return failure(result.message);
    await revalidateProductImageTargets(parsed.data.productPublicId);
    return { ok: true, skipped: result.skipped };
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("catalog.product-images.delete", error);
    return failure("Deleting failed. Try again.");
  }
}

export async function refreshProductImagesAction(
  productPublicId: string,
): Promise<ProductImageActionResult> {
  const authorization = await authorizeApiPermission("catalog.manage");
  if (!authorization.ok) {
    return failure("Administrator access is required.");
  }
  const parsed = uuidSchema.safeParse(productPublicId);
  if (!parsed.success) {
    return failure("Invalid request.");
  }
  await revalidateProductImageTargets(parsed.data);
  return { ok: true };
}
