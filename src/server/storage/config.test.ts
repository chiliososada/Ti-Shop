import { describe, expect, it } from "vitest";

import {
  parseStorageRuntimeEnv,
  resolveStorageConfigState,
  type StorageRuntimeEnvInput,
} from "@/server/storage/config";

const VALID: StorageRuntimeEnvInput = {
  STORAGE_PROVIDER: "supabase",
  STORAGE_BUCKET_PRODUCT_IMAGES: "product-images",
  STORAGE_S3_ENDPOINT: "https://example.supabase.co/storage/v1/s3",
  STORAGE_S3_REGION: "ca-central-1",
  STORAGE_S3_ACCESS_KEY_ID: "test-access-key",
  STORAGE_S3_SECRET_ACCESS_KEY: "test-secret-key",
  STORAGE_PUBLIC_BASE_URL:
    "https://example.supabase.co/storage/v1/object/public/product-images",
};

describe("parseStorageRuntimeEnv", () => {
  it("parses a complete configuration with defaults", () => {
    const env = parseStorageRuntimeEnv(VALID, "production");
    expect(env.provider).toBe("supabase");
    expect(env.productImagesBucket).toBe("product-images");
    expect(env.s3ForcePathStyle).toBe(true);
    expect(env.productImageMaxBytes).toBe(10 * 1024 * 1024);
    expect([...env.productImageAllowedTypes].sort()).toEqual([
      "image/avif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    expect(env.publicBaseUrl).toBe(
      "https://example.supabase.co/storage/v1/object/public/product-images",
    );
  });

  it("strips trailing slashes from URLs", () => {
    const env = parseStorageRuntimeEnv(
      { ...VALID, STORAGE_PUBLIC_BASE_URL: `${VALID.STORAGE_PUBLIC_BASE_URL}/` },
      "production",
    );
    expect(env.publicBaseUrl.endsWith("/")).toBe(false);
  });

  it("allows http only for loopback outside production", () => {
    expect(
      parseStorageRuntimeEnv(
        {
          ...VALID,
          STORAGE_S3_ENDPOINT: "http://127.0.0.1:9000",
          STORAGE_PUBLIC_BASE_URL: "http://127.0.0.1:9000/product-images",
        },
        "development",
      ).s3Endpoint,
    ).toBe("http://127.0.0.1:9000");

    expect(() =>
      parseStorageRuntimeEnv(
        { ...VALID, STORAGE_S3_ENDPOINT: "http://127.0.0.1:9000" },
        "production",
      ),
    ).toThrow(/https/u);

    expect(() =>
      parseStorageRuntimeEnv(
        { ...VALID, STORAGE_S3_ENDPOINT: "http://storage.internal:9000" },
        "development",
      ),
    ).toThrow(/https/u);
  });

  it("rejects URLs with credentials, query, or fragment", () => {
    for (const bad of [
      "https://user:pass@example.com/s3",
      "https://example.com/s3?x=1",
      "https://example.com/s3#frag",
    ]) {
      expect(() =>
        parseStorageRuntimeEnv({ ...VALID, STORAGE_S3_ENDPOINT: bad }, "production"),
      ).toThrow();
    }
  });

  it("rejects SVG and non-image MIME allowlists", () => {
    expect(() =>
      parseStorageRuntimeEnv(
        { ...VALID, PRODUCT_IMAGE_ALLOWED_TYPES: "image/jpeg,image/svg+xml" },
        "production",
      ),
    ).toThrow(/svg/iu);
    expect(() =>
      parseStorageRuntimeEnv(
        { ...VALID, PRODUCT_IMAGE_ALLOWED_TYPES: "text/html" },
        "production",
      ),
    ).toThrow(/image MIME/u);
    expect(() =>
      parseStorageRuntimeEnv(
        { ...VALID, PRODUCT_IMAGE_ALLOWED_TYPES: " , " },
        "production",
      ),
    ).toThrow(/at least one/u);
  });

  it("rejects unsafe bucket names and providers", () => {
    expect(() =>
      parseStorageRuntimeEnv(
        { ...VALID, STORAGE_BUCKET_PRODUCT_IMAGES: "Bad Bucket" },
        "production",
      ),
    ).toThrow();
    expect(() =>
      parseStorageRuntimeEnv({ ...VALID, STORAGE_PROVIDER: "s3" }, "production"),
    ).toThrow();
  });
});

describe("resolveStorageConfigState", () => {
  it("reports unconfigured when nothing is set", () => {
    const state = resolveStorageConfigState({}, "production");
    expect(state.configured).toBe(false);
    if (!state.configured) {
      expect(state.reason).toMatch(/not configured/u);
    }
  });

  it("names missing variables for partial configuration", () => {
    const state = resolveStorageConfigState(
      { STORAGE_PROVIDER: "supabase" },
      "production",
    );
    expect(state.configured).toBe(false);
    if (!state.configured) {
      expect(state.reason).toContain("STORAGE_S3_ENDPOINT");
      expect(state.reason).not.toContain("STORAGE_PROVIDER,");
    }
  });

  it("surfaces validation failures as a reason instead of throwing", () => {
    const state = resolveStorageConfigState(
      { ...VALID, STORAGE_PUBLIC_BASE_URL: "not-a-url" },
      "production",
    );
    expect(state.configured).toBe(false);
  });

  it("returns the parsed environment when complete", () => {
    const state = resolveStorageConfigState(VALID, "production");
    expect(state.configured).toBe(true);
    if (state.configured) {
      expect(state.env.productImagesBucket).toBe("product-images");
    }
  });
});
