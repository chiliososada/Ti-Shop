# Self-hosted data services (PostgreSQL + MinIO on the app host)

Production moved off Supabase on 2026-08-24. Everything runs from
`~/flintmarrow` on the HPE host via `compose.yaml` + this override.

## Layout

| Service | Image | Network | Exposure |
|---|---|---|---|
| `db` | postgres:17-alpine | `data` (internal) | none |
| `minio` | minio/minio (pinned) | `data` + `edge` | `127.0.0.1:9000` → Kong route `/media/` |
| `app` / `operations` / `migrate` | project images | + `data` | unchanged |

- Roles: `ti_shop_migrator` (owns schema `app`, migrations/imports) and
  `ti_shop_app` (runtime; grants in `grant-runtime.sql`). Both created by
  `db-init/01-roles.sh` on first boot from `.env` secrets.
- Public media: bucket `media`, anonymous download only. Kong routes
  `https://flintmarrow.com/media/<key>` → MinIO (path route, admin API is
  not reachable). `STORAGE_PUBLIC_BASE_URL=https://flintmarrow.com/media`.
- Nightly backup: `backup-db.sh` via cron (03:30 JST), 30-day retention in
  `~/flintmarrow/backups`. **Copy that directory off-box regularly.**

## Restore from a backup

```sh
cd ~/flintmarrow
docker compose stop app
gunzip -c backups/ti_shop_<ts>.dump.gz > /tmp/restore.dump
docker compose exec -T db psql -U postgres -d ti_shop -c 'drop schema app cascade'
cat /tmp/restore.dump | docker compose exec -T db sh -c \
  'PGPASSWORD=$TI_SHOP_MIGRATOR_PASSWORD pg_restore -U ti_shop_migrator -d ti_shop --no-owner --no-privileges --exit-on-error'
cat deploy/selfhost/grant-runtime.sql | docker compose exec -T db sh -c \
  'PGPASSWORD=$TI_SHOP_MIGRATOR_PASSWORD psql -U ti_shop_migrator -d ti_shop'
docker compose up -d app && curl -s http://127.0.0.1:8080/api/ready
```

## Applying a new migration

`docker compose run --rm migrate` (uses `DIRECT_URL` = migrator role).
Default privileges already cover new tables for `ti_shop_app`.
