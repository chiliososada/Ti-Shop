import { randomUUID } from "node:crypto";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "", allowed: true }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  authorizeApiPermission: vi.fn(async () =>
    authorization.allowed
      ? {
          ok: true,
          session: { user: { id: authorization.actorUserId } },
          roles: ["integration-test"],
          permissions: new Set(["catalog.read", "catalog.manage"]),
        }
      : { ok: false, status: 403 },
  ),
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set(["catalog.read", "catalog.manage"]),
  })),
}));

import {
  deleteProductImages,
  reorderProductImages,
  setPrimaryProductImage,
  updateProductImageText,
  uploadProductImage,
} from "@/server/admin/catalog/product-images/mutations";
import { getDb } from "@/server/db/client";
import { getStorageConfigState } from "@/server/storage/config";
import {
  deleteProductImageOrphans,
  scanProductImageOrphans,
} from "@/server/storage/orphan-scan";
import { processStorageOutboxBatch } from "@/server/storage/outbox-worker";
import { getProductImageStorage } from "@/server/storage/provider";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const storageEndpoint = process.env.STORAGE_TEST_S3_ENDPOINT;
const integration = databaseUrl && storageEndpoint ? describe : describe.skip;

const TEST_BUCKET = process.env.STORAGE_TEST_BUCKET ?? "product-images-test";

async function imageBytes(seed: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: {
        width: 900,
        height: 600,
        channels: 3,
        background: { r: seed % 255, g: (seed * 7) % 255, b: (seed * 13) % 255 },
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer(),
  );
}

integration("product image mutations (database + real object storage)", () => {
  const suffix = randomUUID();
  let productPublicId = "";
  let productId = bigint0();
  let firstMediaId = "";
  let secondMediaId = "";

  function bigint0() {
    return BigInt(0);
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.STORAGE_PROVIDER = "supabase";
    process.env.STORAGE_BUCKET_PRODUCT_IMAGES = TEST_BUCKET;
    process.env.STORAGE_S3_ENDPOINT = storageEndpoint;
    process.env.STORAGE_S3_REGION = process.env.STORAGE_TEST_S3_REGION ?? "us-east-1";
    process.env.STORAGE_S3_ACCESS_KEY_ID = process.env.STORAGE_TEST_S3_ACCESS_KEY_ID;
    process.env.STORAGE_S3_SECRET_ACCESS_KEY =
      process.env.STORAGE_TEST_S3_SECRET_ACCESS_KEY;
    process.env.STORAGE_PUBLIC_BASE_URL = `${storageEndpoint}/${TEST_BUCKET}`;

    const state = getStorageConfigState();
    if (!state.configured) throw new Error(`storage misconfigured: ${state.reason}`);

    const actor = await getDb().user.create({
      data: {
        name: "Product image integration admin",
        email: `image-admin-${suffix}@example.invalid`,
        adminProfile: { create: { isActive: true } },
      },
      select: { id: true },
    });
    authorization.actorUserId = actor.id;

    const product = await getDb().product.create({
      data: { slug: `image-it-${suffix.slice(0, 8)}`, title: "Image IT product" },
      select: { id: true, publicId: true },
    });
    productPublicId = product.publicId;
    productId = product.id;
  });

  afterAll(async () => {
    const db = getDb();
    const media = await db.media.findMany({
      where: { bucket: TEST_BUCKET, createdByUserId: authorization.actorUserId },
      select: { id: true, storageKey: true },
    });
    await db.productMedia.deleteMany({ where: { productId } });
    await db.auditLog.deleteMany({ where: { actorUserId: authorization.actorUserId } });
    await db.outboxEvent.deleteMany({
      where: {
        OR: [
          { aggregateId: productPublicId },
          { eventType: { startsWith: "storage." } },
        ],
      },
    });
    await db.media.deleteMany({ where: { id: { in: media.map((row) => row.id) } } });
    await db.product.delete({ where: { id: productId } });
    await db.user.delete({ where: { id: authorization.actorUserId } });
    const keys = media.flatMap((row) => {
      const prefix = row.storageKey.slice(0, row.storageKey.lastIndexOf("/"));
      return ["original", "thumb", "card", "detail"].map((v) => `${prefix}/${v}.webp`);
    });
    if (keys.length > 0) await getProductImageStorage().deleteObjects(keys);
  });

  it("uploads a first image as PRIMARY with real stored renditions, audit, and outbox", async () => {
    const bytes = await imageBytes(1);
    const result = await uploadProductImage({
      productPublicId,
      bytes,
      declaredMimeType: "image/jpeg",
      originalFilename: "first photo.jpg",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deduplicated).toBe(false);
    expect(result.image.role).toBe("PRIMARY");
    expect(result.image.uploadStatus).toBe("READY");
    expect(result.image.urls?.thumb).toContain(`${storageEndpoint}/${TEST_BUCKET}/products/`);
    firstMediaId = result.image.mediaPublicId;

    const media = await getDb().media.findUniqueOrThrow({
      where: { publicId: firstMediaId },
      select: { storageKey: true, uploadStatus: true, width: true, height: true, checksum: true },
    });
    expect(media.uploadStatus).toBe("READY");
    expect(media.width).toBe(900);
    expect(media.checksum).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const storage = getProductImageStorage();
    expect(await storage.objectExists(media.storageKey)).toBe(true);
    const prefix = media.storageKey.slice(0, media.storageKey.lastIndexOf("/"));
    for (const variant of ["thumb", "card", "detail"]) {
      expect(await storage.objectExists(`${prefix}/${variant}.webp`)).toBe(true);
    }

    const audit = await getDb().auditLog.findFirst({
      where: {
        actorUserId: authorization.actorUserId,
        action: "catalog.product.image.upload",
        resourceId: firstMediaId,
      },
      select: { id: true },
    });
    expect(audit).not.toBeNull();
    const outbox = await getDb().outboxEvent.findFirst({
      where: { eventType: "catalog.product.image.uploaded", aggregateId: productPublicId },
      select: { id: true },
    });
    expect(outbox).not.toBeNull();
  });

  it("returns the existing image for a duplicate upload (idempotent double submit)", async () => {
    const bytes = await imageBytes(1);
    const result = await uploadProductImage({
      productPublicId,
      bytes,
      declaredMimeType: "image/jpeg",
      originalFilename: "first photo copy.jpg",
    });
    expect(result.ok && result.deduplicated).toBe(true);
    if (result.ok) {
      expect(result.image.mediaPublicId).toBe(firstMediaId);
    }
    const links = await getDb().productMedia.count({ where: { productId } });
    expect(links).toBe(1);
  });

  it("uploads a second image as GALLERY at the next position", async () => {
    const result = await uploadProductImage({
      productPublicId,
      bytes: await imageBytes(2),
      declaredMimeType: "image/jpeg",
      originalFilename: "second.jpg",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.image.role).toBe("GALLERY");
    expect(result.image.position).toBe(1);
    secondMediaId = result.image.mediaPublicId;
  });

  it("rejects disguised and undecodable uploads without leaving records", async () => {
    const before = await getDb().media.count({ where: { bucket: TEST_BUCKET } });
    const garbage = await uploadProductImage({
      productPublicId,
      bytes: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      declaredMimeType: "image/png",
      originalFilename: "attack.png",
    });
    expect(garbage.ok).toBe(false);
    if (!garbage.ok) expect(garbage.reason).toBe("validation_failed");
    expect(await getDb().media.count({ where: { bucket: TEST_BUCKET } })).toBe(before);
  });

  it("refuses uploads without catalog.manage", async () => {
    authorization.allowed = false;
    try {
      const result = await uploadProductImage({
        productPublicId,
        bytes: await imageBytes(3),
        declaredMimeType: "image/jpeg",
        originalFilename: "nope.jpg",
      });
      expect(!result.ok && result.reason).toBe("unauthorized");
    } finally {
      authorization.allowed = true;
    }
  });

  it("keeps exactly one primary image under concurrent promotion", async () => {
    const outcomes = await Promise.all([
      setPrimaryProductImage({ productPublicId, mediaPublicId: secondMediaId }),
      setPrimaryProductImage({ productPublicId, mediaPublicId: firstMediaId }),
      setPrimaryProductImage({ productPublicId, mediaPublicId: secondMediaId }),
    ]);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    const primaries = await getDb().productMedia.count({
      where: { productId, role: "PRIMARY", variantId: null },
    });
    expect(primaries).toBe(1);
  });

  it("reorders images stably and rejects stale orders", async () => {
    const stale = await reorderProductImages({
      productPublicId,
      orderedMediaPublicIds: [firstMediaId],
    });
    expect(!stale.ok && stale.reason).toBe("stale_order");

    const reorder = await reorderProductImages({
      productPublicId,
      orderedMediaPublicIds: [secondMediaId, firstMediaId],
    });
    expect(reorder.ok).toBe(true);
    const links = await getDb().productMedia.findMany({
      where: { productId },
      orderBy: { position: "asc" },
      select: { position: true, media: { select: { publicId: true } } },
    });
    expect(links.map((link) => link.media.publicId)).toEqual([secondMediaId, firstMediaId]);
    expect(links.map((link) => link.position)).toEqual([0, 1]);

    // Idempotent resubmission of the same order.
    const again = await reorderProductImages({
      productPublicId,
      orderedMediaPublicIds: [secondMediaId, firstMediaId],
    });
    expect(again.ok).toBe(true);
  });

  it("updates alt text and title with an audit trail", async () => {
    const result = await updateProductImageText({
      productPublicId,
      mediaPublicId: firstMediaId,
      altText: "Amber vial on a laboratory bench",
      title: "Vial photo",
    });
    expect(result.ok).toBe(true);
    const media = await getDb().media.findUniqueOrThrow({
      where: { publicId: firstMediaId },
      select: { altText: true, title: true },
    });
    expect(media.altText).toBe("Amber vial on a laboratory bench");
    expect(media.title).toBe("Vial photo");
    const audit = await getDb().auditLog.findFirst({
      where: { action: "catalog.product.image.text_update", resourceId: firstMediaId },
      select: { id: true },
    });
    expect(audit).not.toBeNull();
  });

  it("deletes an image, promotes a remaining primary, and cleans objects through the outbox worker", async () => {
    const primaryLink = await getDb().productMedia.findFirstOrThrow({
      where: { productId, role: "PRIMARY", variantId: null },
      select: { media: { select: { publicId: true, storageKey: true } } },
    });
    const deletedMediaId = primaryLink.media.publicId;
    const prefix = primaryLink.media.storageKey.slice(
      0,
      primaryLink.media.storageKey.lastIndexOf("/"),
    );

    const result = await deleteProductImages({
      productPublicId,
      mediaPublicIds: [deletedMediaId],
    });
    expect(result.ok).toBe(true);

    // Exactly one image remains and it took over the primary role.
    const remaining = await getDb().productMedia.findMany({
      where: { productId, variantId: null },
      select: { role: true, media: { select: { publicId: true } } },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].role).toBe("PRIMARY");

    const media = await getDb().media.findUniqueOrThrow({
      where: { publicId: deletedMediaId },
      select: { deletedAt: true },
    });
    expect(media.deletedAt).not.toBeNull();

    // Redelivery is safe: run the worker twice.
    const run = await processStorageOutboxBatch({ limit: 50 });
    expect(run.published).toBeGreaterThanOrEqual(1);
    const rerun = await processStorageOutboxBatch({ limit: 50 });
    expect(rerun.claimed).toBe(0);

    const storage = getProductImageStorage();
    for (const variant of ["original", "thumb", "card", "detail"]) {
      expect(await storage.objectExists(`${prefix}/${variant}.webp`)).toBe(false);
    }

    // Repeated delete of the same image is a success (idempotent).
    const repeat = await deleteProductImages({
      productPublicId,
      mediaPublicIds: [deletedMediaId],
    });
    expect(repeat.ok && repeat.deleted).toContain(deletedMediaId);
  });

  it("permanently fails cleanup events aimed at a foreign bucket", async () => {
    const rogueId = randomUUID();
    await getDb().outboxEvent.create({
      data: {
        aggregateType: "storage_object",
        aggregateId: rogueId,
        eventType: "storage.objects.delete_requested",
        payload: {
          bucket: "someone-elses-bucket",
          keys: [`products/${randomUUID()}/${randomUUID()}/original.webp`],
          reason: "test",
        },
      },
      select: { id: true },
    });
    const run = await processStorageOutboxBatch({ limit: 50 });
    expect(run.failedPermanently).toBeGreaterThanOrEqual(1);
    const event = await getDb().outboxEvent.findFirst({
      where: { aggregateId: rogueId },
      select: { status: true, lastError: true },
    });
    expect(event?.status).toBe("FAILED");
    expect(event?.lastError).toMatch(/bucket/iu);
  });

  it("reaps stale UPLOADING rows and schedules their cleanup", async () => {
    const staleKeyPrefix = `products/${productPublicId}/${randomUUID()}`;
    const staleKey = `${staleKeyPrefix}/original.webp`;
    const storage = getProductImageStorage();
    await storage.putObject({
      key: staleKey,
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/webp",
    });
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    const stale = await getDb().media.create({
      data: {
        kind: "IMAGE",
        storageProvider: "supabase-s3",
        storageKey: staleKey,
        bucket: TEST_BUCKET,
        uploadStatus: "UPLOADING",
        createdByUserId: authorization.actorUserId,
      },
      select: { id: true, publicId: true },
    });
    await getDb().$executeRaw`
      UPDATE "app"."media" SET "updated_at" = ${twoHoursAgo} WHERE "id" = ${stale.id}
    `;

    const run = await processStorageOutboxBatch({ limit: 50 });
    expect(run.reapedUploads).toBeGreaterThanOrEqual(1);

    const media = await getDb().media.findUniqueOrThrow({
      where: { id: stale.id },
      select: { uploadStatus: true, deletedAt: true },
    });
    expect(media.uploadStatus).toBe("FAILED");
    expect(media.deletedAt).not.toBeNull();
    expect(await storage.objectExists(staleKey)).toBe(false);
  });

  it("reports orphan objects without deleting, then deletes only with an admin actor", async () => {
    const orphanKey = `products/${randomUUID()}/${randomUUID()}/original.webp`;
    const storage = getProductImageStorage();
    await storage.putObject({
      key: orphanKey,
      body: new Uint8Array([9, 9, 9]),
      contentType: "image/webp",
    });

    // Inside the grace window the object is protected.
    const guarded = await scanProductImageOrphans({ graceMinutes: 60 });
    expect(guarded.orphans.map((o) => o.key)).not.toContain(orphanKey);
    expect(guarded.skippedRecent).toBeGreaterThanOrEqual(1);

    // With no grace the object is reported — but still not deleted.
    const report = await scanProductImageOrphans({ graceMinutes: 0 });
    expect(report.orphans.map((o) => o.key)).toContain(orphanKey);
    expect(await storage.objectExists(orphanKey)).toBe(true);

    await expect(
      deleteProductImageOrphans({ keys: [orphanKey], actorUserId: randomUUID() }),
    ).rejects.toThrow(/administrator/iu);
    expect(await storage.objectExists(orphanKey)).toBe(true);

    const deletion = await deleteProductImageOrphans({
      keys: [orphanKey],
      actorUserId: authorization.actorUserId,
    });
    expect(deletion.deleted).toContain(orphanKey);
    expect(await storage.objectExists(orphanKey)).toBe(false);

    const audit = await getDb().auditLog.findFirst({
      where: { action: "storage.orphans.delete", actorUserId: authorization.actorUserId },
      select: { id: true },
    });
    expect(audit).not.toBeNull();
  });
});
