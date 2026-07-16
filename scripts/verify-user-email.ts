import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { validatePostgresConnectionUrl } from "../src/lib/postgres-connection-url";
import {
  AdminIdentityCliUsageError,
  parseVerifyUserEmailArgs,
} from "./lib/admin-identity-cli";
import { verifyUserEmailOutOfBand } from "./lib/admin-identity-operations";

const usage =
  "Usage: npm run admin:verify-email -- --user-id=<uuid> --email=<registered-email> --confirm-out-of-band";
const rawDirectUrl = process.env.DIRECT_URL;

function readIdentity() {
  try {
    return parseVerifyUserEmailArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      error instanceof AdminIdentityCliUsageError ? error.message : usage,
    );
    console.error(usage);
    process.exit(1);
  }
}
const identity = readIdentity();

if (!rawDirectUrl) {
  console.error("DIRECT_URL is required to verify an account email.");
  process.exit(1);
}
const directUrl = validatePostgresConnectionUrl(rawDirectUrl, {
  label: "DIRECT_URL",
  requiredSchema: "app",
});

const pool = new Pool({
  connectionString: directUrl,
  max: 1,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 5_000,
  maxLifetimeSeconds: 300,
});
const adapter = new PrismaPg(pool, {
  schema: "app",
  disposeExternalPool: true,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const result = await verifyUserEmailOutOfBand(prisma, identity);
  console.info(
    result.duplicate
      ? `Email verification was already active for ${result.email}; the out-of-band confirmation was audited.`
      : `Email ownership was marked verified for ${result.email} after out-of-band confirmation.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Email verification failed.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
