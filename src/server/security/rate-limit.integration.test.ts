import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getDb } from "@/server/db/client";
import {
  cleanupDatabaseRateLimits,
  consumeDatabaseRateLimit,
} from "@/server/security/rate-limit";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("database rate-limit retention", () => {
  const suffix = randomUUID();
  const staleKey = `integration:rate-limit:stale:${suffix}`;
  const freshKey = `integration:rate-limit:fresh:${suffix}`;

  afterAll(async () => {
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    await getDb().rateLimit.deleteMany({
      where: { key: { in: [staleKey, freshKey] } },
    });
  });

  it("deletes expired buckets while retaining recent abuse state", async () => {
    process.env.DATABASE_URL = databaseUrl;
    const now = Date.now();
    await consumeDatabaseRateLimit({
      key: staleKey,
      limit: 10,
      windowMs: 10 * 60_000,
      now: now - 2 * 60 * 60_000,
    });
    await consumeDatabaseRateLimit({
      key: freshKey,
      limit: 10,
      windowMs: 10 * 60_000,
      now,
    });

    const report = await cleanupDatabaseRateLimits({
      olderThanMs: 60 * 60_000,
      limit: 10_000,
      now,
    });
    const remaining = await getDb().rateLimit.findMany({
      where: { key: { in: [staleKey, freshKey] } },
      select: { key: true },
    });

    expect(report.deleted).toBeGreaterThanOrEqual(1);
    expect(remaining).toEqual([{ key: freshKey }]);
  });
});
