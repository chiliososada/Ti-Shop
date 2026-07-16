-- CreateEnum
CREATE TYPE "media_upload_status" AS ENUM ('uploading', 'ready', 'failed');

-- AlterTable
ALTER TABLE "media" ADD COLUMN     "bucket" VARCHAR(120),
ADD COLUMN     "created_by_user_id" UUID,
ADD COLUMN     "original_filename" VARCHAR(255),
ADD COLUMN     "title" VARCHAR(255),
ADD COLUMN     "upload_status" "media_upload_status" NOT NULL DEFAULT 'ready',
ADD COLUMN     "variants" JSONB;

-- CreateIndex
CREATE INDEX "media_upload_status_idx" ON "media"("upload_status", "updated_at");

-- CreateIndex
CREATE INDEX "media_checksum_idx" ON "media"("checksum");

-- CreateIndex
CREATE INDEX "media_created_by_user_id_idx" ON "media"("created_by_user_id");

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Uniqueness guards Prisma cannot describe (see prisma/schema/catalog.prisma).
-- One product-level primary image per product; concurrent promotions collide here.
CREATE UNIQUE INDEX "product_media_primary_unique"
  ON "product_media" ("product_id")
  WHERE "role" = 'primary' AND "variant_id" IS NULL;

-- The same media asset can be linked to a (product, variant) scope only once.
-- NULLS NOT DISTINCT makes repeated product-level links collide too.
CREATE UNIQUE INDEX "product_media_link_unique"
  ON "product_media" ("product_id", "media_id", "variant_id") NULLS NOT DISTINCT;

UPDATE "app"."application_schema_metadata"
SET
  "version" = '20260714140122_product_image_storage',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'application';
