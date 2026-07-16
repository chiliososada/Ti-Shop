ALTER TABLE "app"."merchandising_placements"
  ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX "merchandising_placements_public_id_key"
  ON "app"."merchandising_placements"("public_id");
