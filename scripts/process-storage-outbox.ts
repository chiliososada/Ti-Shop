import "dotenv/config";

import { disconnectDb } from "../src/server/db/client";
import { processStorageOutboxBatch } from "../src/server/storage/outbox-worker";

function parseArgs(args: readonly string[]) {
  let limit = 25;
  for (const arg of args) {
    if (arg.startsWith("--limit=")) {
      limit = Number(arg.slice("--limit=".length));
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("--limit must be an integer from 1 to 100.");
      }
    } else {
      throw new Error("Usage: npm run storage:process-outbox -- [--limit=1..100]");
    }
  }
  return { limit };
}

async function main() {
  const { limit } = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const report = await processStorageOutboxBatch({ limit, now: startedAt });
  console.log(
    JSON.stringify({
      status: "ok",
      startedAt: startedAt.toISOString(),
      ...report,
      hasMore: report.claimed === limit,
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        status: "failed",
        message: error instanceof Error ? error.message : "Unknown failure.",
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });
