-- CreateTable
CREATE TABLE "app"."rate_limits" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "last_request" BIGINT NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_key_key" ON "app"."rate_limits"("key");

-- CreateIndex
CREATE INDEX "rate_limits_last_request_idx" ON "app"."rate_limits"("last_request");

ALTER TABLE "app"."rate_limits"
  ADD CONSTRAINT "rate_limits_count_check" CHECK ("count" >= 0),
  ADD CONSTRAINT "rate_limits_last_request_check" CHECK ("last_request" >= 0);

-- Repair any account created before the database-level invariant existed.
INSERT INTO "app"."customer_profiles" ("user_id", "updated_at")
SELECT "users"."id", CURRENT_TIMESTAMP
FROM "app"."users"
LEFT JOIN "app"."customer_profiles"
  ON "customer_profiles"."user_id" = "users"."id"
WHERE "customer_profiles"."user_id" IS NULL
ON CONFLICT ("user_id") DO NOTHING;

-- Better Auth inserts the user row independently. This AFTER INSERT trigger
-- creates its required customer profile in the same transaction, so either
-- both rows commit or neither does. SECURITY DEFINER is narrowly scoped: all
-- object names are qualified, the search path is fixed, and PUBLIC cannot call
-- the function directly.
CREATE FUNCTION "app"."create_customer_profile_for_user"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  INSERT INTO "app"."customer_profiles" ("user_id", "updated_at")
  VALUES (NEW."id", CURRENT_TIMESTAMP)
  ON CONFLICT ("user_id") DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "app"."create_customer_profile_for_user"() FROM PUBLIC;

CREATE TRIGGER "users_create_customer_profile_after_insert"
AFTER INSERT ON "app"."users"
FOR EACH ROW
EXECUTE FUNCTION "app"."create_customer_profile_for_user"();
