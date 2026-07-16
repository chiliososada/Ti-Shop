ALTER TABLE "app"."roles"
  ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX "roles_public_id_key"
  ON "app"."roles"("public_id");
