export type StorageObjectMetadata = {
  key: string;
  sizeBytes: number;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
};

export type StorageListedObject = {
  key: string;
  sizeBytes: number;
  lastModified: Date | null;
};

export type StorageDeleteManyResult = {
  /** Keys confirmed removed or already absent (both count as success). */
  deleted: string[];
  /** Keys the backend refused to delete, with the reported reason. */
  failed: { key: string; message: string }[];
};

export type StorageHealth =
  | { ok: true; latencyMs: number }
  | { ok: false; latencyMs: number; message: string };

/**
 * Server-side object storage boundary. Business code must depend on this
 * interface only; no SDK types leak out. All methods throw StorageError with
 * a category + retryability classification.
 */
export type StorageProvider = {
  /** Uploads a whole object. Keys are immutable by convention — callers never re-put an existing key. */
  putObject(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
    cacheControl?: string;
  }): Promise<void>;
  getObject(key: string): Promise<Uint8Array>;
  /** Resolves null when the object does not exist. */
  headObject(key: string): Promise<StorageObjectMetadata | null>;
  objectExists(key: string): Promise<boolean>;
  /** Deleting a missing object resolves successfully (idempotent). */
  deleteObject(key: string): Promise<void>;
  /** Batch delete; missing keys count as deleted. Never throws for per-key failures. */
  deleteObjects(keys: readonly string[]): Promise<StorageDeleteManyResult>;
  listObjects(input: {
    prefix: string;
    /** Stop after this many entries (safety valve for scans). */
    maxKeys?: number;
    continuationToken?: string;
  }): Promise<{ objects: StorageListedObject[]; nextContinuationToken: string | null }>;
  publicUrl(key: string): string;
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  healthCheck(): Promise<StorageHealth>;
  readonly bucket: string;
};
