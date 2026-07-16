import "dotenv/config";

import { disconnectDb } from "../src/server/db/client";
import { reconcileNowPaymentsPayments } from "../src/server/payments/nowpayments/reconcile";

function integerArgument(name: string, fallback: number) {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  if (!raw) return fallback;
  const value = Number(raw.slice(prefix.length));
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer.`);
  }
  return value;
}

async function main() {
  const report = await reconcileNowPaymentsPayments({
    batchSize: integerArgument("batch-size", 50),
    olderThanMinutes: integerArgument("older-than-minutes", 5),
    unlinkedInvoiceOlderThanMinutes: integerArgument(
      "unlinked-invoice-minutes",
      60,
    ),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failed > 0 || report.unresolvedInvoices > 0) {
    process.exitCode = 1;
  }
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
