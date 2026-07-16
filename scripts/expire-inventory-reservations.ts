import "dotenv/config";

import { disconnectDb } from "../src/server/db/client";
import { expireInventoryReservationsBatch } from "../src/server/orders/inventory";

function parseLimit(args: readonly string[]) {
  if (args.length === 0) return 100;
  if (args.length !== 1 || !args[0]?.startsWith("--limit=")) {
    throw new Error("Usage: npm run inventory:expire-reservations -- --limit=1..100");
  }
  const limit = Number(args[0].slice("--limit=".length));
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Reservation expiration limit must be an integer from 1 to 100.");
  }
  return limit;
}

async function main() {
  const limit = parseLimit(process.argv.slice(2));
  const startedAt = new Date();
  const result = await expireInventoryReservationsBatch({
    limit,
    now: startedAt,
  });
  console.log(
    JSON.stringify({
      status: "ok",
      startedAt: startedAt.toISOString(),
      limit,
      ...result,
      hasMore: result.reservations === limit,
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        status: "failed",
        code:
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "EXPIRATION_FAILED",
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });

