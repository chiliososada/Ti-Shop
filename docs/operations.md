# Ti-Shop operations runbook

This runbook covers the current Docker/Next.js/PostgreSQL deployment. It assumes an external PostgreSQL 17 database, immutable application images, and access to the deployment secret manager. It does not assume Supabase; that connection is a separate final phase described in [supabase.md](supabase.md).

## Operator prerequisites

An operator needs:

- permission to deploy the matching app, migrator, and operations images;
- the limited `DATABASE_URL` for the app/operations jobs;
- the privileged `DIRECT_URL` only for migration, seed, import, grant, backup, and reviewed recovery work;
- access to PostgreSQL 17 client tools for backup/restore;
- access to `/admin` with the minimum required RBAC permission;
- access to the NOWPayments/provider dashboard only if that integration has actually been provisioned;
- a private incident log that does not expose secrets or unnecessary customer/payment payloads.

There is no automatic email, carrier, WhatsApp conversation, bank, Zelle, or outbox-delivery integration in this repository. Do not infer successful delivery or settlement from a stored local row alone.

## Release procedure

### 1. Prepare and validate

From the exact release source on Node 24.18:

```bash
npm ci
npm run db:generate
npm run db:validate
npm run lint
npm run typecheck
npm run test
SITE_URL=https://YOUR_PRODUCTION_ORIGIN npm run build
SITE_URL=https://YOUR_PRODUCTION_ORIGIN npm run test:seo
```

Run `test:seo` against a migrated, seeded, legacy-imported disposable/staging database. It starts the standalone build, validates public sitemap/metadata URLs, checks protected/404 boundaries, and verifies that an unauthenticated checkout request fails closed. Do not point an automated destructive test suite at production.

Before approval:

- review every new Prisma migration and apply it to a fresh PostgreSQL 17 database and a recent restored staging backup;
- verify that the legacy importer is not being run unintentionally;
- record the current app image identifier and database backup identifier;
- confirm app, migrator, and operations images come from the same source revision;
- confirm `SITE_URL`, database roles, TLS, the exact application-schema readiness sentinel, scheduler, and secret scopes;
- keep online-payment controls off during payment configuration or provider changes;
- define the deployer, observer, rollback decision-maker, and observation window.

### 2. Back up

Create and verify a backup before any production migration. See [Backup and restore](#backup-and-restore). A backup is not considered verified until it has been restored into a separate database and inspected.

### 3. Build or pull one release

```bash
docker compose build --pull app migrate operations
docker compose pull proxy
```

In a registry deployment, set the three `TI_SHOP_*_IMAGE` values to matching immutable versions and pull them instead of rebuilding on the production host.

### 4. Apply database changes separately

```bash
docker compose run --rm migrate
docker compose run --rm migrate npm run db:seed
```

Any non-zero migration or seed exit stops the release. Do not start a new app image and hope a failed schema change is harmless.

### 5. Replace web containers and smoke test

```bash
docker compose up -d --no-build app proxy
docker compose ps
curl --fail http://127.0.0.1:8080/nginx-health
curl --fail http://127.0.0.1:8080/api/health
curl --fail http://127.0.0.1:8080/api/ready
```

Then verify through the real HTTPS origin:

- home, products, categories, blog, FAQ, sitemap, robots, one canonical, and one managed redirect;
- registration/login/logout and customer/admin authorization boundaries;
- customer address and order ownership isolation;
- admin catalog/content/SEO/customer/communications/users/audit/order/inventory/fulfillment pages appropriate to the operator role;
- a non-charging checkout validation path;
- WhatsApp links only when explicitly configured, with a same-origin tracked intent before redirect;
- payment initialization/status only in the deliberately selected environment and mode.

Observe app/proxy logs, readiness, database connections, error rate, and payment/order/inventory events for the agreed window before declaring completion.

## Database lifecycle

Prisma Migrate is the only migration history. Do not add a second migration system for the same `app` schema.

### Validate and deploy

```bash
npm run db:validate
docker compose run --rm migrate
```

`migrate` defaults to `npm run db:deploy` and requires `DIRECT_URL` with exactly one `schema=app` parameter. Both runtime and privileged URLs reject query-string host overrides; a public/FQDN database host must use exactly one lowercase `sslmode=verify-full`. The web app receives only `DATABASE_URL`. Never run `prisma migrate dev`, reset, or an interactive schema push against production.

Every new migration must also update the `application` row in `app.application_schema_metadata` to the migration directory name and update `REQUIRED_APPLICATION_SCHEMA_VERSION` in `src/server/db/schema-version.ts`. The automated schema-version test rejects a release when the newest migration, persisted sentinel, and runtime requirement drift apart.

Migration rollback is forward by default: write and review a compensating migration. Do not delete migration records or use `migrate resolve` merely to silence a failed deployment. A database restore is a data-loss decision and requires explicit authorization.

### Seed

```bash
docker compose run --rm migrate npm run db:seed
```

The repeatable seed:

- reconciles canonical permission definitions and the permission membership of the six system roles;
- creates missing baseline site settings but preserves the `value` of existing settings;
- creates missing payment-method records but preserves existing enabled state, display name, and instructions;
- leaves all fresh payment methods disabled, checkout charges unconfigured, online payment off, and WhatsApp unconfigured;
- never creates an administrator, credential, inventory location, bank/Zelle recipient, or provider secret.

If site-specific permissions are needed, create a non-system role. Changes to a canonical system role can be reverted by the next seed.

### Legacy catalog/content import

Run only for initial provisioning or a reviewed source refresh:

```bash
docker compose run --rm --env DIRECT_URL \
  operations npm run db:import:legacy
```

For a release gate that refuses missing legacy gallery assets:

```bash
docker compose run --rm --env DIRECT_URL operations \
  npm run db:import:legacy -- --strict-assets
```

Capture the JSON report as a release artifact. The importer is transactional, repeatable, preserves protected legacy slugs, does not invent SKUs, and does not prune database records absent from the checked-in source. Repeatable does not mean risk-free: review its source/report before a production rerun.

### Verify and grant the first owner

The intended owner must first register normally. Record the exact user UUID and independently verify control of the account/email out of band. Then run both explicit operations:

```bash
docker compose run --rm migrate \
  npm run admin:verify-email -- \
  --user-id=<exact-user-uuid> \
  --email=owner@example.com \
  --confirm-out-of-band

docker compose run --rm migrate \
  npm run admin:grant -- \
  --user-id=<exact-user-uuid> \
  --email=owner@example.com \
  --confirm-owner-grant
```

The jobs do not create a user or password. Both write audit records; the grant refuses an unverified account and requires exact UUID/email matching. It activates the admin profile and assigns the existing account the owner role idempotently. Use a named individual account, not a shared mailbox credential.

## Recurring jobs

Use exactly one scheduler per environment unless the platform provides explicit singleton/lease semantics. The code uses serializable transactions, locks, and idempotency defenses, but overlapping runs create unnecessary provider calls and database contention.

### Expire inventory reservations

```bash
docker compose run --rm operations \
  npm run inventory:expire-reservations -- --limit=100
```

- Limit must be `1..100`; default is 100.
- Repeat until `reservations` is zero. `hasMore: true` means another batch may remain.
- A successful run prints one JSON object; a failure prints a bounded error code and exits non-zero.
- Expiry releases reserved quantity, does not reduce on-hand stock, cancels a still-pending order, expires active unpaid attempts, and sends partial payment to review.

Schedule at least every few minutes. Alert on non-zero exit, repeated full batches that do not drain, inconsistent reservation errors, or an unexpected rise in canceled orders.

### Reconcile NOWPayments

Only schedule after the provider mode is deliberately provisioned; disabled mode exits non-zero by design.

```bash
docker compose run --rm \
  --env NOWPAYMENTS_MODE \
  --env NOWPAYMENTS_API_KEY \
  --env NOWPAYMENTS_IPN_SECRET \
  operations \
  npm run payments:reconcile:nowpayments -- \
  --batch-size=50 --older-than-minutes=5 \
  --unlinked-invoice-minutes=60
```

- Batch size must be `1..100`; linked-payment age must be `1..1440` minutes; invoice-only age must be `1..10080` minutes.
- The JSON report separates selected, processed, duplicate, failed, unresolved-invoice, and newly held records.
- Any failed selected record or unresolved invoice-only record makes the process exit non-zero so monitoring cannot silently ignore it.
- Reconciliation uses the same integrity/state/inventory transaction as signed IPN processing.
- An old invoice with no provider payment ID is moved to `REVIEW_REQUIRED`, emits a durable event/outbox alert, and is protected from automatic inventory expiration until reviewed.
- In the admin order detail, an authorized operator can either enter a provider payment ID for a live, strict invoice/order/currency/amount validation, or retype the invoice ID and explicitly attest that the provider dashboard shows no payment. The latter cancels the attempt and releases inventory transactionally. Never use the unpaid action when provider state is uncertain.

The base operations service maps no provider secret. The listed `--env` flags inherit exported values only for this explicit reconciliation invocation. In sandbox also pass `--env NOWPAYMENTS_API_BASE_URL`; pass `--env NOWPAYMENTS_TIMEOUT_MS` only for an intentional timeout override. Never replace optional values with dummy production values.

Five minutes is a reasonable initial cadence. Tune from measured volume and provider limits, not guesswork. See [nowpayments.md](nowpayments.md) for status policy and emergency disable steps.

### Clean database rate-limit buckets

```bash
docker compose run --rm operations \
  npm run security:cleanup-rate-limits -- \
  --older-than-hours=24 --limit=5000
```

Run daily. The job removes only buckets older than the retention boundary, preserves recent abuse state, prints a bounded JSON report, and reports `hasMore: true` when another batch may remain. Alert on failure or a backlog that does not drain.

### Deliver storage cleanups and reap stale uploads

```bash
docker compose run --rm operations \
  npm run storage:process-outbox -- --limit=50
```

Schedule every few minutes once object storage is configured (the container
needs the `STORAGE_*` variables; see [storage.md](storage.md)). The job
delivers queued `storage.objects.delete_requested` outbox events with
idempotent deletes, exponential backoff, and `FOR UPDATE SKIP LOCKED`
claiming, and marks `uploading` media rows older than an hour as failed with
their objects queued for cleanup. Alert on `failedPermanently > 0` or on
`status = 'failed'` storage events accumulating in `app.outbox_events`.

### Scan for orphan storage objects

```bash
docker compose run --rm operations \
  npm run storage:scan-orphans
```

Run daily or weekly; the default mode only reports. A non-empty `orphans`
list warrants investigation before running the explicit deletion form
documented in [storage.md](storage.md) (requires `--delete
--confirm-delete-orphans --actor-user-id=<admin-uuid>` and writes an audit
record).

### Suggested scheduler contract

For each recurring job:

1. start a fresh `operations` container with the current release image;
2. impose a platform timeout longer than the script's bounded provider/database timeouts;
3. capture stdout/stderr and exit code;
4. retry only after inspecting whether the failure is transient;
5. page an operator after repeated failures rather than running an unbounded retry loop.

## Manual payments and fulfillment

Wire transfer, Zelle, and other arranged payments have no automatic settlement integration. Operations must:

1. confirm the method/instructions were enabled for that order;
2. independently verify receipt in the authorized financial system;
3. confirm that the local order is still `PENDING_PAYMENT` and its inventory reservation is active;
4. use the admin manual-payment confirm/reject action;
5. verify the resulting payment event, audit record, order status, and single inventory consume/release movement.

The application refuses to use this action for NOWPayments and refuses to confirm a manual payment on an order that is no longer payable. The current form does not collect/upload payment evidence; keep any required evidence in the approved external financial record system and reference it through organizational procedure, not source code.

For a full Wire/Zelle refund, the site only records work already completed in the authorized bank or Zelle system; it never initiates the transfer. After independently completing and verifying the full refund:

1. open the confirmed payment on the admin order page and verify that it alone covers the exact order total and currency;
2. cancel every `DRAFT` or `LABEL_CREATED` shipment in Fulfillment first, so its line allocations are released;
3. enter the external refund reference and optional internal note, then accept the explicit completed-refund confirmation;
4. verify the `admin.manual_payment.external_refund_recorded` payment event, `payments.manual.external_refund_record` audit row, and matching outbox row;
5. if no carrier dispatch existed, verify one compensating `RETURN` movement and a canceled order; if dispatch existed, verify that inventory, shipment status, and tracking were preserved.

The action is full-refund only and refuses partial amounts, another non-terminal payment attempt, provider-managed payments, and already-refunded payments with a different reference. Repeating the same refund reference is idempotent and must not create another event or inventory return.

Carrier tracking templates are formatting aids, not live carrier verification. Administrators create shipments and tracking events manually. Before marking shipped/delivered, compare with the authorized carrier system; a rendered tracking URL is not proof of acceptance or delivery.

## Outbox and audit state

Business mutations write `app.outbox_events` in the same transaction as their aggregate changes. **There is currently no outbox dispatcher/consumer in this repository.** A `PENDING` row means “recorded for future delivery,” not “email/webhook/message delivered.” Rows will accumulate until a reviewed dispatcher and retention policy are added.

Inspect counts with a privileged read-only operations connection:

```bash
PGDATABASE="$DIRECT_URL" psql -v ON_ERROR_STOP=1 <<'SQL'
select status, count(*)
from app.outbox_events
group by status
order by status;

select event_type, count(*)
from app.outbox_events
where created_at >= now() - interval '24 hours'
group by event_type
order by count(*) desc, event_type;
SQL
```

Monitor table growth and database storage. Do not bulk-mark rows delivered, delete them, or build customer-facing claims around them. Audit logs are separate immutable administrative evidence; do not use the outbox as an audit substitute.

## Logs and monitoring

- Next.js and operations scripts write to stdout/stderr.
- nginx writes access logs to stdout and errors to stderr.
- `/api/health` is liveness; `/api/ready` validates configuration, the exact application-schema version sentinel, the seeded default-currency setting, and runtime access to the private `app` schema.
- Payment/order/inventory details are primarily durable database events, not guaranteed log lines.
- No log shipping, APM, uptime monitor, metrics store, or alert destination is bundled.

At minimum, configure platform alerts for:

- unhealthy/not-ready containers and restart loops;
- migration/job non-zero exits;
- sustained 5xx/429 changes against an established baseline;
- PostgreSQL connection saturation, storage growth, and backup failures;
- payment review/partial/repeated/unknown/late states;
- reservation-expiry backlog;
- stale invoice-only NOWPayments attempts;
- unexpected outbox growth.

Retain request IDs, timestamps, order/payment public identifiers, event types, and error names. Do not log authentication secrets, database URLs, IPN signatures/secrets, full payment addresses, or unnecessary customer addresses.

## Backup and restore

Use PostgreSQL 17 client tools. Store backups in encrypted, access-controlled storage outside the application container/host and define retention separately from this repository.

### Logical backup

Using `PGDATABASE` keeps the connection string out of command arguments:

```bash
umask 077
mkdir -p backups
backup="backups/ti-shop-$(date -u +%Y%m%dT%H%M%SZ).dump"
PGDATABASE="$DIRECT_URL" pg_dump \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --file="$backup"
pg_restore --list "$backup" >/dev/null
sha256sum "$backup" >"$backup.sha256"
```

Record the PostgreSQL server/client version, application image, migration state, UTC timestamp, checksum, encryption/storage location, and operator. A logical dump complements—not replaces—provider snapshots/PITR once a managed database is selected.

The checked-in public assets are part of the immutable app/source artifact, not the database backup. If external object storage is added later, back it up and restore it as a separate system with a consistency plan.

### Restore drill

Create a new isolated PostgreSQL 17 database with no production traffic. Never test restoration over the source database.

```bash
sha256sum --check backups/ti-shop-YYYYMMDDTHHMMSSZ.dump.sha256
PGDATABASE="$RESTORE_URL" pg_restore \
  --exit-on-error \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  backups/ti-shop-YYYYMMDDTHHMMSSZ.dump
```

Then point a matching isolated release at the restored database and verify:

- Prisma migration status and schema validation;
- row counts for users, products, orders, payments, reservations, movements, audit logs, and outbox;
- authentication and ownership boundaries;
- catalog/content/sitemap/redirect output;
- a representative order/payment/inventory chain without contacting a live provider;
- that production credentials and callbacks were not injected into the restore environment.

Document restore duration and any manual steps. Repeat on the retention interval chosen by operations.

## Rollback and recovery

### Roll back the application image when

- the migration and seed succeeded and are backward-compatible with the previous app;
- readiness or a critical user/admin flow fails only on the new image;
- no new release-only write has made the previous app unsafe.

Set the three image variables back to the prior matching release and redeploy app/proxy. Operations jobs must also use the matching prior image if they are run during rollback.

### Stop and investigate instead when

- a migration failed or schema compatibility is uncertain;
- payment/order totals disagree, a payment is confirmed without a valid provider/manual decision, or inventory is consumed/released more than once;
- authentication/authorization isolation fails;
- data corruption, secret exposure, or unexplained administrative writes are suspected;
- the only recovery would discard orders/payments created after the backup.

For payment incidents, turn the online-payment global switch off through the audited admin control first. If the app is unavailable, stop public checkout/app traffic while a privileged operator performs a reviewed emergency database change; record the before/after value and incident reference, then backfill the audit record according to organizational policy. Setting only `NOWPAYMENTS_MODE=disabled` prevents provider initialization but does not replace the database checkout kill switch.

Do not automatically reverse SQL migrations. Prefer a reviewed forward fix. Restore a database only with explicit business approval, a defined recovery point, reconciliation of external payments after that point, and a plan for data created between backup and restore.

## Release checklist

### Pre-deploy

- [ ] Exact release passed lint, typecheck, unit/integration tests, build, and production-like SEO/boundary verification.
- [ ] Migrations were reviewed and tested on PostgreSQL 17 from both a fresh database and a restored recent backup.
- [ ] Backup checksum and restore drill are verified.
- [ ] App/migrator/operations images share one immutable release identifier.
- [ ] Required secrets are present in correct scopes; no secret is in an image or `NEXT_PUBLIC_*` value.
- [ ] `SITE_URL`, TLS, trusted-proxy boundary, database privileges, health checks, and scheduler are verified.
- [ ] Payment/WhatsApp/carrier/manual-transfer features are described according to their actual configured state.
- [ ] Online payment is off during any payment/provider change.
- [ ] Rollback owner, observation window, and external-provider reconciliation owner are named.

### Deploy

- [ ] Run migration one-off; stop on non-zero exit.
- [ ] Run seed one-off; confirm it preserved operational values.
- [ ] Deploy the app/proxy without implicit migration.
- [ ] Verify nginx health, app health, and readiness.
- [ ] Smoke test public SEO, auth boundaries, customer ownership, and permission-scoped admin pages.
- [ ] Verify recurring jobs with the current operations image.
- [ ] If enabling NOWPayments, follow the separate sandbox/production sequence and enable the global switch last.

### Post-deploy

- [ ] Observe errors, readiness, database pool/storage, payment review, reservation backlog, and outbox growth.
- [ ] Verify one representative order/payment/inventory/fulfillment path appropriate to the environment.
- [ ] Record release/image IDs, migration result, backup ID, checks, operator, and timestamps.
- [ ] Close the deployment only after the agreed observation window.

### Immediate rollback/disable triggers

- Migration/seed failure or persistent readiness failure after the configured start period.
- Authentication, customer-order ownership, or admin-permission bypass.
- Incorrect price/tax/shipping total or cross-customer data exposure.
- Payment marked paid without verified policy conditions, or any duplicate/missing inventory movement.
- Signed provider events repeatedly rejected after a planned credential change.
- Error/latency/database saturation above the deployment's pre-agreed threshold.

When a trigger fires, stop expansion, disable online payment if relevant, preserve evidence, and choose image rollback, forward migration, or reviewed restore based on schema/data compatibility.
