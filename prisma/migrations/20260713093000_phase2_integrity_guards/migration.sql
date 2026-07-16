-- Fail closed for newly-created variants: an explicit price must be attached
-- before a variant is switched from quote-only to fixed-price sale.
ALTER TYPE "app"."payment_status" ADD VALUE 'processing' AFTER 'awaiting_confirmation';
ALTER TYPE "app"."payment_status" ADD VALUE 'partially_paid' AFTER 'processing';
ALTER TYPE "app"."payment_status" ADD VALUE 'overpaid' AFTER 'partially_paid';
ALTER TYPE "app"."payment_status" ADD VALUE 'review_required' AFTER 'overpaid';

ALTER TABLE "app"."product_variants"
  ALTER COLUMN "price_mode" SET DEFAULT 'on_request';

ALTER TABLE "app"."payments"
  ADD COLUMN "idempotency_key" VARCHAR(160),
  ADD COLUMN "actually_paid" DECIMAL(36, 18),
  ADD COLUMN "outcome_amount" DECIMAL(36, 18),
  ADD COLUMN "outcome_currency" VARCHAR(20),
  ADD COLUMN "provider_invoice_id" VARCHAR(255),
  ADD COLUMN "provider_purchase_id" VARCHAR(255),
  ADD COLUMN "parent_provider_payment_id" VARCHAR(255),
  ADD COLUMN "pay_address" TEXT,
  ADD COLUMN "pay_extra_id" TEXT;

ALTER TABLE "app"."inventory_movements"
  ADD COLUMN "idempotency_key" VARCHAR(160);

CREATE UNIQUE INDEX "payments_idempotency_key_key"
  ON "app"."payments" ("idempotency_key");

CREATE UNIQUE INDEX "payments_provider_invoice_id_key"
  ON "app"."payments" ("provider_invoice_id");

CREATE INDEX "payments_provider_purchase_id_idx"
  ON "app"."payments" ("provider_purchase_id");

CREATE INDEX "payments_parent_provider_payment_id_idx"
  ON "app"."payments" ("parent_provider_payment_id");

CREATE UNIQUE INDEX "inventory_movements_idempotency_key_key"
  ON "app"."inventory_movements" ("idempotency_key");

DROP INDEX "app"."payment_events_provider_event_key";

CREATE UNIQUE INDEX "payment_events_provider_event_id_key"
  ON "app"."payment_events" ("provider_event_id");

CREATE UNIQUE INDEX "merchandising_placements_key_position_key"
  ON "app"."merchandising_placements" ("key", "position");

CREATE UNIQUE INDEX "prices_one_active_unbounded_key"
  ON "app"."prices" (
    "variant_id",
    "currency",
    "kind",
    COALESCE("country_code", '')
  )
  WHERE
    "is_active" = true
    AND "deleted_at" IS NULL
    AND "starts_at" IS NULL
    AND "ends_at" IS NULL;

CREATE UNIQUE INDEX "addresses_one_default_shipping_per_user_key"
  ON "app"."addresses" ("user_id")
  WHERE "is_default_shipping" = true AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "addresses_one_default_billing_per_user_key"
  ON "app"."addresses" ("user_id")
  WHERE "is_default_billing" = true AND "deleted_at" IS NULL;

ALTER TABLE "app"."inventory_reservations"
  DROP CONSTRAINT "inventory_reservations_cart_item_id_fkey",
  DROP CONSTRAINT "inventory_reservations_order_item_id_fkey";

ALTER TABLE "app"."inventory_reservations"
  ADD CONSTRAINT "inventory_reservations_cart_item_id_fkey"
    FOREIGN KEY ("cart_item_id") REFERENCES "app"."cart_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_reservations_order_item_id_fkey"
    FOREIGN KEY ("order_item_id") REFERENCES "app"."order_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "app"."inventory_levels"
  ADD CONSTRAINT "inventory_levels_capacity_check" CHECK (
    "allow_backorder" = true OR "reserved_quantity" <= "on_hand_quantity"
  );

ALTER TABLE "app"."carts"
  ADD CONSTRAINT "carts_owner_check" CHECK (
    NUM_NONNULLS("user_id", "anonymous_token_hash") >= 1
  );

ALTER TABLE "app"."categories"
  ADD CONSTRAINT "categories_not_self_parent_check" CHECK (
    "parent_id" IS NULL OR "parent_id" <> "id"
  );

ALTER TABLE "app"."orders"
  ADD CONSTRAINT "orders_status_timestamps_check" CHECK (
    ("status" NOT IN ('confirmed', 'processing', 'completed') OR "confirmed_at" IS NOT NULL)
    AND ("status" <> 'completed' OR "completed_at" IS NOT NULL)
    AND ("status" <> 'canceled' OR "canceled_at" IS NOT NULL)
  );

ALTER TABLE "app"."payments"
  ADD CONSTRAINT "payments_provider_amounts_check" CHECK (
    ("actually_paid" IS NULL OR "actually_paid" >= 0)
    AND ("outcome_amount" IS NULL OR "outcome_amount" >= 0)
  ),
  ADD CONSTRAINT "payments_status_timestamps_check" CHECK (
    ("status" <> 'confirmed' OR "confirmed_at" IS NOT NULL)
    AND ("status" <> 'failed' OR "failed_at" IS NOT NULL)
    AND ("status" <> 'canceled' OR "canceled_at" IS NOT NULL)
    AND ("status" <> 'expired' OR "expires_at" IS NOT NULL)
  );

ALTER TABLE "app"."shipments"
  ADD CONSTRAINT "shipments_status_timestamps_check" CHECK (
    ("status" NOT IN ('in_transit', 'delivered', 'returned') OR "shipped_at" IS NOT NULL)
    AND ("status" <> 'delivered' OR "delivered_at" IS NOT NULL)
    AND ("status" <> 'canceled' OR "canceled_at" IS NOT NULL)
  );

ALTER TABLE "app"."inventory_reservations"
  ADD CONSTRAINT "inventory_reservations_status_timestamps_check" CHECK (
    ("status" <> 'released' OR "released_at" IS NOT NULL)
    AND ("status" <> 'consumed' OR "consumed_at" IS NOT NULL)
    AND ("status" <> 'expired' OR "expires_at" IS NOT NULL)
  );

CREATE FUNCTION "app"."enforce_category_tree"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    WITH RECURSIVE ancestors(id, parent_id) AS (
      SELECT c.id, c.parent_id
      FROM app.categories AS c
      WHERE c.id = NEW.parent_id
      UNION
      SELECT c.id, c.parent_id
      FROM app.categories AS c
      JOIN ancestors AS a ON c.id = a.parent_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Category hierarchy cannot contain a cycle.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "categories_tree_guard"
BEFORE INSERT OR UPDATE OF "id", "parent_id"
ON "app"."categories"
FOR EACH ROW EXECUTE FUNCTION "app"."enforce_category_tree"();

CREATE FUNCTION "app"."enforce_navigation_item_tree"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  parent_navigation_id BIGINT;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ni.navigation_id
  INTO parent_navigation_id
  FROM app.navigation_items AS ni
  WHERE ni.id = NEW.parent_id;

  IF parent_navigation_id IS DISTINCT FROM NEW.navigation_id THEN
    RAISE EXCEPTION 'Navigation parent and child must belong to the same navigation.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH RECURSIVE ancestors(id, parent_id) AS (
      SELECT ni.id, ni.parent_id
      FROM app.navigation_items AS ni
      WHERE ni.id = NEW.parent_id
      UNION
      SELECT ni.id, ni.parent_id
      FROM app.navigation_items AS ni
      JOIN ancestors AS a ON ni.id = a.parent_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Navigation hierarchy cannot contain a cycle.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "navigation_items_tree_guard"
BEFORE INSERT OR UPDATE OF "id", "navigation_id", "parent_id"
ON "app"."navigation_items"
FOR EACH ROW EXECUTE FUNCTION "app"."enforce_navigation_item_tree"();

CREATE FUNCTION "app"."enforce_product_media_variant"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  variant_product_id BIGINT;
BEGIN
  IF NEW.variant_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pv.product_id
  INTO variant_product_id
  FROM app.product_variants AS pv
  WHERE pv.id = NEW.variant_id;

  IF variant_product_id IS DISTINCT FROM NEW.product_id THEN
    RAISE EXCEPTION 'Product media variant must belong to the same product.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "product_media_variant_guard"
BEFORE INSERT OR UPDATE OF "product_id", "variant_id"
ON "app"."product_media"
FOR EACH ROW EXECUTE FUNCTION "app"."enforce_product_media_variant"();

CREATE FUNCTION "app"."enforce_inventory_reservation_variant"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  level_variant_id BIGINT;
  source_variant_id BIGINT;
BEGIN
  SELECT il.variant_id
  INTO level_variant_id
  FROM app.inventory_levels AS il
  WHERE il.id = NEW.inventory_level_id
  FOR UPDATE;

  IF NEW.cart_item_id IS NOT NULL THEN
    SELECT ci.variant_id INTO source_variant_id
    FROM app.cart_items AS ci
    WHERE ci.id = NEW.cart_item_id;
  ELSE
    SELECT oi.variant_id INTO source_variant_id
    FROM app.order_items AS oi
    WHERE oi.id = NEW.order_item_id;
  END IF;

  IF level_variant_id IS DISTINCT FROM source_variant_id THEN
    RAISE EXCEPTION 'Inventory reservation source must match the inventory variant.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "inventory_reservations_variant_guard"
BEFORE INSERT OR UPDATE OF "inventory_level_id", "cart_item_id", "order_item_id"
ON "app"."inventory_reservations"
FOR EACH ROW EXECUTE FUNCTION "app"."enforce_inventory_reservation_variant"();

CREATE FUNCTION "app"."enforce_inventory_reserved_total"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  target_level_id BIGINT;
  stored_reserved INTEGER;
  active_reserved BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'inventory_levels' THEN
    target_level_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target_level_id := OLD.inventory_level_id;
  ELSE
    target_level_id := NEW.inventory_level_id;
  END IF;

  SELECT il.reserved_quantity
  INTO stored_reserved
  FROM app.inventory_levels AS il
  WHERE il.id = target_level_id;

  SELECT COALESCE(SUM(ir.quantity), 0)
  INTO active_reserved
  FROM app.inventory_reservations AS ir
  WHERE ir.inventory_level_id = target_level_id
    AND ir.status = 'active';

  IF stored_reserved IS DISTINCT FROM active_reserved THEN
    RAISE EXCEPTION 'Inventory reserved quantity must equal active reservations.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "inventory_levels_reserved_total_guard"
AFTER INSERT OR UPDATE OF "reserved_quantity"
ON "app"."inventory_levels"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "app"."enforce_inventory_reserved_total"();

CREATE CONSTRAINT TRIGGER "inventory_reservations_total_guard"
AFTER INSERT OR UPDATE OR DELETE
ON "app"."inventory_reservations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "app"."enforce_inventory_reserved_total"();

CREATE FUNCTION "app"."enforce_order_item_relations"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  variant_product_id BIGINT;
  order_currency CHAR(3);
BEGIN
  SELECT o.currency INTO order_currency
  FROM app.orders AS o
  WHERE o.id = NEW.order_id;

  IF order_currency IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION 'Order item currency must match order currency.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.variant_id IS NOT NULL AND NEW.product_id IS NOT NULL THEN
    SELECT pv.product_id INTO variant_product_id
    FROM app.product_variants AS pv
    WHERE pv.id = NEW.variant_id;

    IF variant_product_id IS DISTINCT FROM NEW.product_id THEN
      RAISE EXCEPTION 'Order item variant must belong to its product.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "order_items_relations_guard"
BEFORE INSERT OR UPDATE OF "order_id", "product_id", "variant_id", "currency"
ON "app"."order_items"
FOR EACH ROW EXECUTE FUNCTION "app"."enforce_order_item_relations"();

CREATE FUNCTION "app"."enforce_order_totals"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  target_order_id BIGINT;
  order_row app.orders%ROWTYPE;
  base_total BIGINT;
  line_discounts BIGINT;
  line_taxes BIGINT;
  lines_total BIGINT;
  mismatched_currency BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    target_order_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target_order_id := OLD.order_id;
  ELSE
    target_order_id := NEW.order_id;
  END IF;

  SELECT * INTO order_row
  FROM app.orders AS o
  WHERE o.id = target_order_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(SUM(oi.unit_price_minor * oi.quantity), 0),
    COALESCE(SUM(oi.discount_minor), 0),
    COALESCE(SUM(oi.tax_minor), 0),
    COALESCE(SUM(oi.line_total_minor), 0),
    COALESCE(BOOL_OR(oi.currency <> order_row.currency), false)
  INTO base_total, line_discounts, line_taxes, lines_total, mismatched_currency
  FROM app.order_items AS oi
  WHERE oi.order_id = target_order_id;

  IF mismatched_currency
    OR base_total <> order_row.subtotal_minor
    OR line_discounts <> order_row.discount_minor
    OR line_taxes <> order_row.tax_minor
    OR lines_total + order_row.shipping_minor <> order_row.total_minor
  THEN
    RAISE EXCEPTION 'Order totals and currency must match the order item snapshots.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "orders_totals_guard"
AFTER INSERT OR UPDATE OF
  "currency", "subtotal_minor", "discount_minor", "shipping_minor", "tax_minor", "total_minor"
ON "app"."orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "app"."enforce_order_totals"();

CREATE CONSTRAINT TRIGGER "order_items_totals_guard"
AFTER INSERT OR UPDATE OR DELETE
ON "app"."order_items"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "app"."enforce_order_totals"();

CREATE FUNCTION "app"."enforce_payment_currency"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  order_currency CHAR(3);
BEGIN
  SELECT o.currency INTO order_currency
  FROM app.orders AS o
  WHERE o.id = NEW.order_id;

  IF order_currency IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION 'Payment currency must match order currency.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "payments_currency_guard"
BEFORE INSERT OR UPDATE OF "order_id", "currency"
ON "app"."payments"
FOR EACH ROW EXECUTE FUNCTION "app"."enforce_payment_currency"();

CREATE FUNCTION "app"."enforce_manual_proof_currency"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  payment_currency CHAR(3);
BEGIN
  SELECT p.currency INTO payment_currency
  FROM app.payments AS p
  WHERE p.id = NEW.payment_id;

  IF payment_currency IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION 'Manual payment proof currency must match payment currency.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "manual_payment_proofs_currency_guard"
BEFORE INSERT OR UPDATE OF "payment_id", "currency"
ON "app"."manual_payment_proofs"
FOR EACH ROW EXECUTE FUNCTION "app"."enforce_manual_proof_currency"();

CREATE FUNCTION "app"."enforce_shipment_item"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  shipment_order_id BIGINT;
  item_order_id BIGINT;
  ordered_quantity INTEGER;
  other_quantity BIGINT;
BEGIN
  SELECT s.order_id INTO shipment_order_id
  FROM app.shipments AS s
  WHERE s.id = NEW.shipment_id;

  SELECT oi.order_id, oi.quantity
  INTO item_order_id, ordered_quantity
  FROM app.order_items AS oi
  WHERE oi.id = NEW.order_item_id
  FOR UPDATE;

  IF shipment_order_id IS DISTINCT FROM item_order_id THEN
    RAISE EXCEPTION 'Shipment item must belong to the shipment order.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(SUM(si.quantity), 0)
    INTO other_quantity
    FROM app.shipment_items AS si
    WHERE si.order_item_id = NEW.order_item_id
      AND NOT (
        si.shipment_id = OLD.shipment_id
        AND si.order_item_id = OLD.order_item_id
      );
  ELSE
    SELECT COALESCE(SUM(si.quantity), 0)
    INTO other_quantity
    FROM app.shipment_items AS si
    WHERE si.order_item_id = NEW.order_item_id;
  END IF;

  IF NEW.quantity <= 0 OR other_quantity + NEW.quantity > ordered_quantity THEN
    RAISE EXCEPTION 'Cumulative shipment quantity cannot exceed ordered quantity.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "shipment_items_order_quantity_guard"
BEFORE INSERT OR UPDATE OF "shipment_id", "order_item_id", "quantity"
ON "app"."shipment_items"
FOR EACH ROW EXECUTE FUNCTION "app"."enforce_shipment_item"();

CREATE FUNCTION "app"."reject_overlapping_price_windows"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF NEW.is_active = false OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      NEW.variant_id::text || ':' || NEW.currency || ':' || NEW.kind::text || ':' || COALESCE(NEW.country_code, ''),
      0
    )
  );

  IF EXISTS (
    SELECT 1
    FROM app.prices AS p
    WHERE p.id <> NEW.id
      AND p.variant_id = NEW.variant_id
      AND p.currency = NEW.currency
      AND p.kind = NEW.kind
      AND p.country_code IS NOT DISTINCT FROM NEW.country_code
      AND p.is_active = true
      AND p.deleted_at IS NULL
      AND tstzrange(
        COALESCE(p.starts_at, '-infinity'::timestamptz),
        COALESCE(p.ends_at, 'infinity'::timestamptz),
        '[)'
      ) && tstzrange(
        COALESCE(NEW.starts_at, '-infinity'::timestamptz),
        COALESCE(NEW.ends_at, 'infinity'::timestamptz),
        '[)'
      )
  ) THEN
    RAISE EXCEPTION 'Active price windows for the same market and kind cannot overlap.'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "prices_overlap_guard"
BEFORE INSERT OR UPDATE OF
  "variant_id", "currency", "kind", "country_code", "is_active", "starts_at", "ends_at", "deleted_at"
ON "app"."prices"
FOR EACH ROW EXECUTE FUNCTION "app"."reject_overlapping_price_windows"();
