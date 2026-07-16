export type StorageErrorCategory =
  | "not_found"
  | "already_exists"
  | "access_denied"
  | "invalid_request"
  | "rate_limited"
  | "timeout"
  | "network"
  | "service_unavailable"
  | "unknown";

const RETRYABLE_CATEGORIES: ReadonlySet<StorageErrorCategory> = new Set([
  "rate_limited",
  "timeout",
  "network",
  "service_unavailable",
]);

export class StorageError extends Error {
  readonly category: StorageErrorCategory;
  readonly operation: string;
  readonly statusCode: number | null;

  constructor(input: {
    operation: string;
    category: StorageErrorCategory;
    message: string;
    statusCode?: number | null;
    cause?: unknown;
  }) {
    super(`storage ${input.operation}: ${input.message}`, {
      cause: input.cause,
    });
    this.name = "StorageError";
    this.operation = input.operation;
    this.category = input.category;
    this.statusCode = input.statusCode ?? null;
  }

  get isRetryable(): boolean {
    return RETRYABLE_CATEGORIES.has(this.category);
  }
}

export function isStorageNotFound(error: unknown): boolean {
  return error instanceof StorageError && error.category === "not_found";
}

export function isRetryableStorageError(error: unknown): boolean {
  return error instanceof StorageError && error.isRetryable;
}

/**
 * Maps an AWS-SDK-shaped failure to a StorageError. Only shape is inspected —
 * no SDK import — so the classifier is trivially unit-testable and reusable
 * for any S3-compatible backend.
 */
export function classifyS3Error(operation: string, error: unknown): StorageError {
  if (error instanceof StorageError) {
    return error;
  }

  const shaped = error as {
    name?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
    code?: string;
  } | null;

  const name = shaped?.name ?? shaped?.code ?? "";
  const statusCode = shaped?.$metadata?.httpStatusCode ?? null;
  const message =
    (shaped?.message || name || "unknown storage failure").slice(0, 500);

  const category = ((): StorageErrorCategory => {
    if (name === "NoSuchKey" || name === "NotFound" || name === "NoSuchBucket" || statusCode === 404) {
      return "not_found";
    }
    if (name === "AccessDenied" || name === "InvalidAccessKeyId" || name === "SignatureDoesNotMatch" || statusCode === 401 || statusCode === 403) {
      return "access_denied";
    }
    if (name === "SlowDown" || name === "TooManyRequests" || statusCode === 429) {
      return "rate_limited";
    }
    if (name === "TimeoutError" || name === "RequestTimeout" || name === "AbortError" || shaped?.code === "ETIMEDOUT") {
      return "timeout";
    }
    if (
      shaped?.code === "ECONNREFUSED" ||
      shaped?.code === "ECONNRESET" ||
      shaped?.code === "ENOTFOUND" ||
      shaped?.code === "EPIPE" ||
      name === "NetworkingError"
    ) {
      return "network";
    }
    if (statusCode !== null && statusCode >= 500) {
      return "service_unavailable";
    }
    if (statusCode !== null && statusCode >= 400) {
      return "invalid_request";
    }
    return "unknown";
  })();

  return new StorageError({ operation, category, message, statusCode, cause: error });
}
