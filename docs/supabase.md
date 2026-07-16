# Final-phase Supabase PostgreSQL runbook

**Current status:** Supabase has not been connected, queried, or modified for this project. No project reference, URL, password, API key, or service-role secret is present. Complete local PostgreSQL 17 validation, deployment rehearsal, backup/restore testing, and business configuration first; use this runbook only when the owner explicitly starts the final database-hosting phase.

Ti-Shop will use Supabase only as managed PostgreSQL. Prisma remains the sole schema migration owner, and Better Auth remains the application login/session system. The browser does not use `supabase-js`, Supabase Auth, or the Supabase Data API.

Before execution, re-read the [Supabase changelog](https://supabase.com/changelog), [connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres), [Prisma guide](https://supabase.com/docs/guides/database/prisma), [Data API security guide](https://supabase.com/docs/guides/api/securing-your-api), and [backup guide](https://supabase.com/docs/guides/platform/backups). Supabase connection modes, platform defaults, and backup behavior change over time. As of July 2026, the platform documentation identifies PostgreSQL 17 as the platform default and uses port 5432 for both direct and Supavisor session connections; verify the selected project's actual version and dashboard-generated strings rather than copying examples from this repository.

## 1. Readiness gate

Do not create/connect the project until all boxes are true:

- [ ] Full migrations, seed, legacy import, auth, checkout, payment state, inventory, fulfillment, admin, and SEO checks pass on disposable PostgreSQL 17.
- [ ] A PostgreSQL 17 logical backup has been restored into a separate database and verified.
- [ ] The production Docker runtime/region and its IPv4/IPv6 capability are known.
- [ ] Required database connection count and Supabase compute/backup plan are approved.
- [ ] Data retention, incident access, region, privacy, and recovery objectives are approved.
- [ ] NOWPayments/manual payment/WhatsApp settings remain disabled until their own production activation reviews.
- [ ] The migration and runtime roles, credential owners, rotation procedure, and secret scopes are named.

## 2. Create a dedicated PostgreSQL 17 project

Create a dedicated Ti-Shop production project in the approved region. Do not reuse an unrelated project. Verify in the dashboard that the database is PostgreSQL 17 and that none of the application's migrations require a platform-incompatible extension (the current schema requires no optional PostgreSQL extension).

Record the project reference, region, database version, compute size, backup/PITR policy, and responsible operators in the private operations system—not this repository.

Because Ti-Shop never calls REST/GraphQL data endpoints, disable the Data API in the project's Data API integration settings. Keep the `app` schema out of every exposed-schema list. Do not grant the Supabase `anon`, `authenticated`, or `service_role` roles access to `app`. No Supabase API key is needed by the web container.

## 3. Select current connection endpoints

Use dashboard-generated connection strings and the provider's current TLS/root-certificate guidance. Preserve the provider parameters, add `schema=app`, and set exactly one `sslmode=verify-full` in both URLs. The runtime rejects query-string host overrides, repeated TLS parameters, `ssl`, and `uselibpqcompat`, because those forms can change `node-postgres` connection or certificate behavior. The `schema=app` parameter keeps Prisma migration history in one private, stable schema; do not change it between environments or releases.

- `DIRECT_URL`: prefer the direct port-5432 connection for Prisma migrations, seed/import, `pg_dump`, and recovery. It requires IPv6 unless the project has the current IPv4 option. If the trusted job runner is IPv4-only, use the current Supavisor **session** connection on port 5432.
- `DATABASE_URL`: for this persistent Docker/Node PostgreSQL pool, use direct port 5432 when reachable, otherwise Supavisor **session** mode on port 5432.
- Do not use Supavisor transaction mode on port 6543 for this long-running deployment. It is intended for temporary/serverless clients and has prepared-statement constraints that do not match the current application pool.

URL-encode special characters in passwords. Validate DNS, TLS, and connectivity from the actual Docker host before migration. Set the application-side pool below the project's measured connection budget; the repository default is 10 connections per app container, so multiply by replica count and retain headroom for migrations, Supabase services, and operators.

## 4. Create separate migration and runtime roles

Run reviewed SQL as the project's privileged `postgres` role before the first Prisma migration. Replace placeholders through the private secret workflow; never save real passwords in SQL files or shell history.

```sql
create role ti_shop_migrator
  login
  password 'REPLACE_WITH_A_GENERATED_MIGRATION_PASSWORD'
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication;

grant connect, create on database postgres to ti_shop_migrator;

create role ti_shop_app
  login
  password 'REPLACE_WITH_A_DIFFERENT_GENERATED_RUNTIME_PASSWORD'
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication;

grant connect on database postgres to ti_shop_app;
```

Use `ti_shop_migrator` for the first and every later Prisma migration so it consistently owns the `app` schema/objects. Use `ti_shop_app` only for the long-running application and runtime operations jobs.

## 5. Apply Prisma migrations, seed, and import

With `DIRECT_URL` set to the migration role's direct/session-5432 connection:

```bash
npm ci
npm run db:generate
npm run db:validate
npm run db:deploy
npm run db:seed
npm run db:import:legacy -- --strict-assets
```

Capture the migration, seed, and importer output. Prisma's `app` schema migration revokes implicit `PUBLIC` schema access. The seed preserves existing operational setting values/payment configuration and does not create an administrator.

Do not create Supabase migration files for these tables and do not use Dashboard schema edits as a second source of truth.

## 6. Grant least-privilege runtime access

After migrations, run this reviewed grant as the migration owner or privileged database operator:

```sql
grant usage on schema app to ti_shop_app;
grant select, insert, update, delete on all tables in schema app to ti_shop_app;
grant usage, select on all sequences in schema app to ti_shop_app;

-- Administrative audit rows are append-only for the runtime role.
revoke update, delete, truncate on table app.audit_logs from ti_shop_app;
grant select, insert on table app.audit_logs to ti_shop_app;

-- Future Prisma objects inherit the same runtime permissions. These statements
-- must be executed for the role that actually owns/creates migration objects.
alter default privileges for role ti_shop_migrator in schema app
  grant select, insert, update, delete on tables to ti_shop_app;
alter default privileges for role ti_shop_migrator in schema app
  grant usage, select on sequences to ti_shop_app;
```

Confirm object ownership is `ti_shop_migrator`; if a different role applied migrations, change the `alter default privileges for role ...` target accordingly. Default privileges are owner-specific and silently do nothing for objects created by another role.

The application uses server-side DAL/RBAC and Better Auth identities, not `auth.uid()`. Do not add blanket RLS policies for `authenticated`, expose `app`, or grant browser roles in an attempt to fix runtime permission errors. If a future reviewed feature deliberately exposes a Data API schema, design RLS ownership policies first and keep business tables in the private schema.

## 7. Verify privilege boundaries

From a trusted environment, test both connections before deploying:

```bash
DATABASE_URL="$RUNTIME_DATABASE_URL" npm run db:generate
DATABASE_URL="$RUNTIME_DATABASE_URL" \
  SITE_URL=https://YOUR_PRODUCTION_ORIGIN \
  BETTER_AUTH_SECRET="$PRODUCTION_AUTH_SECRET" \
  NOWPAYMENTS_MODE=disabled \
  npm run build
```

Also verify with SQL under `ti_shop_app`:

- it can select and mutate required `app` tables through representative staging flows;
- it can insert/select, but cannot update/delete/truncate, `app.audit_logs`;
- it cannot create/drop schemas or roles;
- it has no access through Supabase Data API/browser roles;
- pool connections remain within the approved project budget.

Run the complete staging flow against an isolated Supabase project or isolated restored database before production. Do not test production payment credentials during database validation.

## 8. Inject runtime secrets with strict scopes

Long-running app containers receive:

- `DATABASE_URL` for `ti_shop_app`;
- `SITE_URL` for the exact production HTTPS origin;
- `BETTER_AUTH_SECRET`;
- optional database pool values and deliberately selected NOWPayments runtime values.

Only migration/seed/import/grant/backup jobs receive `DIRECT_URL`. The application does not read `SUPABASE_URL`, an anon key, a publishable key, or a service-role key; do not invent or inject them.

Replace the generic PostgreSQL placeholders from `.env.example` through the deployment secret manager. Do not commit a Supabase-specific `.env` file.

## 9. Cutover

1. Put the current site into the approved write/payment maintenance state; online payment must be off.
2. Take the final source-database backup and record the cutover timestamp.
3. Apply migrations/seed/import to the final Supabase database as planned.
4. Verify counts and critical relational chains: users, catalog/prices, inventory/reservations/movements, orders/payments/events, shipments/tracking, audit, and outbox.
5. Deploy the app with only the limited Supabase `DATABASE_URL`.
6. Verify `/api/health`, `/api/ready`, auth ownership boundaries, public SEO URLs, admin permissions, and a non-charging checkout path.
7. Observe database connections, query performance, storage, and logs. Do not rely on connection logging being enabled; Supabase changed default `log_connections` behavior in 2026, so use the current Observability reports and explicit PostgreSQL metrics.
8. Enable WhatsApp/manual/NOWPayments controls only through their separate operational acceptance procedures.

Keep the prior database read-only and recoverable for the approved rollback window. Prevent dual writes; the application must have one authoritative `DATABASE_URL`.

## 10. Backup and recovery after cutover

Choose a Supabase plan/backup policy that meets the approved recovery point and recovery time. Current provider documentation notes that managed physical backups/PITR, downloadable logical backups, and retention differ by plan and configuration; verify the dashboard instead of assuming a fixed period.

Maintain an independent logical `pg_dump`/restore drill as described in [operations.md](operations.md). Supabase physical/daily backups do not preserve passwords for custom login roles, so after a restore reset the `ti_shop_migrator` and `ti_shop_app` passwords and rotate both secret-manager values. Supabase database backups also do not restore Storage objects; Ti-Shop currently does not use Supabase Storage, but a future storage integration would need its own object backup plan.

Managed restore causes downtime and may discard transactions after the selected recovery point. Reconcile external payments and orders around that boundary before reopening checkout.

## Final acceptance checklist

- [ ] Supabase project/version/region/plan and backup policy recorded privately.
- [ ] Current changelog and connection/Prisma/backup guidance reviewed on execution day.
- [ ] Data API disabled; `app` is not exposed; browser/service API keys absent from the app.
- [ ] Migration and runtime roles have separate rotated passwords and correct ownership/grants.
- [ ] Direct/session port-5432 choice verified from the actual Docker network.
- [ ] Both database URLs retain `schema=app`; Prisma migration history exists in that one location and is the only schema history.
- [ ] Strict legacy import report and row/relationship checks approved.
- [ ] Runtime role cannot mutate/delete audit rows or perform schema administration.
- [ ] Backup was restored and custom-role password recovery was rehearsed.
- [ ] App health/readiness, auth isolation, admin permissions, SEO, order/inventory, and non-charging checkout checks pass.
- [ ] Supabase secrets exist only in approved runtime/job scopes.
- [ ] Production payment and communication integrations remain separately gated.
