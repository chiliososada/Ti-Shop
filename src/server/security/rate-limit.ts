import "server-only";

import { randomUUID } from "node:crypto";

import { getDb } from "@/server/db/client";

type RateLimitRow = { count: number; lastRequest: bigint };

export async function consumeDatabaseRateLimit({
  key,
  limit,
  windowMs,
  now = Date.now(),
}: {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}) {
  if (!key || key.length > 512) throw new Error("Invalid rate-limit key.");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error("Invalid rate-limit limit.");
  }
  if (
    !Number.isSafeInteger(windowMs) ||
    windowMs < 1_000 ||
    windowMs > 86_400_000
  ) {
    throw new Error("Invalid rate-limit window.");
  }

  const nowMs = BigInt(Math.floor(now));
  const cutoffMs = nowMs - BigInt(windowMs);
  const rows = await getDb().$queryRaw<RateLimitRow[]>`
    INSERT INTO "app"."rate_limits" (
      "id",
      "key",
      "count",
      "last_request"
    ) VALUES (
      ${randomUUID()}::uuid,
      ${key},
      1,
      ${nowMs}
    )
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "app"."rate_limits"."last_request" < ${cutoffMs} THEN 1
        ELSE "app"."rate_limits"."count" + 1
      END,
      "last_request" = ${nowMs}
    RETURNING
      "count",
      "last_request" AS "lastRequest"
  `;
  const row = rows[0];
  if (!row) throw new Error("Rate-limit update returned no row.");

  return {
    allowed: row.count <= limit,
    remaining: Math.max(0, limit - row.count),
    retryAfterSeconds: row.count <= limit ? 0 : Math.ceil(windowMs / 1_000),
  };
}

export async function cleanupDatabaseRateLimits({
  olderThanMs = 24 * 60 * 60_000,
  limit = 5_000,
  now = Date.now(),
}: {
  olderThanMs?: number;
  limit?: number;
  now?: number;
} = {}) {
  if (
    !Number.isSafeInteger(olderThanMs) ||
    olderThanMs < 60_000 ||
    olderThanMs > 365 * 24 * 60 * 60_000
  ) {
    throw new Error("Invalid rate-limit cleanup age.");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error("Invalid rate-limit cleanup limit.");
  }

  const cutoffMs = BigInt(Math.floor(now)) - BigInt(olderThanMs);
  const deleted = await getDb().$queryRaw<Array<{ id: string }>>`
    DELETE FROM "app"."rate_limits"
    WHERE "id" IN (
      SELECT "id"
      FROM "app"."rate_limits"
      WHERE "last_request" < ${cutoffMs}
      ORDER BY "last_request" ASC, "id" ASC
      LIMIT ${limit}
    )
    RETURNING "id"
  `;

  return {
    deleted: deleted.length,
    hasMore: deleted.length === limit,
    cutoffMs: cutoffMs.toString(),
  };
}
