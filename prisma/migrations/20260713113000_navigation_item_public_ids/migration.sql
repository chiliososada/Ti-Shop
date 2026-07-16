-- Stable public identifiers let administrative forms address navigation links
-- without exposing sequential database identities. Existing rows are safely
-- backfilled before the column becomes required.
ALTER TABLE "app"."navigation_items"
  ADD COLUMN "public_id" UUID;

UPDATE "app"."navigation_items"
SET "public_id" = gen_random_uuid()
WHERE "public_id" IS NULL;

ALTER TABLE "app"."navigation_items"
  ALTER COLUMN "public_id" SET NOT NULL;

CREATE UNIQUE INDEX "navigation_items_public_id_key"
  ON "app"."navigation_items"("public_id");
