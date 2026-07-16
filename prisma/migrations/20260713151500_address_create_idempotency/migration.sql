ALTER TABLE "app"."addresses"
  ADD COLUMN "create_request_id" UUID;

CREATE UNIQUE INDEX "addresses_user_create_request_key"
  ON "app"."addresses"("user_id", "create_request_id");

UPDATE "app"."application_schema_metadata"
SET
  "version" = '20260713151500_address_create_idempotency',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'application';
