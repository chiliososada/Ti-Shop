import { describe, expect, it } from "vitest";

import {
  classifyS3Error,
  isRetryableStorageError,
  isStorageNotFound,
  StorageError,
} from "@/server/storage/errors";

function s3Error(input: { name?: string; code?: string; status?: number; message?: string }) {
  return Object.assign(new Error(input.message ?? input.name ?? "boom"), {
    name: input.name ?? "Error",
    code: input.code,
    $metadata: input.status === undefined ? undefined : { httpStatusCode: input.status },
  });
}

describe("classifyS3Error", () => {
  it("classifies not-found shapes", () => {
    for (const error of [
      s3Error({ name: "NoSuchKey" }),
      s3Error({ name: "NotFound", status: 404 }),
      s3Error({ name: "NoSuchBucket" }),
      s3Error({ status: 404 }),
    ]) {
      const classified = classifyS3Error("head", error);
      expect(classified.category).toBe("not_found");
      expect(classified.isRetryable).toBe(false);
      expect(isStorageNotFound(classified)).toBe(true);
    }
  });

  it("classifies credential and permission failures as non-retryable", () => {
    for (const error of [
      s3Error({ name: "AccessDenied", status: 403 }),
      s3Error({ name: "InvalidAccessKeyId" }),
      s3Error({ name: "SignatureDoesNotMatch" }),
      s3Error({ status: 401 }),
    ]) {
      const classified = classifyS3Error("put", error);
      expect(classified.category).toBe("access_denied");
      expect(classified.isRetryable).toBe(false);
    }
  });

  it("classifies throttling, timeouts, network and 5xx as retryable", () => {
    expect(classifyS3Error("put", s3Error({ name: "SlowDown", status: 503 })).category).toBe("rate_limited");
    expect(classifyS3Error("put", s3Error({ status: 429 })).category).toBe("rate_limited");
    expect(classifyS3Error("put", s3Error({ name: "TimeoutError" })).category).toBe("timeout");
    expect(classifyS3Error("put", s3Error({ code: "ETIMEDOUT" })).category).toBe("timeout");
    expect(classifyS3Error("put", s3Error({ code: "ECONNREFUSED" })).category).toBe("network");
    expect(classifyS3Error("put", s3Error({ status: 500 })).category).toBe("service_unavailable");
    for (const error of [
      s3Error({ name: "SlowDown", status: 503 }),
      s3Error({ name: "TimeoutError" }),
      s3Error({ code: "ECONNRESET" }),
      s3Error({ status: 502 }),
    ]) {
      expect(isRetryableStorageError(classifyS3Error("put", error))).toBe(true);
    }
  });

  it("classifies other 4xx as invalid_request and unknown otherwise", () => {
    expect(classifyS3Error("put", s3Error({ status: 400 })).category).toBe("invalid_request");
    expect(classifyS3Error("put", new Error("weird")).category).toBe("unknown");
    expect(classifyS3Error("put", null).category).toBe("unknown");
  });

  it("passes through existing StorageErrors and records operation/status", () => {
    const original = new StorageError({
      operation: "delete",
      category: "timeout",
      message: "slow",
    });
    expect(classifyS3Error("put", original)).toBe(original);

    const classified = classifyS3Error("list", s3Error({ name: "SlowDown", status: 503 }));
    expect(classified.operation).toBe("list");
    expect(classified.statusCode).toBe(503);
    expect(classified.name).toBe("StorageError");
  });

  it("does not leak long provider payloads into messages", () => {
    const classified = classifyS3Error("put", s3Error({ message: "x".repeat(2000) }));
    expect(classified.message.length).toBeLessThan(600);
  });
});
