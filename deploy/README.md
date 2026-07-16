# Docker self-hosting

This deployment runs the Next.js 16 standalone server behind an unprivileged nginx reverse proxy and connects to an external PostgreSQL 17 database. The Compose file intentionally does not create a production database.

```text
client -> TLS/CDN/load balancer -> nginx :8080 -> private backend -> Next.js :3000
                                                          |
                                                          +-> PostgreSQL 17
                                                          +-> NOWPayments (only when enabled)
```

Only nginx has a host-published port. The application uses `expose: 3000` for container-to-container traffic; publishing that origin port would bypass the trusted client-IP boundary.

## Container targets

| Target/service | Purpose | Long-running |
| --- | --- | --- |
| `runner` / `app` | Minimal Next.js standalone application | Yes |
| pinned nginx image / `proxy` | Reverse proxy, request limits, trusted forwarding headers | Yes |
| `migrator` / `migrate` | Prisma migration, seed, and owner-grant commands | No |
| `operations` / `operations` | Legacy import, reservation expiry, NOWPayments reconciliation | No |

The app and both job services run as UID/GID 1000, drop all Linux capabilities, enable `no-new-privileges`, and use read-only root filesystems with bounded `/tmp` tmpfs mounts. nginx runs as UID/GID 101 with the same restrictions. The web image never receives `DIRECT_URL` and does not contain the Prisma CLI.

The `migrate` and `operations` services use the Compose `operations` profile. `docker compose up` therefore cannot launch them accidentally; an explicit `docker compose run --rm <service>` invokes a targeted job.

## Required deployment values

Provide these through the host environment, an uncommitted `.env`, or the platform secret manager:

| Variable | Scope | Requirement |
| --- | --- | --- |
| `DATABASE_URL` | app, operations | Limited PostgreSQL runtime role; public/FQDN production hosts must use one `sslmode=verify-full` parameter, with no query-string host override |
| `DIRECT_URL` | migration/privileged jobs only | Role allowed to apply migrations and seed; require `schema=app` and the same public-host `sslmode=verify-full` rule; never inject into `app` |
| `SITE_URL` | app | Exact customer-facing origin, such as `https://shop.example.com`; no path |
| `BETTER_AUTH_SECRET` | app | Unique random secret generated with `openssl rand -base64 48`; production rejects shorter or placeholder values |

Optional application variables actually read by the code are:

- `DB_POOL_MAX` (`1..50`, default `10`)
- `DB_POOL_IDLE_TIMEOUT_MS` (`1000..120000`, default `10000`)
- `DB_POOL_CONNECTION_TIMEOUT_MS` (`1000..60000`, default `5000`)
- `DB_POOL_MAX_LIFETIME_SECONDS` (`60..86400`, default `1800`)
- `NOWPAYMENTS_MODE`, `NOWPAYMENTS_API_BASE_URL`, `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, and `NOWPAYMENTS_TIMEOUT_MS`; the app maps them deliberately, while a reconciliation job must inherit only the needed values explicitly as documented in [../docs/nowpayments.md](../docs/nowpayments.md)

Compose-only deployment controls are `TI_SHOP_BIND_ADDRESS`, `TI_SHOP_HTTP_PORT`, `TI_SHOP_APP_IMAGE`, `TI_SHOP_MIGRATOR_IMAGE`, and `TI_SHOP_OPERATIONS_IMAGE`. The published proxy defaults to `127.0.0.1`; explicitly choose a private interface only after the upstream network and firewall are defined.

`AUTH_CLIENT_IP_HEADER` and `AUTH_TRUSTED_PROXY_CIDRS` are deliberately fixed by this Compose topology. Do not override them with client-supplied values. USD, supported country, admin-MFA policy, checkout charges, payment enablement, and WhatsApp configuration are database settings—not environment variables.

## Build and promote one release

Build all project-owned targets from the same source revision and pull the digest-pinned proxy:

```bash
docker compose build --pull app migrate operations
docker compose pull proxy
```

For a registry-based release, tag/push the three project images with one immutable release identifier and set `TI_SHOP_APP_IMAGE`, `TI_SHOP_MIGRATOR_IMAGE`, and `TI_SHOP_OPERATIONS_IMAGE` to those matching versions. Do not rebuild separately in staging and production. Next.js generates a build identity at build time; every replica in one release must run the same artifact.

Before the first Compose command, populate all required app values as well as `DIRECT_URL`; Compose validates required app interpolation even when a one-off service is the immediate target.

## Deployment order

Back up the database and test the release in staging first. Then:

```bash
docker compose run --rm migrate
docker compose run --rm migrate npm run db:seed
docker compose up -d --no-build app proxy
docker compose ps
curl --fail http://127.0.0.1:8080/nginx-health
curl --fail http://127.0.0.1:8080/api/health
curl --fail http://127.0.0.1:8080/api/ready
```

Run the legacy import only for a new environment or an explicitly reviewed catalog refresh. `--env DIRECT_URL` inherits that secret for this container invocation only; routine operations jobs do not receive it:

```bash
docker compose run --rm --env DIRECT_URL operations npm run db:import:legacy
```

The import is repeatable, but it is still a catalog mutation and should not be part of every web restart. The seed is safe to repeat and preserves existing operational setting values and payment-method configuration; it does reconcile canonical system-role permissions.

Never make `db:deploy`, `db:seed`, or the legacy import part of the app `CMD`. A failed one-off job must stop the deployment before web containers are replaced.

## Health semantics

- `GET /nginx-health` proves the proxy process is serving requests.
- `GET /api/health` proves the Next.js process is alive; it intentionally does not query PostgreSQL.
- `GET /api/ready` validates required runtime configuration, parses the selected NOWPayments mode, and reads the exact application-schema version sentinel plus the seeded default-currency setting. This rejects an empty/stale database and verifies runtime access to the private `app` schema. It returns `503` with `Retry-After: 5` when the app must not receive traffic.

The app and Compose health checks use `/api/ready`; nginx starts only after that check is healthy. Do not replace readiness with liveness in a production scheduler.

## Trusted client-IP boundary

nginx discards incoming `Forwarded`, `X-Forwarded-For`, `X-Real-IP`, `X-Ti-Shop-Client-IP`, and historical middleware-bypass values, then writes its own forwarding headers. Compose tells Better Auth and the anonymous WhatsApp intent handler to trust `X-Ti-Shop-Client-IP` only from nginx's fixed backend address (`172.31.250.10/32`). Login and application rate-limit counters are stored in PostgreSQL and are shared between application replicas; schedule `npm run security:cleanup-rate-limits` to remove expired buckets.

Keep these invariants:

- never publish app port 3000;
- never pass through a client's forwarding header;
- never widen the trusted proxy CIDR to a public or application network;
- when a CDN/load balancer is added, configure nginx `real_ip_header` only with that provider's exact maintained `set_real_ip_from` CIDRs.

Without trusted real-IP configuration, nginx safely sees the upstream load-balancer address. That may make per-client limits coarser, but it does not let a client forge the key.

## TLS and streaming

The included nginx listens on plain HTTP port 8080 and Compose binds it to loopback by default. Production must terminate TLS at an explicitly trusted upstream or replace this edge with an approved TLS configuration. `SITE_URL` must still be the external HTTPS origin. If TLS terminates upstream, set the forwarded scheme from trusted deployment configuration; do not restore pass-through of an unvalidated incoming header. Add HSTS only after HTTPS is enforced end to end.

nginx disables response buffering so App Router streaming can reach clients, while request bodies remain buffered and bounded. Current edge limits include a 12 MiB request body, short header/body timeouts, a login-route limiter, and a separate per-IP WhatsApp-intent limiter. The app port must remain private because the application-level anonymous key relies on the proxy overwriting its trusted client-IP header.

## Multiple replicas and rolling releases

The supplied Compose file is a single-app-instance baseline. Before scaling horizontally, provide all of the following:

- the same application image/build across replicas;
- a stable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` embedded consistently at build time;
- a Next.js `deploymentId` strategy for version-skew protection;
- a shared cache/tag invalidation implementation if cached responses are served by multiple replicas;
- a load balancer that honors readiness and allows a 10–30 second graceful drain.

The app container uses `SIGTERM` and a 30-second stop grace period, matching Next.js self-hosting guidance for in-flight requests and `after()` work.

## Routine inspection

```bash
docker compose ps
docker compose logs --since=15m --tail=500 app proxy
docker compose top
docker inspect --format '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}}' "$(docker compose ps -q app)"
```

Application and job logs go to stdout/stderr; nginx access/error logs do the same. The repository does not install a log collector or alerting system. Configure those in the deployment platform and avoid retaining sensitive payment/customer payloads unnecessarily.

Backup, restore, recurring jobs, release verification, and rollback triggers are documented in [../docs/operations.md](../docs/operations.md).
