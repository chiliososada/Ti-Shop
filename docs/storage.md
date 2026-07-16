# Product image object storage (Supabase Storage, S3-compatible)

Ti-Shop stores product photos in a dedicated object storage bucket and keeps
PostgreSQL as the source of truth for which images exist. The application
talks to storage only through the server-side provider in
`src/server/storage/` using the S3-compatible API; the browser never receives
storage credentials, and public delivery uses plain public-bucket URLs that a
CDN can cache.

Fail-closed defaults apply: with no `STORAGE_*` configuration the site runs
normally, existing images keep rendering, and the admin uploader explains that
uploads are disabled.

## Architecture summary

- **Bucket**: one public-read bucket (default `product-images`). Writes happen
  only from server code behind `catalog.manage` RBAC.
- **Object keys are immutable**: every upload gets
  `products/<productPublicId>/<imageUuid>/<rendition>.webp`. Replacements
  upload to a new UUID directory and delete the old objects afterwards, so a
  CDN can cache with `public, max-age=31536000, immutable` (set on upload) and
  never serves a stale replacement.
- **Renditions**: uploads are validated (magic numbers, size, pixel bomb cap),
  fully re-encoded with sharp (EXIF/GPS stripped, orientation applied), and
  stored as WebP `original` (≤2400px), `detail` (≤1600px), `card` (≤640px),
  and `thumb` (≤320px).
- **Consistency**: the database row is reserved first (`upload_status =
  uploading`), then objects upload, then the row is published (`ready`).
  Failures mark the row `failed` and enqueue object cleanup through the
  outbox. Deletion detaches the image immediately and removes objects
  asynchronously with retries; deleting an already-deleted image succeeds.
- **Jobs**: `npm run storage:process-outbox` delivers pending
  `storage.objects.delete_requested` events (idempotent, `FOR UPDATE SKIP
  LOCKED`, exponential backoff, permanent-failure marking) and reaps
  `uploading` rows that never completed. `npm run storage:scan-orphans`
  reports bucket objects no media row references; it deletes only with
  `--delete --confirm-delete-orphans --actor-user-id=<admin-uuid>` and writes
  an audit record. Supabase Storage has no S3 object versioning, so recovery
  never relies on bucket versioning.

## Environment variables

All values are server-side only. Never use a `NEXT_PUBLIC_` prefix, never
commit them, and never paste the secret key into chats/logs/issues.

| Variable | Meaning |
| --- | --- |
| `STORAGE_PROVIDER` | Must be `supabase`. |
| `STORAGE_BUCKET_PRODUCT_IMAGES` | Bucket name (default `product-images`). |
| `STORAGE_S3_ENDPOINT` | `https://<project-ref>.supabase.co/storage/v1/s3` (verify in Dashboard → Storage → S3 connection). |
| `STORAGE_S3_REGION` | The project region shown next to the S3 connection settings. |
| `STORAGE_S3_ACCESS_KEY_ID` / `STORAGE_S3_SECRET_ACCESS_KEY` | An S3 access key pair created in the Dashboard. |
| `STORAGE_PUBLIC_BASE_URL` | `https://<project-ref>.supabase.co/storage/v1/object/public/product-images` — the prefix that serves public objects of the bucket. |
| `STORAGE_S3_FORCE_PATH_STYLE` | Default `true` (correct for Supabase and MinIO). |
| `STORAGE_REQUEST_TIMEOUT_MS` | Default `15000`. |
| `PRODUCT_IMAGE_MAX_BYTES` | Default `10485760` (10 MB). |
| `PRODUCT_IMAGE_ALLOWED_TYPES` | Default `image/jpeg,image/png,image/webp,image/avif`. SVG is rejected by policy and cannot be enabled here. |

`http://` endpoints are accepted only for loopback hosts (local MinIO) and are
always rejected when `NODE_ENV=production`.

## One-time Supabase setup (Dashboard)

1. **Create the bucket**: Storage → New bucket → name `product-images` →
   enable *Public bucket*. Optionally set the bucket file-size limit to match
   `PRODUCT_IMAGE_MAX_BYTES` and allowed MIME types to the image allowlist.
2. **Do not add RLS policies that allow client writes.** The application
   writes through the S3 protocol with its own keys; browser-side Supabase
   clients are not used. Public read of a public bucket needs no extra policy.
3. **Create S3 access keys**: Project Settings → Storage (S3 connection) →
   *New access key*. Record the access key id and secret in the deployment
   secret manager. This is the only place the secret is ever stored.
4. Copy the endpoint/region shown there into `STORAGE_S3_ENDPOINT` /
   `STORAGE_S3_REGION`, and build `STORAGE_PUBLIC_BASE_URL` from the project
   ref as shown above.
5. Confirm current limits and behavior against the Supabase Storage docs on
   execution day (S3 compatibility, upload limits, CDN caching); the platform
   changes over time.

## Key rotation

1. Create a second S3 access key pair in the Dashboard.
2. Update the secret manager values (`STORAGE_S3_ACCESS_KEY_ID`,
   `STORAGE_S3_SECRET_ACCESS_KEY`) and roll the app/operations containers.
3. Verify an upload and `npm run storage:process-outbox` under the new keys.
4. Revoke the old key pair in the Dashboard.

Rotation needs no code or data change: object URLs are public and derived
from `STORAGE_PUBLIC_BASE_URL`, not from the keys.

## Local development and tests

Run a disposable MinIO and point the same variables at it:

```bash
docker run -d --name ti-shop-minio \
  -p 127.0.0.1:9000:9000 -p 127.0.0.1:9001:9001 \
  -e MINIO_ROOT_USER=ti-shop-local -e MINIO_ROOT_PASSWORD=local-only-change-me \
  minio/minio server /data --console-address ":9001"
```

Create `product-images` (dev) and `product-images-test` (integration tests)
buckets with a public-read policy, then set in `.env`:

```dotenv
STORAGE_PROVIDER=supabase
STORAGE_BUCKET_PRODUCT_IMAGES=product-images
STORAGE_S3_ENDPOINT=http://127.0.0.1:9000
STORAGE_S3_REGION=us-east-1
STORAGE_S3_ACCESS_KEY_ID=ti-shop-local
STORAGE_S3_SECRET_ACCESS_KEY=local-only-change-me
STORAGE_PUBLIC_BASE_URL=http://127.0.0.1:9000/product-images
```

Storage integration suites are gated by environment variables and run against
the isolated test bucket — never against a production bucket:

```bash
ADMIN_DB_INTEGRATION_URL=postgresql://... \
STORAGE_TEST_S3_ENDPOINT=http://127.0.0.1:9000 \
STORAGE_TEST_S3_ACCESS_KEY_ID=ti-shop-local \
STORAGE_TEST_S3_SECRET_ACCESS_KEY=local-only-change-me \
npm run test
```

## Operations

Schedule alongside the existing recurring jobs (see `docs/operations.md`):

- `npm run storage:process-outbox -- --limit=50` — every few minutes.
  Delivers queued object deletions and reaps stale uploads. Safe to run
  concurrently and to re-run after crashes.
- `npm run storage:scan-orphans` — daily/weekly, report-only. Investigate a
  non-empty `orphans` list before deleting; deletion requires explicit flags
  and an active administrator UUID for the audit trail.

Failure visibility: outbox rows with `status = failed` and a `last_error`
need operator attention (`select * from app.outbox_events where status =
'failed' and event_type like 'storage.%'`).

## Failure and recovery matrix

| Scenario | Behavior |
| --- | --- |
| Storage down during upload | Upload returns a retryable error; the reserved row is marked `failed`, detached, and its objects are queued for cleanup. The admin UI offers Retry. |
| Crash between object upload and publish | Row stays `uploading`; the worker reaps it after 60 minutes and cleans the objects. |
| DB write succeeded, object delete failed | Outbox retries with backoff (up to 12 attempts), then marks `failed` for operator review. Objects are never referenced by live rows at this point. |
| Object already deleted | Deletion treats missing objects as success. |
| Orphan objects (no DB row) | Reported by the scanner; deleted only manually with confirmation flags. |
| Storage unconfigured | Uploads disabled with an explanatory admin banner; storefront unaffected. |
