# Ti-Shop / Veripep

Ti-Shop is a database-backed independent commerce site for a US/USD storefront. It combines a Next.js public catalog, customer accounts and checkout, order/payment/inventory/fulfillment workflows, and a permission-controlled administration area.

The application is production-shaped but not production-connected: **no Supabase project, production payment account, bank/Zelle recipient, WhatsApp Business API, email provider, or carrier API is connected by this repository**. The current database target is any disposable PostgreSQL 17 instance. Supabase is deliberately the final infrastructure phase and has not been contacted or modified.

## Implemented scope

- Public catalog, categories, product variants, media galleries, product documents, merchandising placements, product detail, blog, FAQ, standalone content pages, legal/policy pages, search metadata, canonicals, `robots.txt`, dynamic sitemap, JSON-LD, and managed permanent redirects.
- Email/password registration and sign-in through Better Auth, database sessions, server-enforced account/admin boundaries, database RBAC, and administrative audit records. No administrator or password is seeded.
- Customer account pages for profile/password management, saved US shipping addresses, orders, payment state, shipments, estimated delivery, package measurements, tracking events, and merchant-maintained carrier links.
- Authenticated, idempotent checkout with server-side USD pricing, configured shipping/tax calculation, US address validation, checkout quotas, and 24-hour inventory reservations.
- NOWPayments adapter with disabled, local mock, sandbox, and production modes; signed IPN verification; status/integrity checks; duplicate-event protection; inventory consumption only after a verified final payment; and a reconciliation job.
- Manual wire transfer, Zelle, and arranged-payment order flows. Instructions are controlled by administrators and payment confirmation remains an explicit administrative decision after external verification.
- Fail-closed WhatsApp click-to-chat configuration with server-controlled templates and tracked click intent. It does not import conversations or claim a WhatsApp Business API connection.
- Product image management on Supabase Storage's S3-compatible API: authenticated admin uploads with content validation and WebP rendition generation, drag-and-drop/multi-file/progress/retry UI, primary-image and ordering control, alt text, batch deletion, outbox-driven object cleanup with retries, an orphan-object scanner, and fail-closed behavior while storage is unconfigured. See [docs/storage.md](docs/storage.md).
- Administration for catalog/prices/variants/media/tag associations, guarded CSV catalog updates, merchandising placements, navigation, fixed policy content, SEO/redirects, customers, inquiries/assignments/internal notes, tracked WhatsApp intents, users/admin activation/system and custom roles, searchable audit history, operational dashboard counts, customer/manual orders, payment controls, US inventory locations/adjustments, carriers, shipments/packages/tracking, and storefront WhatsApp settings.
- Transactional inventory movements/reservations, payment events, audit logs, and outbox rows for operational changes.

## Safe defaults and integration boundaries

A fresh seed is intentionally not ready to take money:

- all payment methods are disabled;
- the online-payment kill switch is off;
- checkout shipping/tax is marked unconfigured;
- WhatsApp is unconfigured and public links stay hidden;
- NOWPayments defaults to `disabled` and no credential is present;
- no bank, Zelle, administrator, or customer credential is seeded.

An administrator must explicitly configure checkout charges and enable a payment method. NOWPayments additionally requires valid runtime mode/credentials and the global online-payment switch. Only NOWPayments status `finished`, with the expected order, currency, amount, asset, and complete paid amount, can automatically confirm an order. Partial, repeated, mismatched, unknown, overpaid, expired-reservation, and late-payment cases require review or remain closed as appropriate.

The local mock is a deterministic development adapter, not evidence that NOWPayments is live. Docker production images set `NODE_ENV=production`, where mock mode is rejected. See [docs/nowpayments.md](docs/nowpayments.md) before enabling sandbox or production.

## Runtime baseline

- Node.js `24.18.0` (Node 23 is unsupported)
- npm `11.16.0`
- Next.js `16.2.10`, App Router, standalone output
- Prisma `7.8.0`
- PostgreSQL `17`
- Docker with an unprivileged nginx reverse proxy

Use the pinned versions in `.nvmrc` and `package.json`.

## Local development

Start a disposable PostgreSQL 17 database, or use another PostgreSQL 17 database that can be discarded:

```bash
docker run --name ti-shop-postgres \
  -e POSTGRES_DB=ti_shop \
  -e POSTGRES_USER=ti_shop \
  -e POSTGRES_PASSWORD=local-only-change-me \
  -p 127.0.0.1:5432:5432 \
  -d postgres:17-bookworm
```

Install the pinned runtime and prepare the environment:

```bash
nvm use
npm ci
cp .env.example .env
openssl rand -base64 48
```

Paste the generated secret into `BETTER_AUTH_SECRET`. For the disposable
database above, set both database URLs in `.env` to:

```dotenv
DATABASE_URL=postgresql://ti_shop:local-only-change-me@127.0.0.1:5432/ti_shop
DIRECT_URL=postgresql://ti_shop:local-only-change-me@127.0.0.1:5432/ti_shop?schema=app
SITE_URL=http://localhost:3000
BETTER_AUTH_SECRET=<paste-the-command-output-here>
```

The CLI scripts use `dotenv` and load `.env`; Next.js also loads it. Do not commit that file. In deployed environments, inject values from a secret manager instead.

Apply the schema and baseline records, then import the checked-in legacy catalog/content:

```bash
npm run db:generate
npm run db:validate
npm run db:deploy
npm run db:seed
npm run db:import:legacy
npm run dev
```

Open `http://localhost:3000`. The importer is transactional and repeatable, preserves protected legacy slugs, imports verified primary product assets, and emits a JSON asset report. To require every referenced legacy gallery file before importing, run:

```bash
npm run db:import:legacy -- --strict-assets
```

Strict asset validation runs before the database transaction and exits non-zero when a referenced asset is missing.

## Seed behavior

`npm run db:seed` is safe to repeat, with deliberate limits:

- it creates or updates the canonical permissions and reconciles the permission membership of the six system roles;
- it creates missing USD/US, payment, security, checkout, and WhatsApp settings, but **does not overwrite the `value` of an existing setting**;
- it creates missing payment-method defaults, but **does not overwrite an existing method's enabled state, display name, or public instructions**;
- it never creates a user, administrator, password, bank detail, payment credential, inventory location, or production secret.

Use a separate non-system role for site-specific permission combinations instead of editing the canonical system roles.

## First administrator

Register the intended owner through `/register`, record that exact account UUID, and independently verify control of the email address out of band. Then run both explicit steps:

```bash
npm run admin:verify-email -- \
  --user-id=<exact-user-uuid> \
  --email=owner@example.com \
  --confirm-out-of-band

npm run admin:grant -- \
  --user-id=<exact-user-uuid> \
  --email=owner@example.com \
  --confirm-owner-grant
```

Both commands require `DIRECT_URL` and write audit records. The grant command refuses an unverified account, refuses email-only targeting, does not create credentials, activates the admin profile, and assigns the owner role idempotently. Do not treat knowledge of an email address as proof of account ownership.

## Checkout activation

From `/admin/payments`:

1. Configure an explicit flat shipping amount and tax rate. Zero is allowed, but it must be an intentional saved value. The built-in rate is uniform for all supported US addresses; it is not a state/local tax engine, so confirm the treatment with a qualified tax adviser before using a nonzero value.
2. Review each customer-facing method name and instruction, then enable only the methods that operations can fulfill.
3. For wire/Zelle, keep recipient details out of source control and verify receipt externally before using the admin confirm action. Full refunds are also completed externally first; the order page can then record the verified refund reference with audit/event/outbox evidence and the correct pre-dispatch versus dispatched inventory behavior.
4. For NOWPayments, complete the environment, IPN, sandbox, and reconciliation steps in [docs/nowpayments.md](docs/nowpayments.md), then turn on the global online-payment switch last.

From `/admin/settings`, configure a valid E.164 WhatsApp number, public display value, and templates before enabling public entry points.

## Validation

```bash
npm run lint
npm run typecheck
npm run test
SITE_URL=https://veripep.com npm run build
SITE_URL=https://veripep.com npm run test:seo
```

`test:seo` starts the built standalone server, checks public sitemap entries and metadata, verifies protected route boundaries and 404 behavior, and confirms the legacy checkout return page makes no unverified payment claim. Build and test with the same intended public canonical origin. It requires a migrated, seeded, legacy-imported database through `DATABASE_URL`; it sends requests only to the local standalone listener.

## Docker deployment

The default Compose stack exposes only nginx on port 8080. The Next.js service is an internal, non-root, read-only standalone container. Migrations and recurring operations use separate profile-gated, non-root, read-only one-off services.

```bash
docker compose build --pull app migrate operations
docker compose pull proxy
docker compose run --rm migrate
docker compose run --rm migrate npm run db:seed
docker compose run --rm --env DIRECT_URL operations npm run db:import:legacy
docker compose up -d app proxy
curl --fail http://127.0.0.1:8080/nginx-health
curl --fail http://127.0.0.1:8080/api/ready
```

Do not place migrations in the web-container startup command. `/api/health` is process liveness; `/api/ready` validates runtime configuration, NOWPayments mode configuration, the exact application-schema version sentinel, and the seeded default-currency setting. This prevents an empty, stale, or inaccessible database from receiving traffic. Full deployment topology, trusted-proxy details, and image-promotion notes are in [deploy/README.md](deploy/README.md).

Recurring jobs, backup/restore, rollback triggers, and the release checklist are in [docs/operations.md](docs/operations.md).

## Database ownership and the final Supabase phase

Prisma Migrate is the sole schema migration system. Application tables live in the private PostgreSQL `app` schema. `DATABASE_URL` is the limited long-running connection; `DIRECT_URL` is privileged and belongs only in migration, seed, import, and explicit owner-grant jobs.

Supabase is planned only as managed PostgreSQL hosting. The application does not use Supabase Auth or a browser-side Supabase client. No Supabase project has been connected during the work described here. When local validation and operational review are complete, follow [docs/supabase.md](docs/supabase.md) as the final infrastructure step.
