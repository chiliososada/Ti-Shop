import "dotenv/config";

import { defineConfig } from "prisma/config";

import { validatePostgresConnectionUrl } from "./src/lib/postgres-connection-url";

const rawDirectUrl = process.env.DIRECT_URL;
const directUrl = rawDirectUrl
  ? validatePostgresConnectionUrl(rawDirectUrl, {
      label: "DIRECT_URL",
      requiredSchema: "app",
    })
  : undefined;

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Generating the client does not require a database connection. Keeping this
  // optional lets Docker builds generate the client without baking in secrets;
  // migration and seed commands still require DIRECT_URL at execution time.
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
});
