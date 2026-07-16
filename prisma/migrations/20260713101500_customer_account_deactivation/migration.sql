-- Persistent customer account access state. Orders, addresses, and audit rows
-- continue to reference the user; disabling is deliberately not deletion.
ALTER TABLE "app"."users"
  ADD COLUMN "disabled_at" TIMESTAMPTZ(3),
  ADD COLUMN "disabled_reason" VARCHAR(500),
  ADD COLUMN "disabled_by_user_id" UUID;

ALTER TABLE "app"."users"
  ADD CONSTRAINT "users_disabled_state_check"
  CHECK (
    (
      "disabled_at" IS NULL
      AND "disabled_reason" IS NULL
      AND "disabled_by_user_id" IS NULL
    )
    OR (
      "disabled_at" IS NOT NULL
      AND "disabled_reason" IS NOT NULL
      AND length(btrim("disabled_reason")) >= 10
    )
  );

ALTER TABLE "app"."users"
  ADD CONSTRAINT "users_disabled_by_user_id_fkey"
  FOREIGN KEY ("disabled_by_user_id")
  REFERENCES "app"."users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "users_disabled_at_idx"
  ON "app"."users"("disabled_at");

CREATE INDEX "users_disabled_by_user_id_idx"
  ON "app"."users"("disabled_by_user_id");

-- Synchronize session creation with account deactivation. The row lock means
-- either a session commits first and is deleted by the disabling transaction,
-- or the disabling transaction commits first and this insert is rejected.
CREATE FUNCTION "app"."enforce_active_session_user"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  account_disabled_at TIMESTAMPTZ;
BEGIN
  SELECT account."disabled_at"
  INTO account_disabled_at
  FROM "app"."users" AS account
  WHERE account."id" = NEW."user_id"
  FOR UPDATE OF account;

  IF FOUND AND account_disabled_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Session creation rejected.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION "app"."enforce_active_session_user"() FROM PUBLIC;

CREATE TRIGGER "sessions_require_active_user"
BEFORE INSERT ON "app"."sessions"
FOR EACH ROW
EXECUTE FUNCTION "app"."enforce_active_session_user"();
