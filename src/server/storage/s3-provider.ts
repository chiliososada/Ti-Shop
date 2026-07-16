import "server-only";

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { StorageRuntimeEnv } from "@/server/storage/config";
import { classifyS3Error, StorageError } from "@/server/storage/errors";
import type {
  StorageDeleteManyResult,
  StorageHealth,
  StorageListedObject,
  StorageObjectMetadata,
  StorageProvider,
} from "@/server/storage/types";

const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

function assertKey(key: string): void {
  if (
    key.length === 0 ||
    key.length > 900 ||
    key.startsWith("/") ||
    key.includes("..") ||
    key.includes("//") ||
    /[\s\u0000-\u001f\u007f]/u.test(key)
  ) {
    throw new StorageError({
      operation: "validate-key",
      category: "invalid_request",
      message: "object key failed validation",
    });
  }
}

async function bodyToUint8Array(body: unknown): Promise<Uint8Array> {
  const candidate = body as
    | { transformToByteArray?: () => Promise<Uint8Array> }
    | null
    | undefined;
  if (candidate?.transformToByteArray) {
    return candidate.transformToByteArray();
  }
  throw new StorageError({
    operation: "get",
    category: "unknown",
    message: "unsupported response body stream",
  });
}

export function createS3StorageProvider(env: StorageRuntimeEnv): StorageProvider {
  const client = new S3Client({
    endpoint: env.s3Endpoint,
    region: env.s3Region,
    forcePathStyle: env.s3ForcePathStyle,
    credentials: {
      accessKeyId: env.s3AccessKeyId,
      secretAccessKey: env.s3SecretAccessKey,
    },
    requestHandler: { requestTimeout: env.requestTimeoutMs },
  });
  const bucket = env.productImagesBucket;
  const publicBase = env.publicBaseUrl;

  return {
    bucket,

    async putObject(input) {
      assertKey(input.key);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: input.key,
            Body: input.body,
            ContentType: input.contentType,
            CacheControl: input.cacheControl ?? IMMUTABLE_CACHE_CONTROL,
          }),
        );
      } catch (error) {
        throw classifyS3Error("put", error);
      }
    },

    async getObject(key) {
      assertKey(key);
      try {
        const response = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        return await bodyToUint8Array(response.Body);
      } catch (error) {
        throw classifyS3Error("get", error);
      }
    },

    async headObject(key) {
      assertKey(key);
      try {
        const response = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
        return {
          key,
          sizeBytes: Number(response.ContentLength ?? 0),
          contentType: response.ContentType ?? null,
          etag: response.ETag ?? null,
          lastModified: response.LastModified ?? null,
        } satisfies StorageObjectMetadata;
      } catch (error) {
        const classified = classifyS3Error("head", error);
        if (classified.category === "not_found") {
          return null;
        }
        throw classified;
      }
    },

    async objectExists(key) {
      return (await this.headObject(key)) !== null;
    },

    async deleteObject(key) {
      assertKey(key);
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        const classified = classifyS3Error("delete", error);
        if (classified.category === "not_found") {
          return; // Idempotent: already gone is success.
        }
        throw classified;
      }
    },

    async deleteObjects(keys) {
      const unique = [...new Set(keys)];
      unique.forEach(assertKey);
      const result: StorageDeleteManyResult = { deleted: [], failed: [] };
      // S3 DeleteObjects accepts at most 1000 keys per request.
      for (let start = 0; start < unique.length; start += 1000) {
        const batch = unique.slice(start, start + 1000);
        try {
          const response = await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: batch.map((key) => ({ Key: key })), Quiet: false },
            }),
          );
          const errored = new Map(
            (response.Errors ?? [])
              .filter((entry) => entry.Key)
              .map((entry) => [
                entry.Key as string,
                entry.Message ?? entry.Code ?? "delete failed",
              ]),
          );
          for (const key of batch) {
            const failure = errored.get(key);
            if (failure && !/NoSuchKey/iu.test(failure)) {
              result.failed.push({ key, message: failure.slice(0, 300) });
            } else {
              result.deleted.push(key);
            }
          }
        } catch (error) {
          const classified = classifyS3Error("delete-many", error);
          for (const key of batch) {
            result.failed.push({ key, message: classified.message });
          }
        }
      }
      return result;
    },

    async listObjects(input) {
      try {
        const response = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: input.prefix,
            MaxKeys: Math.min(Math.max(input.maxKeys ?? 1000, 1), 1000),
            ContinuationToken: input.continuationToken,
          }),
        );
        const objects: StorageListedObject[] = (response.Contents ?? [])
          .filter((entry) => typeof entry.Key === "string")
          .map((entry) => ({
            key: entry.Key as string,
            sizeBytes: Number(entry.Size ?? 0),
            lastModified: entry.LastModified ?? null,
          }));
        return {
          objects,
          nextContinuationToken: response.IsTruncated
            ? (response.NextContinuationToken ?? null)
            : null,
        };
      } catch (error) {
        throw classifyS3Error("list", error);
      }
    },

    publicUrl(key) {
      assertKey(key);
      return `${publicBase}/${key}`;
    },

    async signedUrl(key, expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS) {
      assertKey(key);
      try {
        return await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: bucket, Key: key }),
          { expiresIn: Math.min(Math.max(expiresInSeconds, 30), 604_800) },
        );
      } catch (error) {
        throw classifyS3Error("sign", error);
      }
    },

    async healthCheck() {
      const startedAt = performance.now();
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
      } catch (error) {
        const classified = classifyS3Error("health", error);
        return {
          ok: false,
          latencyMs: Math.round(performance.now() - startedAt),
          message: `${classified.category}: ${classified.message}`,
        } satisfies StorageHealth;
      }
    },
  };
}
