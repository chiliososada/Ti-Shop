import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { REQUIRED_APPLICATION_SCHEMA_VERSION } from "@/server/db/schema-version";

describe("application schema readiness version", () => {
  it("matches the newest migration and is persisted by that migration", async () => {
    const migrationsDirectory = resolve(process.cwd(), "prisma/migrations");
    const entries = await readdir(migrationsDirectory, { withFileTypes: true });
    const migrationNames = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const newestMigration = migrationNames.at(-1);

    expect(newestMigration).toBe(REQUIRED_APPLICATION_SCHEMA_VERSION);

    const migrationSql = await readFile(
      resolve(migrationsDirectory, REQUIRED_APPLICATION_SCHEMA_VERSION, "migration.sql"),
      "utf8",
    );
    expect(migrationSql).toContain('"app"."application_schema_metadata"');
    expect(migrationSql).toContain(`'${REQUIRED_APPLICATION_SCHEMA_VERSION}'`);
  });
});
