import { z } from "zod";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_ALLOWED_TYPES = "image/jpeg,image/png,image/webp,image/avif";

const IMAGE_MIME_PATTERN = /^image\/[a-z0-9.+-]+$/u;

const storageEnvSchema = z.object({
  STORAGE_PROVIDER: z.literal("supabase"),
  STORAGE_BUCKET_PRODUCT_IMAGES: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9._-]*$/u, {
      message: "bucket must be a lowercase S3-safe name",
    }),
  STORAGE_S3_ENDPOINT: z.string().min(1),
  STORAGE_S3_REGION: z.string().min(1).max(64),
  STORAGE_S3_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1),
  STORAGE_PUBLIC_BASE_URL: z.string().min(1),
  STORAGE_S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true"),
  STORAGE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  PRODUCT_IMAGE_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(50 * 1024 * 1024)
    .default(DEFAULT_MAX_BYTES),
  PRODUCT_IMAGE_ALLOWED_TYPES: z.string().default(DEFAULT_ALLOWED_TYPES),
});

export type StorageRuntimeEnvInput = Partial<
  Record<keyof z.infer<typeof storageEnvSchema>, string | undefined>
>;

export type StorageRuntimeEnv = {
  provider: "supabase";
  productImagesBucket: string;
  s3Endpoint: string;
  s3Region: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3ForcePathStyle: boolean;
  requestTimeoutMs: number;
  /** Origin+path prefix that serves public objects of the product bucket. */
  publicBaseUrl: string;
  productImageMaxBytes: number;
  productImageAllowedTypes: ReadonlySet<string>;
};

const CONFIG_KEYS = [
  "STORAGE_PROVIDER",
  "STORAGE_BUCKET_PRODUCT_IMAGES",
  "STORAGE_S3_ENDPOINT",
  "STORAGE_S3_REGION",
  "STORAGE_S3_ACCESS_KEY_ID",
  "STORAGE_S3_SECRET_ACCESS_KEY",
  "STORAGE_PUBLIC_BASE_URL",
] as const;

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

function normalizeHttpUrl(
  value: string,
  label: string,
  nodeEnv: string | undefined,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label} must use http:// or https://.`);
  }
  if (
    url.protocol === "http:" &&
    (nodeEnv === "production" || !isLoopbackHost(url.hostname))
  ) {
    throw new Error(`${label} must use https:// outside loopback development.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must not contain credentials, query, or fragment.`);
  }
  return url.toString().replace(/\/+$/u, "");
}

function parseAllowedTypes(raw: string): ReadonlySet<string> {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0) {
    throw new Error("PRODUCT_IMAGE_ALLOWED_TYPES must list at least one MIME type.");
  }
  for (const entry of entries) {
    if (!IMAGE_MIME_PATTERN.test(entry)) {
      throw new Error(
        `PRODUCT_IMAGE_ALLOWED_TYPES entry "${entry}" is not an image MIME type.`,
      );
    }
    if (entry === "image/svg+xml") {
      throw new Error(
        "PRODUCT_IMAGE_ALLOWED_TYPES must not include image/svg+xml; SVG uploads are rejected by policy.",
      );
    }
  }
  return new Set(entries);
}

export function parseStorageRuntimeEnv(
  input: StorageRuntimeEnvInput,
  nodeEnv: string | undefined,
): StorageRuntimeEnv {
  const parsed = storageEnvSchema.parse(input);

  return {
    provider: parsed.STORAGE_PROVIDER,
    productImagesBucket: parsed.STORAGE_BUCKET_PRODUCT_IMAGES,
    s3Endpoint: normalizeHttpUrl(parsed.STORAGE_S3_ENDPOINT, "STORAGE_S3_ENDPOINT", nodeEnv),
    s3Region: parsed.STORAGE_S3_REGION,
    s3AccessKeyId: parsed.STORAGE_S3_ACCESS_KEY_ID,
    s3SecretAccessKey: parsed.STORAGE_S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: parsed.STORAGE_S3_FORCE_PATH_STYLE === "true",
    requestTimeoutMs: parsed.STORAGE_REQUEST_TIMEOUT_MS,
    publicBaseUrl: normalizeHttpUrl(
      parsed.STORAGE_PUBLIC_BASE_URL,
      "STORAGE_PUBLIC_BASE_URL",
      nodeEnv,
    ),
    productImageMaxBytes: parsed.PRODUCT_IMAGE_MAX_BYTES,
    productImageAllowedTypes: parseAllowedTypes(parsed.PRODUCT_IMAGE_ALLOWED_TYPES),
  };
}

export type StorageConfigState =
  | { configured: true; env: StorageRuntimeEnv }
  | { configured: false; reason: string };

/**
 * Object storage is deliberately fail-closed: with no or partial
 * configuration the feature reports itself unavailable instead of guessing.
 */
export function resolveStorageConfigState(
  raw: StorageRuntimeEnvInput,
  nodeEnv: string | undefined,
): StorageConfigState {
  const present = CONFIG_KEYS.filter((key) => (raw[key] ?? "").trim() !== "");
  if (present.length === 0) {
    return {
      configured: false,
      reason:
        "Object storage is not configured. Set the STORAGE_* environment variables to enable product image uploads.",
    };
  }
  if (present.length < CONFIG_KEYS.length) {
    const missing = CONFIG_KEYS.filter((key) => !(present as readonly string[]).includes(key));
    return {
      configured: false,
      reason: `Object storage configuration is incomplete. Missing: ${missing.join(", ")}.`,
    };
  }
  try {
    return { configured: true, env: parseStorageRuntimeEnv(raw, nodeEnv) };
  } catch (error) {
    return {
      configured: false,
      reason: error instanceof Error ? error.message : "Invalid object storage configuration.",
    };
  }
}

let cachedState: StorageConfigState | undefined;

export function getStorageConfigState(): StorageConfigState {
  cachedState ??= resolveStorageConfigState(
    {
      STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
      STORAGE_BUCKET_PRODUCT_IMAGES: process.env.STORAGE_BUCKET_PRODUCT_IMAGES,
      STORAGE_S3_ENDPOINT: process.env.STORAGE_S3_ENDPOINT,
      STORAGE_S3_REGION: process.env.STORAGE_S3_REGION,
      STORAGE_S3_ACCESS_KEY_ID: process.env.STORAGE_S3_ACCESS_KEY_ID,
      STORAGE_S3_SECRET_ACCESS_KEY: process.env.STORAGE_S3_SECRET_ACCESS_KEY,
      STORAGE_PUBLIC_BASE_URL: process.env.STORAGE_PUBLIC_BASE_URL,
      STORAGE_S3_FORCE_PATH_STYLE: process.env.STORAGE_S3_FORCE_PATH_STYLE,
      STORAGE_REQUEST_TIMEOUT_MS: process.env.STORAGE_REQUEST_TIMEOUT_MS,
      PRODUCT_IMAGE_MAX_BYTES: process.env.PRODUCT_IMAGE_MAX_BYTES,
      PRODUCT_IMAGE_ALLOWED_TYPES: process.env.PRODUCT_IMAGE_ALLOWED_TYPES,
    },
    process.env.NODE_ENV,
  );
  return cachedState;
}
