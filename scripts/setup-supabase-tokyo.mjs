/**
 * One-shot production database bootstrap for the Tokyo Supabase project.
 *
 * Run it yourself (writes to your production DB, so the authority stays with
 * you):
 *
 *   export PATH=/opt/homebrew/opt/node@24/bin:$PATH
 *   SUPABASE_SUPERUSER_URL='postgresql://postgres:YOUR_DB_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres' \
 *     node scripts/setup-supabase-tokyo.mjs
 *
 * It is safe to re-run: roles are created only if missing, and Prisma migrate
 * deploy / grants are idempotent. It never prints the passwords; the generated
 * role passwords are written only to .env.supabase.tokyo (gitignored, chmod 600).
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync, chmodSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pg = require("pg");

const superUrl = process.env.SUPABASE_SUPERUSER_URL;
if (!superUrl) {
  console.error(
    "Set SUPABASE_SUPERUSER_URL to the postgres superuser connection string first.",
  );
  process.exit(1);
}

const ref = new URL(superUrl).hostname.split(".")[1]; // db.<ref>.supabase.co
if (!ref) {
  console.error("Could not derive the project ref from the host.");
  process.exit(1);
}

// prisma.config.ts enforces sslmode=verify-full for a non-private host, which
// needs the Supabase root CA. All projects share the same prod-ca-2021 cert.
const caPath = resolve("deploy/supabase-prod-ca-2021.crt");
if (!existsSync(caPath)) {
  console.error(`Supabase CA cert not found at ${caPath}`);
  process.exit(1);
}
const sslSuffix = `sslmode=verify-full&sslrootcert=${caPath}`;

const migPw = randomBytes(24).toString("hex");
const appPw = randomBytes(24).toString("hex");
const host = `db.${ref}.supabase.co`;
// Plain URLs drive the direct node-postgres steps (roles/grants/verify) with an
// explicit ssl object; the full verify-full URLs go to Prisma and .env.
const migratorPlain = `postgresql://ti_shop_migrator:${migPw}@${host}:5432/postgres?schema=app`;
const appPlain = `postgresql://ti_shop_app:${appPw}@${host}:5432/postgres?schema=app`;
const migratorUrl = `${migratorPlain}&${sslSuffix}`;
const appUrl = `${appPlain}&${sslSuffix}`;

async function runSql(url, label, sql) {
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await client.connect();
  try {
    await client.query(sql);
    console.log(`  ✓ ${label}`);
  } finally {
    await client.end();
  }
}

function npm(step, connUrl) {
  console.log(`\n▶ ${step}`);
  // Set both: prisma migrate/seed read DIRECT_URL (via prisma.config.ts), while
  // the tsx legacy-import script builds its own PrismaClient off DATABASE_URL.
  execSync(`npm run ${step}`, {
    stdio: "inherit",
    env: { ...process.env, DIRECT_URL: connUrl, DATABASE_URL: connUrl },
  });
}

async function main() {
  console.log(`Bootstrapping Tokyo project ${ref} …\n`);

  console.log("1) Create least-privilege roles (idempotent)");
  await runSql(
    superUrl,
    "roles",
    `
    do $$ begin
      if not exists (select from pg_roles where rolname = 'ti_shop_migrator') then
        create role ti_shop_migrator login password '${migPw}'
          nosuperuser nocreatedb nocreaterole noreplication;
      else
        alter role ti_shop_migrator login password '${migPw}';
      end if;
      grant connect, create on database postgres to ti_shop_migrator;

      if not exists (select from pg_roles where rolname = 'ti_shop_app') then
        create role ti_shop_app login password '${appPw}'
          nosuperuser nocreatedb nocreaterole noreplication;
      else
        alter role ti_shop_app login password '${appPw}';
      end if;
      grant connect on database postgres to ti_shop_app;
    end $$;
  `,
  );

  console.log("\n2) Apply migrations + seed + legacy import (as migrator)");
  npm("db:deploy", migratorUrl);
  npm("db:seed", migratorUrl);
  // primary-only: every product's primary image ships in the repo, but the
  // supplementary gallery webp files do not — those are uploaded to Supabase
  // Storage from the admin after launch. strict-assets would abort on them.
  npm("db:import:legacy -- --asset-mode=primary-only", migratorUrl);

  console.log("\n3) Grant least-privilege runtime access to ti_shop_app");
  // Run as the migrator, not the superuser: on Supabase the `postgres` user is
  // not a true superuser and cannot ALTER DEFAULT PRIVILEGES FOR another role.
  // ti_shop_migrator owns the app schema/objects, so it grants on its own
  // tables and alters its own default privileges cleanly.
  await runSql(
    migratorPlain,
    "runtime grants",
    `
    grant usage on schema app to ti_shop_app;
    grant select, insert, update, delete on all tables in schema app to ti_shop_app;
    grant usage, select on all sequences in schema app to ti_shop_app;
    -- audit rows are append-only for the runtime role
    revoke update, delete, truncate on table app.audit_logs from ti_shop_app;
    grant select, insert on table app.audit_logs to ti_shop_app;
    -- future Prisma objects inherit the same runtime grants
    alter default privileges for role ti_shop_migrator in schema app
      grant select, insert, update, delete on tables to ti_shop_app;
    alter default privileges for role ti_shop_migrator in schema app
      grant usage, select on sequences to ti_shop_app;
  `,
  );

  console.log("\n4) Write .env.supabase.tokyo (gitignored)");
  writeFileSync(
    ".env.supabase.tokyo",
    [
      "# Tokyo production database — generated by setup-supabase-tokyo.mjs.",
      "# gitignored. Do not commit.",
      `SUPABASE_PROJECT_REF=${ref}`,
      `SUPABASE_DIRECT_URL=${migratorUrl}`,
      `SUPABASE_APP_DATABASE_URL=${appUrl}`,
      "",
    ].join("\n"),
  );
  chmodSync(".env.supabase.tokyo", 0o600);
  console.log("  ✓ role passwords saved (never printed)");

  console.log("\n5) Verify");
  const check = new pg.Client({
    connectionString: appPlain,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await check.connect();
  const tables = await check.query(
    "select count(*)::int n from information_schema.tables where table_schema='app'",
  );
  const products = await check.query('select count(*)::int n from app.products');
  const perms = await check.query(
    "select count(*)::int n from app.permissions",
  );
  await check.end();
  console.log(
    `  app tables: ${tables.rows[0].n} · products: ${products.rows[0].n} · permissions: ${perms.rows[0].n}`,
  );
  console.log(
    "\n✅ Tokyo database ready. Connection strings are in .env.supabase.tokyo.",
  );
  console.log(
    "   Next: reset the postgres superuser password in the dashboard (the one you pasted was weak/exposed),",
  );
  console.log(
    "   then set up the Storage product-images bucket + S3 keys.",
  );
}

main().catch((error) => {
  console.error("\n❌ Setup failed:", error.message);
  process.exit(1);
});
