-- Cost 2 is the partner-inclusive midpoint between the USD selling price and
-- Cost 1. Store it on each price row so scheduled/sale prices retain their own
-- correct value, and snapshot it on order items for historical reporting.
ALTER TABLE "app"."prices"
  ADD COLUMN "cost2_usd_minor" BIGINT;

ALTER TABLE "app"."order_items"
  ADD COLUMN "unit_cost2_usd_minor" BIGINT,
  ADD COLUMN "total_cost2_usd_minor" BIGINT;

ALTER TABLE "app"."prices"
  ADD CONSTRAINT "prices_cost2_nonnegative_check"
  CHECK ("cost2_usd_minor" IS NULL OR "cost2_usd_minor" >= 0);

ALTER TABLE "app"."order_items"
  ADD CONSTRAINT "order_items_cost2_pair_check"
  CHECK (
    ("unit_cost2_usd_minor" IS NULL AND "total_cost2_usd_minor" IS NULL)
    OR
    (
      "unit_cost2_usd_minor" IS NOT NULL
      AND "total_cost2_usd_minor" IS NOT NULL
      AND "unit_cost2_usd_minor" >= 0
      AND "total_cost2_usd_minor" >= 0
    )
  );

-- Signed half-away-from-zero rounding matches the application's one and only
-- money-division rule. STRICT makes a missing Cost 1 produce a NULL Cost 2.
CREATE FUNCTION "app"."calculate_cost2_usd_minor"(
  "selling_price_usd_minor" BIGINT,
  "cost1_usd_minor" BIGINT
) RETURNS BIGINT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT "cost1_usd_minor" +
    CASE
      WHEN "selling_price_usd_minor" - "cost1_usd_minor" >= 0
        THEN (("selling_price_usd_minor" - "cost1_usd_minor") + 1) / 2
      ELSE -((-("selling_price_usd_minor" - "cost1_usd_minor") + 1) / 2)
    END;
$$;

CREATE FUNCTION "app"."set_price_cost2_usd_minor"()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  "cost1" BIGINT;
BEGIN
  IF NEW."currency" = 'USD' THEN
    SELECT "reference_cost_usd_minor"
      INTO "cost1"
      FROM "app"."product_variants"
      WHERE "id" = NEW."variant_id";
    NEW."cost2_usd_minor" := "app"."calculate_cost2_usd_minor"(
      NEW."amount_minor",
      "cost1"
    );
  ELSE
    NEW."cost2_usd_minor" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "prices_set_cost2"
BEFORE INSERT OR UPDATE ON "app"."prices"
FOR EACH ROW
EXECUTE FUNCTION "app"."set_price_cost2_usd_minor"();

CREATE FUNCTION "app"."refresh_variant_price_cost2"()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  UPDATE "app"."prices"
  SET "cost2_usd_minor" = "app"."calculate_cost2_usd_minor"(
    "amount_minor",
    NEW."reference_cost_usd_minor"
  )
  WHERE "variant_id" = NEW."id";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "product_variants_refresh_price_cost2"
AFTER UPDATE OF "reference_cost_usd_minor" ON "app"."product_variants"
FOR EACH ROW
WHEN (OLD."reference_cost_usd_minor" IS DISTINCT FROM NEW."reference_cost_usd_minor")
EXECUTE FUNCTION "app"."refresh_variant_price_cost2"();

CREATE FUNCTION "app"."set_order_item_cost2_usd_minor"()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF
    NEW."currency" <> 'USD'
    OR NEW."compensation_event_id" IS NOT NULL
    OR NEW."unit_cost_usd_minor" IS NULL
    OR NEW."total_cogs_usd_minor" IS NULL
  THEN
    NEW."unit_cost2_usd_minor" := NULL;
    NEW."total_cost2_usd_minor" := NULL;
  ELSE
    NEW."unit_cost2_usd_minor" := "app"."calculate_cost2_usd_minor"(
      NEW."unit_price_minor",
      NEW."unit_cost_usd_minor"
    );
    NEW."total_cost2_usd_minor" := "app"."calculate_cost2_usd_minor"(
      NEW."line_total_minor" - NEW."tax_minor",
      NEW."total_cogs_usd_minor"
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "order_items_set_cost2"
BEFORE INSERT OR UPDATE ON "app"."order_items"
FOR EACH ROW
EXECUTE FUNCTION "app"."set_order_item_cost2_usd_minor"();

-- Backfill every existing USD price and every historical order item with a
-- known Cost 1. Updating in place also exercises the same triggers used by
-- all future writes.
UPDATE "app"."prices"
SET "cost2_usd_minor" = "cost2_usd_minor";

UPDATE "app"."order_items"
SET "updated_at" = "updated_at";

UPDATE "app"."application_schema_metadata"
SET
  "version" = '20260719143000_partner_cost2',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'application';
