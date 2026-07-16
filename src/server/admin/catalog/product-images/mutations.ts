import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import { authorizeApiPermission } from "@/server/auth/rbac";
import {
  ImageProcessingError,
  processProductImage,
} from "@/server/catalog/product-images/process";
import { productImageRenditionUrls } from "@/server/catalog/product-images/urls";
import { validateUploadedImage } from "@/server/catalog/product-images/validate";
import { getDb } from "@/server/db/client";
import { withSerializableRetry } from "@/server/orders/retry";
import { getStorageConfigState } from "@/server/storage/config";
import { StorageError } from "@/server/storage/errors";
import {
  allProductImageKeys,
  newProductImageKeyPrefix,
  productImageKey,
  productImageKeyPrefixOf,
  type ProductImageVariant,
} from "@/server/storage/keys";
import { getProductImageStorage } from "@/server/storage/provider";

export const MAX_IMAGES_PER_PRODUCT = 24;

const IMAGE_ROLES = ["PRIMARY", "GALLERY"] as const;

type VariantRecord = Record<
  ProductImageVariant,
  { key: string; width: number; height: number; sizeBytes: number }
>;

export type ProductImageDto = {
  mediaPublicId: string;
  role: "PRIMARY" | "GALLERY";
  position: number;
  altText: string | null;
  title: string | null;
  originalFilename: string | null;
  width: number | null;
  height: number | null;
  uploadStatus: "UPLOADING" | "READY" | "FAILED";
  urls: { original: string; thumb: string; card: string; detail: string } | null;
};

export type UploadFailureReason =
  | "unauthorized"
  | "storage_unconfigured"
  | "product_not_found"
  | "too_many_images"
  | "validation_failed"
  | "processing_failed"
  | "storage_error"
  | "conflict";

export type UploadProductImageResult =
  | { ok: true; image: ProductImageDto; deduplicated: boolean }
  | {
      ok: false;
      reason: UploadFailureReason;
      message: string;
      retryable: boolean;
    };

function transactionOptions() {
  return {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 15_000,
  } as const;
}

function checksumOf(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function publicUrlFor(key: string): string {
  return getProductImageStorage().publicUrl(key);
}

const mediaAuditSelect = {
  publicId: true,
  kind: true,
  storageProvider: true,
  storageKey: true,
  bucket: true,
  altText: true,
  title: true,
  originalFilename: true,
  mimeType: true,
  width: true,
  height: true,
  uploadStatus: true,
  checksum: true,
  deletedAt: true,
} satisfies Prisma.MediaSelect;

function toDto(link: {
  role: string;
  position: number;
  media: {
    publicId: string;
    altText: string | null;
    title: string | null;
    originalFilename: string | null;
    width: number | null;
    height: number | null;
    uploadStatus: "UPLOADING" | "READY" | "FAILED";
    variants: unknown;
  };
}): ProductImageDto {
  return {
    mediaPublicId: link.media.publicId,
    role: link.role === "PRIMARY" ? "PRIMARY" : "GALLERY",
    position: link.position,
    altText: link.media.altText,
    title: link.media.title,
    originalFilename: link.media.originalFilename,
    width: link.media.width,
    height: link.media.height,
    uploadStatus: link.media.uploadStatus,
    urls: productImageRenditionUrls({
      publicUrl: null,
      variants: link.media.variants,
    }),
  };
}

async function requireImageProduct(
  tx: Prisma.TransactionClient,
  productPublicId: string,
) {
  return tx.product.findFirst({
    where: { publicId: productPublicId, deletedAt: null },
    select: { id: true, publicId: true, slug: true, title: true },
  });
}

async function writeImageOutbox(
  tx: Prisma.TransactionClient,
  input: {
    aggregateType?: string;
    aggregateId: string;
    eventType: string;
    payload: Prisma.InputJsonObject;
  },
) {
  await tx.outboxEvent.create({
    data: {
      aggregateType: input.aggregateType ?? "product",
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload,
    },
    select: { id: true },
  });
}

/**
 * Requests asynchronous, retryable removal of storage objects through the
 * outbox. Consumed by scripts/process-storage-outbox.ts; repeated delivery is
 * safe because object deletion is idempotent.
 */
export async function requestStorageObjectCleanup(
  tx: Prisma.TransactionClient,
  input: { bucket: string; keys: string[]; reason: string; mediaPublicId: string },
) {
  await writeImageOutbox(tx, {
    aggregateType: "storage_object",
    aggregateId: input.mediaPublicId,
    eventType: "storage.objects.delete_requested",
    payload: {
      bucket: input.bucket,
      keys: input.keys,
      reason: input.reason,
      mediaPublicId: input.mediaPublicId,
    },
  });
}

export async function uploadProductImage(input: {
  productPublicId: string;
  bytes: Uint8Array;
  declaredMimeType: string | null;
  originalFilename: string | null;
}): Promise<UploadProductImageResult> {
  const authorization = await authorizeApiPermission("catalog.manage");
  if (!authorization.ok) {
    return {
      ok: false,
      reason: "unauthorized",
      message: "Administrator access with catalog.manage is required.",
      retryable: false,
    };
  }
  const actorUserId = authorization.session.user.id;

  const storageState = getStorageConfigState();
  if (!storageState.configured) {
    return {
      ok: false,
      reason: "storage_unconfigured",
      message: storageState.reason,
      retryable: false,
    };
  }

  const validation = validateUploadedImage({
    bytes: input.bytes,
    declaredMimeType: input.declaredMimeType,
    originalFilename: input.originalFilename,
    maxBytes: storageState.env.productImageMaxBytes,
    allowedTypes: storageState.env.productImageAllowedTypes,
  });
  if (!validation.ok) {
    return {
      ok: false,
      reason: "validation_failed",
      message: validation.message,
      retryable: false,
    };
  }

  let processed;
  try {
    processed = await processProductImage(input.bytes);
  } catch (error) {
    return {
      ok: false,
      reason: "processing_failed",
      message:
        error instanceof ImageProcessingError
          ? error.message
          : "The image could not be processed.",
      retryable: false,
    };
  }

  const checksum = checksumOf(input.bytes);
  const bucket = storageState.env.productImagesBucket;
  const db = getDb();

  // Phase 1 — reserve the database records first so a crash between storage
  // upload and completion always leaves a trackable UPLOADING/FAILED row
  // instead of an untracked orphan object.
  const keyPrefix = newProductImageKeyPrefix(input.productPublicId.toLowerCase());
  const originalKey = productImageKey(keyPrefix, "original");

  type ReservePhase =
    | { kind: "dedup"; dto: ProductImageDto }
    | {
        kind: "reserved";
        mediaId: bigint;
        mediaPublicId: string;
        productId: bigint;
        productSlug: string;
        role: "PRIMARY" | "GALLERY";
        position: number;
      }
    | { kind: "error"; reason: UploadFailureReason; message: string };

  let reserved: ReservePhase;
  try {
    // Five attempts with growing waits: simultaneous first uploads race for
    // the PRIMARY slot and abort on the partial unique index until one wins.
    reserved = await withSerializableRetry(
      () =>
        db.$transaction(async (tx) => {
        const product = await requireImageProduct(tx, input.productPublicId);
        if (!product) {
          return {
            kind: "error",
            reason: "product_not_found",
            message: "The product does not exist or is deleted.",
          } satisfies ReservePhase;
        }

        // Idempotency: the same file re-submitted to the same product returns
        // the existing image instead of creating a duplicate.
        const existing = await tx.productMedia.findFirst({
          where: {
            productId: product.id,
            variantId: null,
            media: {
              checksum,
              bucket,
              deletedAt: null,
              uploadStatus: { in: ["READY", "UPLOADING"] },
            },
          },
          select: {
            role: true,
            position: true,
            media: {
              select: { ...mediaAuditSelect, variants: true },
            },
          },
        });
        if (existing) {
          return { kind: "dedup", dto: toDto(existing) } satisfies ReservePhase;
        }

        const imageLinks = await tx.productMedia.findMany({
          where: {
            productId: product.id,
            variantId: null,
            role: { in: [...IMAGE_ROLES] },
            media: { kind: "IMAGE", deletedAt: null },
          },
          select: { role: true, position: true },
        });
        if (imageLinks.length >= MAX_IMAGES_PER_PRODUCT) {
          return {
            kind: "error",
            reason: "too_many_images",
            message: `A product can hold at most ${MAX_IMAGES_PER_PRODUCT} images.`,
          } satisfies ReservePhase;
        }

        const hasPrimary = imageLinks.some((link) => link.role === "PRIMARY");
        const role: "PRIMARY" | "GALLERY" = hasPrimary ? "GALLERY" : "PRIMARY";
        const position =
          imageLinks.reduce((max, link) => Math.max(max, link.position), -1) + 1;

        const media = await tx.media.create({
          data: {
            kind: "IMAGE",
            storageProvider: "supabase-s3",
            storageKey: originalKey,
            bucket,
            publicUrl: publicUrlFor(originalKey),
            originalFilename: validation.originalFilename,
            mimeType: "image/webp",
            checksum,
            uploadStatus: "UPLOADING",
            createdByUserId: actorUserId,
            isPrivate: false,
          },
          select: { id: true, publicId: true },
        });

        await tx.productMedia.create({
          data: {
            productId: product.id,
            mediaId: media.id,
            variantId: null,
            role,
            position,
          },
          select: { id: true },
        });

        return {
          kind: "reserved",
          mediaId: media.id,
          mediaPublicId: media.publicId,
          productId: product.id,
          productSlug: product.slug,
          role,
          position,
        } satisfies ReservePhase;
        }, transactionOptions()),
      {
        attempts: 5,
        wait: (attempt) =>
          new Promise((resolve) =>
            setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 50)),
          ),
      },
    );
  } catch {
    return {
      ok: false,
      reason: "conflict",
      message: "The image records could not be reserved. Try again.",
      retryable: true,
    };
  }

  if (reserved.kind === "dedup") {
    return { ok: true, image: reserved.dto, deduplicated: true };
  }
  if (reserved.kind === "error") {
    return { ok: false, reason: reserved.reason, message: reserved.message, retryable: false };
  }

  // Phase 2 — upload renditions to immutable keys.
  const storage = getProductImageStorage();
  const uploadedKeys: string[] = [];
  let storageFailure: StorageError | null = null;
  for (const rendition of processed.variants) {
    const key = productImageKey(keyPrefix, rendition.variant);
    try {
      await storage.putObject({
        key,
        body: rendition.bytes,
        contentType: "image/webp",
      });
      uploadedKeys.push(key);
    } catch (error) {
      storageFailure =
        error instanceof StorageError
          ? error
          : new StorageError({
              operation: "put",
              category: "unknown",
              message: "unexpected storage failure",
              cause: error,
            });
      break;
    }
  }

  if (storageFailure) {
    // Mark the reservation failed and hand object cleanup to the outbox
    // consumer; a direct best-effort delete happens there with retries.
    await db.$transaction(async (tx) => {
      await tx.media.update({
        where: { id: reserved.mediaId },
        data: { uploadStatus: "FAILED", deletedAt: new Date() },
        select: { id: true },
      });
      await tx.productMedia.deleteMany({
        where: { mediaId: reserved.mediaId, productId: reserved.productId },
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "catalog.product.image.upload_failed",
        resourceType: "media",
        resourceId: reserved.mediaPublicId,
        before: { productPublicId: input.productPublicId },
        after: {
          checksum,
          storageCategory: storageFailure.category,
        },
      });
      await requestStorageObjectCleanup(tx, {
        bucket,
        keys: allProductImageKeys(keyPrefix),
        reason: "upload_failed",
        mediaPublicId: reserved.mediaPublicId,
      });
    });
    return {
      ok: false,
      reason: "storage_error",
      message: "The object storage service rejected the upload. Try again.",
      retryable: storageFailure.isRetryable,
    };
  }

  // Phase 3 — publish the completed image.
  const variantsJson: VariantRecord = Object.fromEntries(
    processed.variants.map((rendition) => [
      rendition.variant,
      {
        key: productImageKey(keyPrefix, rendition.variant),
        width: rendition.width,
        height: rendition.height,
        sizeBytes: rendition.sizeBytes,
      },
    ]),
  ) as VariantRecord;

  const published = await db.$transaction(async (tx) => {
    await tx.media.update({
      where: { id: reserved.mediaId },
      data: {
        uploadStatus: "READY",
        width: processed.width,
        height: processed.height,
        sizeBytes: BigInt(input.bytes.length),
        variants: variantsJson as unknown as Prisma.InputJsonObject,
      },
      select: { id: true },
    });
    const link = await tx.productMedia.findFirst({
      where: { mediaId: reserved.mediaId, productId: reserved.productId, variantId: null },
      select: {
        role: true,
        position: true,
        media: { select: { ...mediaAuditSelect, variants: true } },
      },
    });
    await writeAdminAuditLog(tx, {
      actorUserId,
      action: "catalog.product.image.upload",
      resourceType: "media",
      resourceId: reserved.mediaPublicId,
      before: { exists: false },
      after: {
        productPublicId: input.productPublicId,
        storageKey: originalKey,
        bucket,
        checksum,
        role: reserved.role,
        position: reserved.position,
        width: processed.width,
        height: processed.height,
      },
    });
    await writeImageOutbox(tx, {
      aggregateId: input.productPublicId,
      eventType: "catalog.product.image.uploaded",
      payload: {
        productPublicId: input.productPublicId,
        mediaPublicId: reserved.mediaPublicId,
        role: reserved.role,
      },
    });
    return link;
  });

  if (!published) {
    return {
      ok: false,
      reason: "conflict",
      message: "The image link disappeared during upload. Try again.",
      retryable: true,
    };
  }
  return { ok: true, image: toDto(published), deduplicated: false };
}

type SimpleMutationResult =
  | { ok: true }
  | { ok: false; reason: string; message: string };

async function findImageLink(
  tx: Prisma.TransactionClient,
  productId: bigint,
  mediaPublicId: string,
) {
  return tx.productMedia.findFirst({
    where: {
      productId,
      variantId: null,
      media: { publicId: mediaPublicId, kind: "IMAGE", deletedAt: null },
    },
    select: {
      id: true,
      role: true,
      position: true,
      media: {
        select: {
          id: true,
          publicId: true,
          altText: true,
          title: true,
          bucket: true,
          storageKey: true,
          variants: true,
          uploadStatus: true,
        },
      },
    },
  });
}

export async function setPrimaryProductImage(input: {
  productPublicId: string;
  mediaPublicId: string;
}): Promise<SimpleMutationResult> {
  const authorization = await authorizeApiPermission("catalog.manage");
  if (!authorization.ok) {
    return { ok: false, reason: "unauthorized", message: "Administrator access is required." };
  }
  const actorUserId = authorization.session.user.id;

  try {
    return await withSerializableRetry(() =>
      getDb().$transaction(async (tx) => {
        const product = await requireImageProduct(tx, input.productPublicId);
        if (!product) {
          return { ok: false as const, reason: "product_not_found", message: "Product not found." };
        }
        const target = await findImageLink(tx, product.id, input.mediaPublicId);
        if (!target) {
          return { ok: false as const, reason: "image_not_found", message: "Image not found on this product." };
        }
        if (target.media.uploadStatus !== "READY") {
          return {
            ok: false as const,
            reason: "not_ready",
            message: "Only fully uploaded images can become the primary image.",
          };
        }
        if (target.role === "PRIMARY") {
          return { ok: true as const }; // Idempotent double-click.
        }

        const currentPrimary = await tx.productMedia.findFirst({
          where: { productId: product.id, variantId: null, role: "PRIMARY" },
          select: { id: true, media: { select: { publicId: true } } },
        });
        // Demote first: the partial unique index forbids two primaries.
        if (currentPrimary) {
          await tx.productMedia.update({
            where: { id: currentPrimary.id },
            data: { role: "GALLERY" },
            select: { id: true },
          });
        }
        await tx.productMedia.update({
          where: { id: target.id },
          data: { role: "PRIMARY" },
          select: { id: true },
        });

        await writeAdminAuditLog(tx, {
          actorUserId,
          action: "catalog.product.image.set_primary",
          resourceType: "product",
          resourceId: product.publicId,
          before: { primaryMediaPublicId: currentPrimary?.media.publicId ?? null },
          after: { primaryMediaPublicId: input.mediaPublicId },
        });
        await writeImageOutbox(tx, {
          aggregateId: product.publicId,
          eventType: "catalog.product.image.primary_changed",
          payload: {
            productPublicId: product.publicId,
            mediaPublicId: input.mediaPublicId,
          },
        });
        return { ok: true as const };
      }, transactionOptions()),
    );
  } catch {
    return {
      ok: false,
      reason: "conflict",
      message: "Another change collided with this update. Try again.",
    };
  }
}

export async function reorderProductImages(input: {
  productPublicId: string;
  orderedMediaPublicIds: string[];
}): Promise<SimpleMutationResult> {
  const authorization = await authorizeApiPermission("catalog.manage");
  if (!authorization.ok) {
    return { ok: false, reason: "unauthorized", message: "Administrator access is required." };
  }
  const actorUserId = authorization.session.user.id;
  const requestedIds = input.orderedMediaPublicIds;
  if (new Set(requestedIds).size !== requestedIds.length) {
    return { ok: false, reason: "invalid_order", message: "The order contains duplicates." };
  }

  try {
    return await withSerializableRetry(() =>
      getDb().$transaction(async (tx) => {
        const product = await requireImageProduct(tx, input.productPublicId);
        if (!product) {
          return { ok: false as const, reason: "product_not_found", message: "Product not found." };
        }
        const links = await tx.productMedia.findMany({
          where: {
            productId: product.id,
            variantId: null,
            role: { in: [...IMAGE_ROLES] },
            media: { kind: "IMAGE", deletedAt: null },
          },
          select: {
            id: true,
            position: true,
            media: { select: { publicId: true } },
          },
          orderBy: { position: "asc" },
        });
        const currentIds = links.map((link) => link.media.publicId);
        if (
          currentIds.length !== requestedIds.length ||
          new Set(currentIds).size !== new Set([...currentIds, ...requestedIds]).size
        ) {
          return {
            ok: false as const,
            reason: "stale_order",
            message: "The image list changed while reordering. Refresh and try again.",
          };
        }

        const byPublicId = new Map(links.map((link) => [link.media.publicId, link]));
        for (const [index, mediaPublicId] of requestedIds.entries()) {
          const link = byPublicId.get(mediaPublicId);
          if (link && link.position !== index) {
            await tx.productMedia.update({
              where: { id: link.id },
              data: { position: index },
              select: { id: true },
            });
          }
        }

        await writeAdminAuditLog(tx, {
          actorUserId,
          action: "catalog.product.image.reorder",
          resourceType: "product",
          resourceId: product.publicId,
          before: { order: currentIds },
          after: { order: requestedIds },
        });
        await writeImageOutbox(tx, {
          aggregateId: product.publicId,
          eventType: "catalog.product.image.reordered",
          payload: { productPublicId: product.publicId, order: requestedIds },
        });
        return { ok: true as const };
      }, transactionOptions()),
    );
  } catch {
    return {
      ok: false,
      reason: "conflict",
      message: "Another change collided with this update. Try again.",
    };
  }
}

export async function updateProductImageText(input: {
  productPublicId: string;
  mediaPublicId: string;
  altText: string | null;
  title: string | null;
}): Promise<SimpleMutationResult> {
  const authorization = await authorizeApiPermission("catalog.manage");
  if (!authorization.ok) {
    return { ok: false, reason: "unauthorized", message: "Administrator access is required." };
  }
  const actorUserId = authorization.session.user.id;
  const altText = input.altText?.trim().slice(0, 500) || null;
  const title = input.title?.trim().slice(0, 255) || null;

  try {
    return await withSerializableRetry(() =>
      getDb().$transaction(async (tx) => {
        const product = await requireImageProduct(tx, input.productPublicId);
        if (!product) {
          return { ok: false as const, reason: "product_not_found", message: "Product not found." };
        }
        const link = await findImageLink(tx, product.id, input.mediaPublicId);
        if (!link) {
          return { ok: false as const, reason: "image_not_found", message: "Image not found on this product." };
        }
        if (link.media.altText === altText && link.media.title === title) {
          return { ok: true as const };
        }
        await tx.media.update({
          where: { id: link.media.id },
          data: { altText, title },
          select: { id: true },
        });
        await writeAdminAuditLog(tx, {
          actorUserId,
          action: "catalog.product.image.text_update",
          resourceType: "media",
          resourceId: input.mediaPublicId,
          before: { altText: link.media.altText, title: link.media.title },
          after: { altText, title },
        });
        await writeImageOutbox(tx, {
          aggregateId: product.publicId,
          eventType: "catalog.product.image.text_updated",
          payload: {
            productPublicId: product.publicId,
            mediaPublicId: input.mediaPublicId,
          },
        });
        return { ok: true as const };
      }, transactionOptions()),
    );
  } catch {
    return {
      ok: false,
      reason: "conflict",
      message: "Another change collided with this update. Try again.",
    };
  }
}

export async function deleteProductImages(input: {
  productPublicId: string;
  mediaPublicIds: string[];
}): Promise<
  | { ok: true; deleted: string[]; skipped: { mediaPublicId: string; reason: string }[] }
  | { ok: false; reason: string; message: string }
> {
  const authorization = await authorizeApiPermission("catalog.manage");
  if (!authorization.ok) {
    return { ok: false, reason: "unauthorized", message: "Administrator access is required." };
  }
  const actorUserId = authorization.session.user.id;
  const uniqueIds = [...new Set(input.mediaPublicIds)];
  if (uniqueIds.length === 0) {
    return { ok: false, reason: "empty_selection", message: "Select at least one image." };
  }

  try {
    return await withSerializableRetry(() =>
      getDb().$transaction(async (tx) => {
        const product = await requireImageProduct(tx, input.productPublicId);
        if (!product) {
          return { ok: false as const, reason: "product_not_found", message: "Product not found." };
        }

        const deleted: string[] = [];
        const skipped: { mediaPublicId: string; reason: string }[] = [];

        for (const mediaPublicId of uniqueIds) {
          const link = await findImageLink(tx, product.id, mediaPublicId);
          if (!link) {
            // Idempotent: already removed counts as done.
            deleted.push(mediaPublicId);
            continue;
          }

          await tx.productMedia.delete({ where: { id: link.id }, select: { id: true } });

          // The shared media asset is only retired when nothing else uses it.
          const otherReferences = await tx.productMedia.count({
            where: { mediaId: link.media.id },
          });
          const heroReferences =
            (await tx.blogPost.count({ where: { heroMediaId: link.media.id } })) +
            (await tx.page.count({ where: { heroMediaId: link.media.id } })) +
            (await tx.seoMetadata.count({ where: { openGraphMediaId: link.media.id } }));

          let objectsScheduled = false;
          if (otherReferences === 0 && heroReferences === 0) {
            await tx.media.update({
              where: { id: link.media.id },
              data: { deletedAt: new Date() },
              select: { id: true },
            });
            const prefix = link.media.storageKey
              ? productImageKeyPrefixOf(link.media.storageKey)
              : null;
            if (link.media.bucket && prefix) {
              await requestStorageObjectCleanup(tx, {
                bucket: link.media.bucket,
                keys: allProductImageKeys(prefix),
                reason: "image_deleted",
                mediaPublicId,
              });
              objectsScheduled = true;
            }
          } else {
            skipped.push({
              mediaPublicId,
              reason: "The file is still referenced elsewhere; the link was removed but the asset is kept.",
            });
          }

          await writeAdminAuditLog(tx, {
            actorUserId,
            action:
              uniqueIds.length > 1
                ? "catalog.product.image.batch_delete"
                : "catalog.product.image.delete",
            resourceType: "media",
            resourceId: mediaPublicId,
            before: {
              productPublicId: product.publicId,
              role: link.role,
              position: link.position,
            },
            after: {
              detached: true,
              assetRetired: otherReferences === 0 && heroReferences === 0,
              objectsScheduled,
            },
          });
          deleted.push(mediaPublicId);
        }

        // Keep a primary if any image remains.
        const remaining = await tx.productMedia.findMany({
          where: {
            productId: product.id,
            variantId: null,
            role: { in: [...IMAGE_ROLES] },
            media: { kind: "IMAGE", deletedAt: null },
          },
          select: { id: true, role: true, position: true },
          orderBy: { position: "asc" },
        });
        if (remaining.length > 0 && !remaining.some((link) => link.role === "PRIMARY")) {
          await tx.productMedia.update({
            where: { id: remaining[0].id },
            data: { role: "PRIMARY" },
            select: { id: true },
          });
        }

        await writeImageOutbox(tx, {
          aggregateId: product.publicId,
          eventType: "catalog.product.image.deleted",
          payload: { productPublicId: product.publicId, mediaPublicIds: deleted },
        });

        return { ok: true as const, deleted, skipped };
      }, transactionOptions()),
    );
  } catch {
    return {
      ok: false,
      reason: "conflict",
      message: "Another change collided with this delete. Try again.",
    };
  }
}
