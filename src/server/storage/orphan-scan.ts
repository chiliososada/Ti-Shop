import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import { getDb } from "@/server/db/client";
import { getStorageConfigState } from "@/server/storage/config";
import { isProductImageKey, productImageKeyPrefixOf } from "@/server/storage/keys";
import { getProductImageStorage } from "@/server/storage/provider";
import type { StorageListedObject } from "@/server/storage/types";

export type OrphanScanReport = {
  bucket: string;
  scannedObjects: number;
  knownPrefixes: number;
  graceMinutes: number;
  orphans: { key: string; sizeBytes: number; lastModified: string | null }[];
  skippedRecent: number;
  foreignKeys: string[];
};

/**
 * Collects every object-key prefix the database still claims, including
 * FAILED/soft-deleted rows whose cleanup may still be queued. Orphan deletion
 * must be conservative: an object is only an orphan when no row of any status
 * references its prefix.
 */
async function knownPrefixes(bucket: string): Promise<Set<string>> {
  const db = getDb();
  const rows = await db.media.findMany({
    where: { bucket },
    select: { storageKey: true },
  });
  const prefixes = new Set<string>();
  for (const row of rows) {
    const prefix = productImageKeyPrefixOf(row.storageKey);
    if (prefix) prefixes.add(prefix);
  }
  return prefixes;
}

export async function scanProductImageOrphans(input?: {
  graceMinutes?: number;
  maxObjects?: number;
  now?: Date;
}): Promise<OrphanScanReport> {
  const state = getStorageConfigState();
  if (!state.configured) {
    throw new Error(state.reason);
  }
  const graceMinutes = Math.max(input?.graceMinutes ?? 60, 0);
  const maxObjects = Math.min(Math.max(input?.maxObjects ?? 50_000, 1), 200_000);
  const now = input?.now ?? new Date();
  const cutoff = new Date(now.getTime() - graceMinutes * 60_000);

  const storage = getProductImageStorage();
  const prefixes = await knownPrefixes(state.env.productImagesBucket);

  const orphans: OrphanScanReport["orphans"] = [];
  const foreignKeys: string[] = [];
  let scanned = 0;
  let skippedRecent = 0;
  let continuationToken: string | null = null;

  do {
    const page = await storage.listObjects({
      prefix: "products/",
      maxKeys: 1000,
      continuationToken: continuationToken ?? undefined,
    });
    for (const object of page.objects as StorageListedObject[]) {
      scanned += 1;
      if (scanned > maxObjects) {
        continuationToken = null;
        break;
      }
      if (!isProductImageKey(object.key)) {
        foreignKeys.push(object.key);
        continue;
      }
      const prefix = productImageKeyPrefixOf(object.key);
      if (prefix && prefixes.has(prefix)) {
        continue;
      }
      // Objects newer than the grace window may belong to an upload whose
      // database transaction has not committed yet.
      if (object.lastModified && object.lastModified > cutoff) {
        skippedRecent += 1;
        continue;
      }
      orphans.push({
        key: object.key,
        sizeBytes: object.sizeBytes,
        lastModified: object.lastModified?.toISOString() ?? null,
      });
    }
    continuationToken =
      scanned > maxObjects ? null : page.nextContinuationToken;
  } while (continuationToken);

  return {
    bucket: state.env.productImagesBucket,
    scannedObjects: scanned,
    knownPrefixes: prefixes.size,
    graceMinutes,
    orphans,
    skippedRecent,
    foreignKeys,
  };
}

export type OrphanDeletionReport = {
  requested: number;
  deleted: string[];
  refused: { key: string; reason: string }[];
};

/**
 * Deletes previously reported orphan objects. Deliberately strict: the actor
 * must be a real administrator account (recorded in the audit log), every key
 * must be a product-image key, and each key is re-verified as orphaned at
 * deletion time.
 */
export async function deleteProductImageOrphans(input: {
  keys: readonly string[];
  actorUserId: string;
}): Promise<OrphanDeletionReport> {
  const state = getStorageConfigState();
  if (!state.configured) {
    throw new Error(state.reason);
  }
  const db = getDb();
  const actor = await db.user.findUnique({
    where: { id: input.actorUserId },
    select: { id: true, adminProfile: { select: { isActive: true } } },
  });
  if (!actor?.adminProfile?.isActive) {
    throw new Error("The provided actor is not an active administrator.");
  }

  const prefixes = await knownPrefixes(state.env.productImagesBucket);
  const refused: OrphanDeletionReport["refused"] = [];
  const deletable: string[] = [];
  for (const key of new Set(input.keys)) {
    if (!isProductImageKey(key)) {
      refused.push({ key, reason: "not a product image key" });
      continue;
    }
    const prefix = productImageKeyPrefixOf(key);
    if (prefix && prefixes.has(prefix)) {
      refused.push({ key, reason: "still referenced by a media row" });
      continue;
    }
    deletable.push(key);
  }

  let deleted: string[] = [];
  if (deletable.length > 0) {
    const storage = getProductImageStorage();
    const result = await storage.deleteObjects(deletable);
    deleted = result.deleted;
    for (const failure of result.failed) {
      refused.push({ key: failure.key, reason: failure.message });
    }
    await db.$transaction(async (tx) => {
      await writeAdminAuditLog(tx, {
        actorUserId: input.actorUserId,
        action: "storage.orphans.delete",
        resourceType: "storage_bucket",
        resourceId: state.env.productImagesBucket,
        before: { requestedKeys: [...new Set(input.keys)] } as Prisma.InputJsonObject,
        after: {
          deletedKeys: deleted,
          refused: refused.map((entry) => entry.key),
        } as Prisma.InputJsonObject,
      });
    });
  }

  return { requested: input.keys.length, deleted, refused };
}
