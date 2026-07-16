import "server-only";

import { getStorageConfigState } from "@/server/storage/config";
import { StorageError } from "@/server/storage/errors";
import { createS3StorageProvider } from "@/server/storage/s3-provider";
import type { StorageProvider } from "@/server/storage/types";

let cachedProvider: StorageProvider | undefined;

/**
 * Returns the process-wide product image storage provider, or throws a
 * classified StorageError when object storage is not configured. Callers that
 * need a soft signal should check getStorageConfigState() first.
 */
export function getProductImageStorage(): StorageProvider {
  if (cachedProvider) {
    return cachedProvider;
  }
  const state = getStorageConfigState();
  if (!state.configured) {
    throw new StorageError({
      operation: "configure",
      category: "service_unavailable",
      message: state.reason,
    });
  }
  cachedProvider = createS3StorageProvider(state.env);
  return cachedProvider;
}
