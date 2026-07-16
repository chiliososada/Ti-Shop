-- Align the procurement order-number column with the snake_case physical
-- naming convention used across the schema.
ALTER TABLE "procurement_orders" RENAME COLUMN "orderNumber" TO "order_number";

UPDATE "app"."application_schema_metadata"
SET
  "version" = '20260715011500_finance_order_number_column',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'application';
