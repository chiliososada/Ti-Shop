import "dotenv/config";

import { disconnectDb } from "../src/server/db/client";
import { cleanupDatabaseRateLimits } from "../src/server/security/rate-limit";

function integerArgument(name: string, fallback: number) {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  if (!raw) return fallback;
  const value = Number(raw.slice(prefix.length));
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be an integer.`);
  }
  return value;
}

async function main() {
  const olderThanHours = integerArgument("older-than-hours", 24);
  const limit = integerArgument("limit", 5_000);
  const report = await cleanupDatabaseRateLimits({
    olderThanMs: olderThanHours * 60 * 60_000,
    limit,
  });
  process.stdout.write(
    `${JSON.stringify({ status: "ok", olderThanHours, limit, ...report })}\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        status: "failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
      })}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });
