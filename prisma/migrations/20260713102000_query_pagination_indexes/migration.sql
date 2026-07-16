-- Match the stable sort orders used by public catalog and operational admin
-- lists. These indexes do not change query semantics.

-- Prisma cannot describe partial indexes, so this intentionally exists only
-- in migration SQL. It serves both public and admin product ordering while
-- excluding soft-deleted rows.
CREATE INDEX "products_live_sort_idx"
  ON "app"."products" ("position", "title", "id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX "orders_created_at_id_idx"
  ON "app"."orders" ("created_at" DESC, "id" DESC);

-- Prisma cannot describe partial indexes, so this intentionally exists only
-- in migration SQL. Keep the predicate synchronized with the fulfillment
-- queue query before changing either side.
CREATE INDEX "orders_fulfillment_queue_idx"
  ON "app"."orders" ("confirmed_at", "created_at", "id")
  WHERE
    "payment_status" = 'paid'
    AND "status" IN ('confirmed', 'processing')
    AND "fulfillment_status" IN ('unfulfilled', 'partial');

CREATE INDEX "shipments_created_at_id_idx"
  ON "app"."shipments" ("created_at" DESC, "id" DESC);

CREATE INDEX "inventory_movements_occurred_at_id_idx"
  ON "app"."inventory_movements" ("occurred_at" DESC, "id" DESC);
