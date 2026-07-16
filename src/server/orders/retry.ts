const RETRYABLE_CODES = new Set(["P2002", "P2034", "40001", "40P01"]);

function objectCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  if (typeof record.code === "string") return record.code.toUpperCase();
  return null;
}

export function isRetryableTransactionError(error: unknown) {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0 && seen.size < 20) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    const directCode = objectCode(current);
    if (directCode && RETRYABLE_CODES.has(directCode)) return true;

    const record = current as Record<string, unknown>;
    if (
      typeof record.message === "string" &&
      /(?:code|sqlstate)[^a-z0-9]*(?:`|')?(?:40001|40p01)(?:`|')?/iu.test(
        record.message,
      )
    ) {
      return true;
    }
    for (const key of [
      "cause",
      "meta",
      "driverAdapterError",
      "database_error",
      "originalError",
    ]) {
      if (record[key] !== undefined) queue.push(record[key]);
    }
  }

  return false;
}

export async function withSerializableRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: {
    attempts?: number;
    wait?: (attempt: number) => Promise<void>;
  } = {},
) {
  const attempts = options.attempts ?? 3;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) {
    throw new RangeError("Serializable transaction attempts must be 1–5.");
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt === attempts || !isRetryableTransactionError(error)) {
        throw error;
      }
      if (options.wait) {
        await options.wait(attempt);
      } else {
        // Yield long enough for the conflicting transaction to commit before
        // opening a fresh SERIALIZABLE snapshot. Immediate retries can exhaust
        // every attempt while the same row lock is still held.
        await new Promise<void>((resolve) => {
          setTimeout(resolve, Math.min(15 * 2 ** (attempt - 1), 60));
        });
      }
    }
  }

  throw new Error("Serializable transaction retry loop exited unexpectedly.");
}
