import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseStorageRuntimeEnv } from "@/server/storage/config";
import { StorageError } from "@/server/storage/errors";
import { createS3StorageProvider } from "@/server/storage/s3-provider";

const endpoint = process.env.STORAGE_TEST_S3_ENDPOINT;
const integration = endpoint ? describe : describe.skip;

function testEnv(overrides?: Partial<Record<string, string>>) {
  return parseStorageRuntimeEnv(
    {
      STORAGE_PROVIDER: "supabase",
      STORAGE_BUCKET_PRODUCT_IMAGES:
        process.env.STORAGE_TEST_BUCKET ?? "product-images-test",
      STORAGE_S3_ENDPOINT: endpoint,
      STORAGE_S3_REGION: process.env.STORAGE_TEST_S3_REGION ?? "us-east-1",
      STORAGE_S3_ACCESS_KEY_ID: process.env.STORAGE_TEST_S3_ACCESS_KEY_ID,
      STORAGE_S3_SECRET_ACCESS_KEY: process.env.STORAGE_TEST_S3_SECRET_ACCESS_KEY,
      STORAGE_PUBLIC_BASE_URL: `${endpoint}/${process.env.STORAGE_TEST_BUCKET ?? "product-images-test"}`,
      STORAGE_REQUEST_TIMEOUT_MS: "5000",
      ...overrides,
    },
    "test",
  );
}

// Every test key lives under a unique run prefix so parallel/failed runs never
// touch each other, and cleanup removes exactly this run's objects.
const runPrefix = `products/${randomUUID()}/${randomUUID()}`;
const createdKeys: string[] = [];

function keyOf(name: string) {
  const key = `${runPrefix}-${name}/original.webp`;
  createdKeys.push(key);
  return key;
}

integration("S3-compatible storage provider (real backend)", () => {
  const provider = createS3StorageProvider(testEnv());

  afterAll(async () => {
    await provider.deleteObjects(createdKeys);
  });

  it("uploads, heads, downloads, and deletes an object", async () => {
    const key = keyOf("roundtrip");
    const body = new TextEncoder().encode("webp-bytes-placeholder");
    await provider.putObject({ key, body, contentType: "image/webp" });

    const head = await provider.headObject(key);
    expect(head?.sizeBytes).toBe(body.length);
    expect(head?.contentType).toBe("image/webp");
    expect(await provider.objectExists(key)).toBe(true);

    const downloaded = await provider.getObject(key);
    expect(new TextDecoder().decode(downloaded)).toBe("webp-bytes-placeholder");

    await provider.deleteObject(key);
    expect(await provider.objectExists(key)).toBe(false);
  });

  it("treats deleting a missing object as success (idempotent)", async () => {
    const key = keyOf("missing");
    await expect(provider.deleteObject(key)).resolves.toBeUndefined();
    const batch = await provider.deleteObjects([key, key]);
    expect(batch.failed).toEqual([]);
    expect(batch.deleted).toContain(key);
  });

  it("returns null head and not_found get for absent objects", async () => {
    const key = keyOf("absent");
    expect(await provider.headObject(key)).toBeNull();
    await expect(provider.getObject(key)).rejects.toMatchObject({
      category: "not_found",
    });
  });

  it("lists objects under a prefix with pagination fields", async () => {
    const keyA = keyOf("list-a");
    const keyB = keyOf("list-b");
    const body = new TextEncoder().encode("x");
    await provider.putObject({ key: keyA, body, contentType: "image/webp" });
    await provider.putObject({ key: keyB, body, contentType: "image/webp" });

    const listed = await provider.listObjects({ prefix: `${runPrefix}-list-` });
    const keys = listed.objects.map((object) => object.key).sort();
    expect(keys).toEqual([keyA, keyB].sort());
  });

  it("rejects wrong credentials with a non-retryable access error", async () => {
    const badProvider = createS3StorageProvider(
      testEnv({ STORAGE_S3_SECRET_ACCESS_KEY: "wrong-secret-key" }),
    );
    const key = keyOf("denied");
    await expect(
      badProvider.putObject({
        key,
        body: new Uint8Array([1]),
        contentType: "image/webp",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof StorageError &&
        error.category === "access_denied" &&
        !error.isRetryable
      );
    });
  });

  it("classifies an unreachable endpoint as retryable", async () => {
    const downProvider = createS3StorageProvider(
      testEnv({ STORAGE_S3_ENDPOINT: "http://127.0.0.1:9" }),
    );
    await expect(downProvider.healthCheck()).resolves.toMatchObject({ ok: false });
    await expect(
      downProvider.putObject({
        key: keyOf("unreachable"),
        body: new Uint8Array([1]),
        contentType: "image/webp",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof StorageError && error.isRetryable,
    );
  });

  it("passes a health check against the real bucket", async () => {
    await expect(provider.healthCheck()).resolves.toMatchObject({ ok: true });
  });

  it("refuses malformed object keys before any request is sent", async () => {
    for (const key of ["../escape", "a//b", "/leading", "white space", ""]) {
      await expect(
        provider.putObject({ key, body: new Uint8Array([1]), contentType: "image/webp" }),
      ).rejects.toMatchObject({ category: "invalid_request" });
    }
  });
});
