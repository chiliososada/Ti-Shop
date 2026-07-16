import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { getDb } from "@/server/db/client";
import { getStorageConfigState } from "@/server/storage/config";
import { isProductImageKey } from "@/server/storage/keys";
import { getProductImageStorage } from "@/server/storage/provider";

export const STORAGE_OUTBOX_EVENT_PREFIX = "storage.";
const MAX_DELIVERY_ATTEMPTS = 12;
const MAX_BACKOFF_SECONDS = 3_600;

const deletePayloadSchema = z.object({
  bucket: z.string().min(1),
  keys: z.array(z.string().min(1)).min(1).max(64),
  reason: z.string().optional(),
  mediaPublicId: z.string().optional(),
});

type ClaimedEvent = {
  id: bigint;
  event_type: string;
  payload: unknown;
  attempts: number;
};

export type StorageOutboxRunReport = {
  claimed: number;
  published: number;
  retried: number;
  failedPermanently: number;
  reapedUploads: number;
  details: {
    outboxId: string;
    eventType: string;
    outcome: "published" | "retried" | "failed";
    error: string | null;
  }[];
};

function backoffSeconds(attempts: number): number {
  return Math.min(2 ** Math.min(attempts, 12), MAX_BACKOFF_SECONDS);
}

/**
 * Marks UPLOADING media rows that never completed (crashed process, lost
 * connection) as FAILED, detaches them, and schedules their objects for
 * deletion. Runs before delivery so freshly scheduled cleanups can be
 * processed in the same invocation.
 */
async function reapStaleUploads(now: Date, olderThanMinutes: number): Promise<number> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - olderThanMinutes * 60_000);
  const stale = await db.media.findMany({
    where: {
      uploadStatus: "UPLOADING",
      deletedAt: null,
      bucket: { not: null },
      updatedAt: { lt: cutoff },
    },
    select: { id: true, publicId: true, bucket: true, storageKey: true },
    take: 50,
  });

  for (const media of stale) {
    const prefix = media.storageKey.slice(0, media.storageKey.lastIndexOf("/"));
    const keys = ["original", "thumb", "card", "detail"].map(
      (variant) => `${prefix}/${variant}.webp`,
    );
    await db.$transaction(async (tx) => {
      await tx.media.update({
        where: { id: media.id },
        data: { uploadStatus: "FAILED", deletedAt: now },
        select: { id: true },
      });
      await tx.productMedia.deleteMany({ where: { mediaId: media.id } });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "storage_object",
          aggregateId: media.publicId,
          eventType: "storage.objects.delete_requested",
          // Backdated to the batch timestamp so the same worker invocation
          // that reaped the upload also delivers its cleanup.
          availableAt: now,
          payload: {
            bucket: media.bucket as string,
            keys,
            reason: "stale_upload_reaped",
            mediaPublicId: media.publicId,
          },
        },
        select: { id: true },
      });
    });
  }
  return stale.length;
}

/**
 * Claims and delivers pending storage.* outbox events. Uses FOR UPDATE SKIP
 * LOCKED so concurrent workers never double-deliver, and object deletion is
 * idempotent so redelivery after a crash is safe.
 */
export async function processStorageOutboxBatch(input?: {
  limit?: number;
  now?: Date;
  reapStaleUploadsAfterMinutes?: number;
}): Promise<StorageOutboxRunReport> {
  const limit = Math.min(Math.max(input?.limit ?? 25, 1), 100);
  const now = input?.now ?? new Date();
  const lockedBy = `storage-worker-${randomUUID().slice(0, 8)}`;
  const db = getDb();

  const report: StorageOutboxRunReport = {
    claimed: 0,
    published: 0,
    retried: 0,
    failedPermanently: 0,
    reapedUploads: 0,
    details: [],
  };

  report.reapedUploads = await reapStaleUploads(
    now,
    input?.reapStaleUploadsAfterMinutes ?? 60,
  );

  const claimed = await db.$queryRaw<ClaimedEvent[]>`
    UPDATE "app"."outbox_events"
    SET "status" = 'processing', "locked_at" = ${now}, "locked_by" = ${lockedBy}
    WHERE "id" IN (
      SELECT "id" FROM "app"."outbox_events"
      WHERE "status" = 'pending'
        AND "event_type" LIKE 'storage.%'
        AND "available_at" <= ${now}
      ORDER BY "available_at", "id"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "event_type", "payload", "attempts"
  `;
  report.claimed = claimed.length;

  const storageState = getStorageConfigState();

  for (const event of claimed) {
    const outboxId = String(event.id);
    const attempts = event.attempts + 1;

    const complete = async (
      outcome: "published" | "retried" | "failed",
      error: string | null,
    ) => {
      await db.outboxEvent.update({
        where: { id: event.id },
        data:
          outcome === "published"
            ? {
                status: "PUBLISHED",
                attempts,
                publishedAt: now,
                lockedAt: null,
                lockedBy: null,
                lastError: null,
              }
            : outcome === "retried"
              ? {
                  status: "PENDING",
                  attempts,
                  availableAt: new Date(now.getTime() + backoffSeconds(attempts) * 1_000),
                  lockedAt: null,
                  lockedBy: null,
                  lastError: error,
                }
              : {
                  status: "FAILED",
                  attempts,
                  lockedAt: null,
                  lockedBy: null,
                  lastError: error,
                },
        select: { id: true },
      });
      report.details.push({ outboxId, eventType: event.event_type, outcome, error });
      if (outcome === "published") report.published += 1;
      else if (outcome === "retried") report.retried += 1;
      else report.failedPermanently += 1;
    };

    if (event.event_type !== "storage.objects.delete_requested") {
      await complete("failed", `Unsupported storage event type: ${event.event_type}`);
      continue;
    }

    const payload = deletePayloadSchema.safeParse(event.payload);
    if (!payload.success) {
      await complete("failed", "Malformed storage cleanup payload.");
      continue;
    }

    if (!storageState.configured) {
      await complete(
        attempts >= MAX_DELIVERY_ATTEMPTS ? "failed" : "retried",
        "Object storage is not configured.",
      );
      continue;
    }
    if (payload.data.bucket !== storageState.env.productImagesBucket) {
      await complete("failed", "Cleanup bucket does not match the configured bucket.");
      continue;
    }
    const invalidKey = payload.data.keys.find((key) => !isProductImageKey(key));
    if (invalidKey) {
      await complete("failed", "Cleanup payload contains a non-product-image key.");
      continue;
    }

    try {
      const storage = getProductImageStorage();
      const result = await storage.deleteObjects(payload.data.keys);
      if (result.failed.length === 0) {
        await complete("published", null);
      } else {
        const message = result.failed
          .map((entry) => `${entry.key}: ${entry.message}`)
          .join("; ")
          .slice(0, 900);
        await complete(attempts >= MAX_DELIVERY_ATTEMPTS ? "failed" : "retried", message);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 900) : "unknown storage failure";
      await complete(attempts >= MAX_DELIVERY_ATTEMPTS ? "failed" : "retried", message);
    }
  }

  return report;
}
