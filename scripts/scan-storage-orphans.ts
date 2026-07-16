import "dotenv/config";

import { disconnectDb } from "../src/server/db/client";
import {
  deleteProductImageOrphans,
  scanProductImageOrphans,
} from "../src/server/storage/orphan-scan";

type ParsedArgs = {
  graceMinutes: number;
  deleteOrphans: boolean;
  confirmed: boolean;
  actorUserId: string | null;
};

function parseArgs(args: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    graceMinutes: 60,
    deleteOrphans: false,
    confirmed: false,
    actorUserId: null,
  };
  for (const arg of args) {
    if (arg.startsWith("--grace-minutes=")) {
      parsed.graceMinutes = Number(arg.slice("--grace-minutes=".length));
      if (!Number.isSafeInteger(parsed.graceMinutes) || parsed.graceMinutes < 0) {
        throw new Error("--grace-minutes must be a non-negative integer.");
      }
    } else if (arg === "--delete") {
      parsed.deleteOrphans = true;
    } else if (arg === "--confirm-delete-orphans") {
      parsed.confirmed = true;
    } else if (arg.startsWith("--actor-user-id=")) {
      parsed.actorUserId = arg.slice("--actor-user-id=".length);
    } else {
      throw new Error(
        "Usage: npm run storage:scan-orphans -- [--grace-minutes=N] [--delete --confirm-delete-orphans --actor-user-id=<admin-uuid>]",
      );
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await scanProductImageOrphans({ graceMinutes: args.graceMinutes });

  if (!args.deleteOrphans) {
    // Default mode: report only. Nothing is deleted.
    console.log(JSON.stringify({ status: "ok", mode: "report-only", ...report }));
    return;
  }

  if (!args.confirmed || !args.actorUserId) {
    throw new Error(
      "Deleting orphans requires both --confirm-delete-orphans and --actor-user-id=<admin-uuid>.",
    );
  }
  const deletion = await deleteProductImageOrphans({
    keys: report.orphans.map((orphan) => orphan.key),
    actorUserId: args.actorUserId,
  });
  console.log(
    JSON.stringify({ status: "ok", mode: "delete", scan: report, deletion }),
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
