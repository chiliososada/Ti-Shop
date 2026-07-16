-- CreateEnum
CREATE TYPE "procurement_order_status" AS ENUM ('draft', 'ordered', 'paid', 'received', 'canceled');

-- CreateEnum
CREATE TYPE "fx_rate_source" AS ENUM ('manual', 'api');

-- CreateEnum
CREATE TYPE "cost_method" AS ENUM ('moving_average', 'manual');

-- CreateEnum
CREATE TYPE "inventory_cost_entry_type" AS ENUM ('procurement_receipt', 'procurement_return', 'sale_consumption', 'return_restock', 'return_damaged', 'return_disposal', 'customer_compensation', 'warranty_replacement', 'goodwill_gift', 'write_off', 'manual_adjustment');

-- CreateEnum
CREATE TYPE "after_sales_status" AS ENUM ('draft', 'approved', 'completed', 'voided');

-- CreateEnum
CREATE TYPE "after_sales_responsibility" AS ENUM ('merchant', 'carrier', 'supplier', 'customer', 'other');

-- CreateEnum
CREATE TYPE "after_sales_item_kind" AS ENUM ('return', 'compensation');

-- CreateEnum
CREATE TYPE "return_disposition" AS ENUM ('resalable', 'damaged', 'lost', 'destroyed');

-- CreateEnum
CREATE TYPE "compensation_delivery" AS ENUM ('dedicated_shipment', 'next_order');

-- CreateEnum
CREATE TYPE "financial_adjustment_type" AS ENUM ('refund', 'shipping_refund', 'return_shipping', 'damaged_return', 'compensation_product', 'compensation_shipping', 'payment_fee', 'crypto_conversion_fee', 'exchange_gain', 'exchange_loss', 'manual_direct_cost', 'cost_correction', 'rounding_adjustment', 'partner_settlement_correction');

-- CreateEnum
CREATE TYPE "conversion_batch_kind" AS ENUM ('usd_to_crypto', 'direct_crypto');

-- CreateEnum
CREATE TYPE "conversion_batch_status" AS ENUM ('draft', 'completed', 'voided');

-- CreateEnum
CREATE TYPE "partner_settlement_status" AS ENUM ('draft', 'pending_confirmation', 'locked', 'paid', 'voided');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "inventory_movement_type" ADD VALUE 'customer_compensation';
ALTER TYPE "inventory_movement_type" ADD VALUE 'warranty_replacement';
ALTER TYPE "inventory_movement_type" ADD VALUE 'return_restock';
ALTER TYPE "inventory_movement_type" ADD VALUE 'return_damaged';
ALTER TYPE "inventory_movement_type" ADD VALUE 'return_disposal';
ALTER TYPE "inventory_movement_type" ADD VALUE 'goodwill_gift';

-- DropIndex
DROP INDEX "product_media_link_unique";

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "compensation_event_id" BIGINT,
ADD COLUMN     "cost_method" "cost_method",
ADD COLUMN     "cost_snapshot_at" TIMESTAMPTZ(3),
ADD COLUMN     "total_cogs_usd_minor" BIGINT,
ADD COLUMN     "unit_cost_usd_minor" BIGINT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "profit_settled_settlement_id" BIGINT;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "packaging_cost_minor" BIGINT;

-- CreateTable
CREATE TABLE "suppliers" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "contact_name" VARCHAR(160),
    "contact_details" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_orders" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "orderNumber" VARCHAR(60) NOT NULL,
    "supplier_id" BIGINT NOT NULL,
    "status" "procurement_order_status" NOT NULL DEFAULT 'draft',
    "currency" CHAR(3) NOT NULL DEFAULT 'CNY',
    "goods_minor" BIGINT NOT NULL DEFAULT 0,
    "domestic_shipping_minor" BIGINT NOT NULL DEFAULT 0,
    "international_shipping_minor" BIGINT NOT NULL DEFAULT 0,
    "customs_minor" BIGINT NOT NULL DEFAULT 0,
    "procurement_fee_minor" BIGINT NOT NULL DEFAULT 0,
    "packaging_minor" BIGINT NOT NULL DEFAULT 0,
    "other_cost_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "fx_rate_cny_per_usd" DECIMAL(18,8),
    "fx_rate_date" TIMESTAMPTZ(3),
    "fx_rate_source" "fx_rate_source",
    "fx_rate_note" VARCHAR(500),
    "total_usd_minor" BIGINT,
    "ordered_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "procurement_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_order_items" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "procurement_order_id" BIGINT NOT NULL,
    "variant_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "line_minor" BIGINT NOT NULL,
    "allocated_cost_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL,
    "total_usd_minor" BIGINT,
    "unit_cost_usd_minor" BIGINT,
    "received_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "procurement_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_states" (
    "id" BIGSERIAL NOT NULL,
    "variant_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "total_cost_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_cost_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_entries" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "variant_id" BIGINT NOT NULL,
    "entry_type" "inventory_cost_entry_type" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "cost_delta_usd_minor" BIGINT NOT NULL,
    "quantity_after" INTEGER NOT NULL,
    "total_cost_after_usd_minor" BIGINT NOT NULL,
    "reference_type" VARCHAR(80),
    "reference_id" VARCHAR(255),
    "idempotency_key" VARCHAR(200),
    "reason" TEXT,
    "created_by_user_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "after_sales_events" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "order_id" BIGINT NOT NULL,
    "status" "after_sales_status" NOT NULL DEFAULT 'draft',
    "responsibility" "after_sales_responsibility" NOT NULL DEFAULT 'merchant',
    "reason" TEXT NOT NULL,
    "refund_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "shipping_refund_minor" BIGINT NOT NULL DEFAULT 0,
    "return_shipping_cost_minor" BIGINT NOT NULL DEFAULT 0,
    "compensation_shipping_cost_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "evidence_notes" TEXT,
    "created_by_user_id" UUID,
    "approved_by_user_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "after_sales_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "after_sales_items" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "event_id" BIGINT NOT NULL,
    "kind" "after_sales_item_kind" NOT NULL,
    "order_item_id" BIGINT,
    "variant_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "disposition" "return_disposition",
    "restocked" BOOLEAN NOT NULL DEFAULT false,
    "compensation_delivery" "compensation_delivery",
    "applied_to_order_id" BIGINT,
    "unit_cost_usd_minor" BIGINT,
    "total_cost_usd_minor" BIGINT,
    "cost_snapshot_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "after_sales_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_adjustments" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "type" "financial_adjustment_type" NOT NULL,
    "order_id" BIGINT,
    "order_item_id" BIGINT,
    "payment_id" BIGINT,
    "shipment_id" BIGINT,
    "after_sales_event_id" BIGINT,
    "conversion_batch_id" BIGINT,
    "original_amount_minor" BIGINT NOT NULL,
    "original_currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "fx_rate" DECIMAL(18,8),
    "fx_rate_date" TIMESTAMPTZ(3),
    "fx_rate_source" "fx_rate_source",
    "signed_usd_minor" BIGINT NOT NULL,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "is_estimated" BOOLEAN NOT NULL DEFAULT false,
    "reverses_id" BIGINT,
    "settled_in_settlement_id" BIGINT,
    "created_by_user_id" UUID,
    "approved_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crypto_conversion_batches" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "batch_number" VARCHAR(60) NOT NULL,
    "kind" "conversion_batch_kind" NOT NULL,
    "status" "conversion_batch_status" NOT NULL DEFAULT 'draft',
    "target_asset" VARCHAR(20) NOT NULL,
    "total_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "fee_rate_bps" INTEGER NOT NULL,
    "estimated_fee_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "actual_fee_usd_minor" BIGINT,
    "chain_fee_usd_minor" BIGINT,
    "rate" DECIMAL(36,18),
    "rate_at" TIMESTAMPTZ(3),
    "rate_source" VARCHAR(160),
    "target_amount" DECIMAL(36,18),
    "received_amount" DECIMAL(36,18),
    "transaction_id" VARCHAR(255),
    "converted_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "created_by_user_id" UUID,
    "completed_by_user_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crypto_conversion_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crypto_conversion_entries" (
    "id" BIGSERIAL NOT NULL,
    "batch_id" BIGINT NOT NULL,
    "payment_id" BIGINT NOT NULL,
    "order_id" BIGINT NOT NULL,
    "usd_amount_minor" BIGINT NOT NULL,
    "allocated_fee_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "allocated_chain_fee_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "active_payment_key" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crypto_conversion_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "share_bps" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_settlements" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "settlement_number" VARCHAR(60) NOT NULL,
    "partner_id" BIGINT NOT NULL,
    "status" "partner_settlement_status" NOT NULL DEFAULT 'draft',
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "share_bps_snapshot" INTEGER NOT NULL,
    "calc_version" INTEGER NOT NULL,
    "revenue_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "cogs_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "shipping_cost_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "fees_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "after_sales_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "other_adjustments_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "profit_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "carryover_in_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "distributable_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "partner_share_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "owner_share_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "carryover_out_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "paid_usd_minor" BIGINT NOT NULL DEFAULT 0,
    "paid_at" TIMESTAMPTZ(3),
    "payment_method" VARCHAR(120),
    "payment_reference" VARCHAR(255),
    "notes" TEXT,
    "previous_settlement_id" BIGINT,
    "created_by_user_id" UUID,
    "confirmed_by_user_id" UUID,
    "paid_confirmed_by_user_id" UUID,
    "locked_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partner_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_public_id_key" ON "suppliers"("public_id");

-- CreateIndex
CREATE INDEX "suppliers_active_idx" ON "suppliers"("is_active", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_orders_public_id_key" ON "procurement_orders"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_orders_order_number_key" ON "procurement_orders"("orderNumber");

-- CreateIndex
CREATE INDEX "procurement_orders_supplier_status_idx" ON "procurement_orders"("supplier_id", "status");

-- CreateIndex
CREATE INDEX "procurement_orders_status_received_idx" ON "procurement_orders"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_order_items_public_id_key" ON "procurement_order_items"("public_id");

-- CreateIndex
CREATE INDEX "procurement_order_items_variant_idx" ON "procurement_order_items"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_order_items_order_variant_key" ON "procurement_order_items"("procurement_order_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_cost_states_variant_id_key" ON "inventory_cost_states"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_cost_entries_public_id_key" ON "inventory_cost_entries"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_cost_entries_idempotency_key_key" ON "inventory_cost_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "inventory_cost_entries_variant_time_idx" ON "inventory_cost_entries"("variant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_cost_entries_reference_idx" ON "inventory_cost_entries"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "after_sales_events_public_id_key" ON "after_sales_events"("public_id");

-- CreateIndex
CREATE INDEX "after_sales_events_order_status_idx" ON "after_sales_events"("order_id", "status");

-- CreateIndex
CREATE INDEX "after_sales_events_status_created_idx" ON "after_sales_events"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "after_sales_items_public_id_key" ON "after_sales_items"("public_id");

-- CreateIndex
CREATE INDEX "after_sales_items_event_idx" ON "after_sales_items"("event_id");

-- CreateIndex
CREATE INDEX "after_sales_items_variant_idx" ON "after_sales_items"("variant_id");

-- CreateIndex
CREATE INDEX "after_sales_items_applied_order_idx" ON "after_sales_items"("applied_to_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_adjustments_public_id_key" ON "financial_adjustments"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_adjustments_reverses_id_key" ON "financial_adjustments"("reverses_id");

-- CreateIndex
CREATE INDEX "financial_adjustments_order_time_idx" ON "financial_adjustments"("order_id", "effective_at");

-- CreateIndex
CREATE INDEX "financial_adjustments_type_time_idx" ON "financial_adjustments"("type", "effective_at");

-- CreateIndex
CREATE INDEX "financial_adjustments_settlement_idx" ON "financial_adjustments"("settled_in_settlement_id");

-- CreateIndex
CREATE INDEX "financial_adjustments_after_sales_idx" ON "financial_adjustments"("after_sales_event_id");

-- CreateIndex
CREATE INDEX "financial_adjustments_batch_idx" ON "financial_adjustments"("conversion_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_conversion_batches_public_id_key" ON "crypto_conversion_batches"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_conversion_batches_number_key" ON "crypto_conversion_batches"("batch_number");

-- CreateIndex
CREATE INDEX "crypto_conversion_batches_status_idx" ON "crypto_conversion_batches"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_conversion_entries_active_payment_key" ON "crypto_conversion_entries"("active_payment_key");

-- CreateIndex
CREATE INDEX "crypto_conversion_entries_order_idx" ON "crypto_conversion_entries"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_conversion_entries_batch_payment_key" ON "crypto_conversion_entries"("batch_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "partners_public_id_key" ON "partners"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlements_public_id_key" ON "partner_settlements"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlements_number_key" ON "partner_settlements"("settlement_number");

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlements_previous_id_key" ON "partner_settlements"("previous_settlement_id");

-- CreateIndex
CREATE INDEX "partner_settlements_partner_period_idx" ON "partner_settlements"("partner_id", "period_start");

-- CreateIndex
CREATE INDEX "partner_settlements_status_idx" ON "partner_settlements"("status");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_orders" ADD CONSTRAINT "procurement_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_orders" ADD CONSTRAINT "procurement_orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_orders" ADD CONSTRAINT "procurement_orders_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_order_items" ADD CONSTRAINT "procurement_order_items_order_id_fkey" FOREIGN KEY ("procurement_order_id") REFERENCES "procurement_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_order_items" ADD CONSTRAINT "procurement_order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_states" ADD CONSTRAINT "inventory_cost_states_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_entries" ADD CONSTRAINT "inventory_cost_entries_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_entries" ADD CONSTRAINT "inventory_cost_entries_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_events" ADD CONSTRAINT "after_sales_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_events" ADD CONSTRAINT "after_sales_events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_events" ADD CONSTRAINT "after_sales_events_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_items" ADD CONSTRAINT "after_sales_items_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "after_sales_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_items" ADD CONSTRAINT "after_sales_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_items" ADD CONSTRAINT "after_sales_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_items" ADD CONSTRAINT "after_sales_items_applied_to_order_id_fkey" FOREIGN KEY ("applied_to_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_after_sales_event_id_fkey" FOREIGN KEY ("after_sales_event_id") REFERENCES "after_sales_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_conversion_batch_id_fkey" FOREIGN KEY ("conversion_batch_id") REFERENCES "crypto_conversion_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "financial_adjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_settled_in_settlement_id_fkey" FOREIGN KEY ("settled_in_settlement_id") REFERENCES "partner_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_conversion_batches" ADD CONSTRAINT "crypto_conversion_batches_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_conversion_batches" ADD CONSTRAINT "crypto_conversion_batches_completed_by_user_id_fkey" FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_conversion_entries" ADD CONSTRAINT "crypto_conversion_entries_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "crypto_conversion_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_conversion_entries" ADD CONSTRAINT "crypto_conversion_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_conversion_entries" ADD CONSTRAINT "crypto_conversion_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_previous_id_fkey" FOREIGN KEY ("previous_settlement_id") REFERENCES "partner_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_paid_confirmed_by_user_id_fkey" FOREIGN KEY ("paid_confirmed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_profit_settled_settlement_id_fkey" FOREIGN KEY ("profit_settled_settlement_id") REFERENCES "partner_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_compensation_event_id_fkey" FOREIGN KEY ("compensation_event_id") REFERENCES "after_sales_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data-integrity checks the application also enforces; the database is the
-- last line of defense against invalid financial rows.
ALTER TABLE "partners"
  ADD CONSTRAINT "partners_share_bps_range_check"
  CHECK ("share_bps" >= 0 AND "share_bps" <= 10000);

-- Direct crypto receipts must never carry the USD-to-crypto conversion fee.
ALTER TABLE "crypto_conversion_batches"
  ADD CONSTRAINT "crypto_conversion_batches_direct_zero_fee_check"
  CHECK (
    "kind" <> 'direct_crypto'
    OR ("fee_rate_bps" = 0 AND "estimated_fee_usd_minor" = 0)
  );

ALTER TABLE "crypto_conversion_batches"
  ADD CONSTRAINT "crypto_conversion_batches_fee_rate_range_check"
  CHECK ("fee_rate_bps" >= 0 AND "fee_rate_bps" <= 10000);

ALTER TABLE "crypto_conversion_batches"
  ADD CONSTRAINT "crypto_conversion_batches_amounts_check"
  CHECK (
    "total_usd_minor" >= 0
    AND "estimated_fee_usd_minor" >= 0
    AND ("actual_fee_usd_minor" IS NULL OR "actual_fee_usd_minor" >= 0)
    AND ("chain_fee_usd_minor" IS NULL OR "chain_fee_usd_minor" >= 0)
  );

ALTER TABLE "crypto_conversion_entries"
  ADD CONSTRAINT "crypto_conversion_entries_amounts_check"
  CHECK (
    "usd_amount_minor" >= 0
    AND "allocated_fee_usd_minor" >= 0
    AND "allocated_chain_fee_usd_minor" >= 0
  );

ALTER TABLE "procurement_orders"
  ADD CONSTRAINT "procurement_orders_amounts_check"
  CHECK (
    "goods_minor" >= 0 AND "domestic_shipping_minor" >= 0
    AND "international_shipping_minor" >= 0 AND "customs_minor" >= 0
    AND "procurement_fee_minor" >= 0 AND "packaging_minor" >= 0
    AND "other_cost_minor" >= 0 AND "total_minor" >= 0
    AND ("total_usd_minor" IS NULL OR "total_usd_minor" >= 0)
    AND ("fx_rate_cny_per_usd" IS NULL OR "fx_rate_cny_per_usd" > 0)
  );

ALTER TABLE "procurement_order_items"
  ADD CONSTRAINT "procurement_order_items_amounts_check"
  CHECK (
    "quantity" > 0 AND "received_quantity" >= 0
    AND "unit_price_minor" >= 0 AND "line_minor" >= 0
    AND "allocated_cost_minor" >= 0 AND "total_minor" >= 0
  );

ALTER TABLE "inventory_cost_states"
  ADD CONSTRAINT "inventory_cost_states_non_negative_check"
  CHECK ("quantity" >= 0 AND "total_cost_usd_minor" >= 0);

ALTER TABLE "after_sales_events"
  ADD CONSTRAINT "after_sales_events_amounts_check"
  CHECK (
    "refund_amount_minor" >= 0 AND "shipping_refund_minor" >= 0
    AND "return_shipping_cost_minor" >= 0
    AND "compensation_shipping_cost_minor" >= 0
  );

ALTER TABLE "after_sales_items"
  ADD CONSTRAINT "after_sales_items_quantity_check"
  CHECK ("quantity" > 0);

ALTER TABLE "partner_settlements"
  ADD CONSTRAINT "partner_settlements_non_negative_check"
  CHECK (
    "partner_share_usd_minor" >= 0 AND "paid_usd_minor" >= 0
    AND "period_end" > "period_start"
    AND "share_bps_snapshot" >= 0 AND "share_bps_snapshot" <= 10000
  );

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_cost_snapshot_check"
  CHECK (
    ("unit_cost_usd_minor" IS NULL OR "unit_cost_usd_minor" >= 0)
    AND ("total_cogs_usd_minor" IS NULL OR "total_cogs_usd_minor" >= 0)
  );

UPDATE "app"."application_schema_metadata"
SET
  "version" = '20260714155705_finance_foundation',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'application';
