-- Supplier price lists contain reference costs but no purchased quantities.
-- Keep them separate from received inventory valuation so importing a quote
-- never creates fictitious stock.
ALTER TABLE "product_variants"
  ADD COLUMN "reference_cost_cny_minor" BIGINT,
  ADD COLUMN "reference_cost_usd_minor" BIGINT,
  ADD COLUMN "reference_cost_fx_rate_cny_per_usd" DECIMAL(18,8),
  ADD COLUMN "reference_cost_fx_date" TIMESTAMPTZ(3),
  ADD COLUMN "reference_cost_source" VARCHAR(500),
  ADD COLUMN "reference_cost_metadata" JSONB,
  ADD COLUMN "reference_cost_updated_at" TIMESTAMPTZ(3);

ALTER TABLE "order_items"
  ADD COLUMN "cost_is_estimated" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_reference_cost_pair_check"
  CHECK (
    ("reference_cost_cny_minor" IS NULL AND "reference_cost_usd_minor" IS NULL)
    OR
    (
      "reference_cost_cny_minor" IS NOT NULL
      AND "reference_cost_usd_minor" IS NOT NULL
      AND "reference_cost_cny_minor" >= 0
      AND "reference_cost_usd_minor" >= 0
    )
  );

UPDATE "app"."application_schema_metadata"
SET
  "version" = '20260719113000_reference_supplier_costs',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'application';
