import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { validatePostgresConnectionUrl } from "../src/lib/postgres-connection-url";
import {
  AdminIdentityCliUsageError,
  parseGrantAdminArgs,
} from "./lib/admin-identity-cli";
import { grantOwnerAccess } from "./lib/admin-identity-operations";

const usage =
  "Usage: npm run admin:grant -- --user-id=<uuid> --email=<registered-email> --confirm-owner-grant";
const rawDirectUrl = process.env.DIRECT_URL;

function readIdentity() {
  try {
    return parseGrantAdminArgs(process.argv.slice(2));
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
  console.error("DIRECT_URL is required to grant administration access.");
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
  const result = await grantOwnerAccess(prisma, identity);
  console.info(
    result.duplicate
      ? `Owner access was already active for ${result.email}; the exact identity match was audited.`
      : `Owner access is active for ${result.email}.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Admin grant failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
