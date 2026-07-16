import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import type {
  ProcurementFormInput,
  ProcurementFxFormInput,
  ProcurementItemFormInput,
  ProcurementReceiveFormInput,
  SupplierFormInput,
} from "@/server/admin/finance/procurement/validators";
import { parseOptionalInstant } from "@/server/admin/finance/procurement/validators";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { applyCostReceipt } from "@/server/finance/inventory-costing";
import { cnyMinorToUsdMinor, validateFxRate } from "@/server/finance/math/fx";
import {
  allocateProportionally,
  divideRoundHalfUp,
  sumSignedMinor,
} from "@/server/finance/math/rounding";
import { withSerializableRetry } from "@/server/orders/retry";

const RETURN_TO = "/admin/finance/procurement";

type MutationResult =
  | { ok: true; publicId: string }
  | { ok: false; reason: string; message: string };

function transactionOptions() {
  return {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 20_000,
  } as const;
}

function failure(reason: string, message: string): MutationResult {
  return { ok: false, reason, message };
}

function createProcurementNumber(now: Date) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const entropy = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return `PO-${date}-${entropy}`;
}

const procurementAuditSelect = {
  publicId: true,
  orderNumber: true,
  status: true,
  goodsMinor: true,
  domesticShippingMinor: true,
  internationalShippingMinor: true,
  customsMinor: true,
  procurementFeeMinor: true,
  packagingMinor: true,
  otherCostMinor: true,
  totalMinor: true,
  fxRateCnyPerUsd: true,
  fxRateDate: true,
  fxRateSource: true,
  fxRateNote: true,
  totalUsdMinor: true,
  orderedAt: true,
  paidAt: true,
  receivedAt: true,
  notes: true,
} satisfies Prisma.ProcurementOrderSelect;

async function writeFinanceOutbox(
  tx: Prisma.TransactionClient,
  input: { aggregateId: string; eventType: string; payload: Prisma.InputJsonObject },
) {
  await tx.outboxEvent.create({
    data: {
      aggregateType: "finance",
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload,
    },
    select: { id: true },
  });
}

/** Recomputes goods/extra/total CNY sums from lines and persists them. */
async function recomputeProcurementTotals(
  tx: Prisma.TransactionClient,
  procurementId: bigint,
) {
  const order = await tx.procurementOrder.findUniqueOrThrow({
    where: { id: procurementId },
    select: {
      domesticShippingMinor: true,
      internationalShippingMinor: true,
      customsMinor: true,
      procurementFeeMinor: true,
      packagingMinor: true,
      otherCostMinor: true,
      items: { select: { lineMinor: true } },
    },
  });
  const goodsMinor = sumSignedMinor(order.items.map((item) => item.lineMinor));
  const totalMinor =
    goodsMinor +
    order.domesticShippingMinor +
    order.internationalShippingMinor +
    order.customsMinor +
    order.procurementFeeMinor +
    order.packagingMinor +
    order.otherCostMinor;
  await tx.procurementOrder.update({
    where: { id: procurementId },
    data: { goodsMinor, totalMinor },
    select: { id: true },
  });
}

export async function upsertSupplier(input: SupplierFormInput): Promise<MutationResult> {
  const authorization = await requirePermission("finance.procurement.manage", RETURN_TO);
  const actorUserId = authorization.session.user.id;
  const data = {
    name: input.name,
    contactName: input.contactName || null,
    contactDetails: input.contactDetails || null,
    notes: input.notes || null,
    isActive: input.isActive === "true",
  };

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      if (input.publicId) {
        const before = await tx.supplier.findFirst({
          where: { publicId: input.publicId, deletedAt: null },
          select: { id: true, name: true, contactName: true, contactDetails: true, notes: true, isActive: true },
        });
        if (!before) return failure("not_found", "Supplier not found.");
        const after = await tx.supplier.update({
          where: { id: before.id },
          data,
          select: { publicId: true, name: true, contactName: true, contactDetails: true, notes: true, isActive: true },
        });
        await writeAdminAuditLog(tx, {
          actorUserId,
          action: "finance.supplier.update",
          resourceType: "supplier",
          resourceId: after.publicId,
          before,
          after,
        });
        return { ok: true as const, publicId: after.publicId };
      }
      const created = await tx.supplier.create({
        data: { ...data, createdByUserId: actorUserId },
        select: { publicId: true, name: true },
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.supplier.create",
        resourceType: "supplier",
        resourceId: created.publicId,
        before: { exists: false },
        after: created,
      });
      return { ok: true as const, publicId: created.publicId };
    }, transactionOptions()),
  );
}

export async function upsertProcurementOrder(
  input: ProcurementFormInput,
): Promise<MutationResult> {
  const authorization = await requirePermission("finance.procurement.manage", RETURN_TO);
  const actorUserId = authorization.session.user.id;

  let orderedAt: Date | null;
  let paidAt: Date | null;
  try {
    orderedAt = parseOptionalInstant(input.orderedAt, "Ordered time");
    paidAt = parseOptionalInstant(input.paidAt, "Paid time");
  } catch (error) {
    return failure("invalid_dates", error instanceof Error ? error.message : "Invalid date.");
  }

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { publicId: input.supplierPublicId, deletedAt: null },
        select: { id: true },
      });
      if (!supplier) return failure("supplier_not_found", "Supplier not found.");

      const data = {
        supplierId: supplier.id,
        status: input.status,
        domesticShippingMinor: input.domesticShipping,
        internationalShippingMinor: input.internationalShipping,
        customsMinor: input.customs,
        procurementFeeMinor: input.procurementFee,
        packagingMinor: input.packaging,
        otherCostMinor: input.otherCost,
        orderedAt,
        paidAt,
        notes: input.notes || null,
        updatedByUserId: actorUserId,
      };

      if (input.publicId) {
        const before = await tx.procurementOrder.findFirst({
          where: { publicId: input.publicId },
          select: { id: true, ...procurementAuditSelect },
        });
        if (!before) return failure("not_found", "Purchase order not found.");
        if (before.status === "RECEIVED" || before.status === "CANCELED") {
          return failure(
            "immutable_status",
            "Received or canceled purchase orders cannot be edited; use a cost correction instead.",
          );
        }
        const after = await tx.procurementOrder.update({
          where: { id: before.id },
          data,
          select: procurementAuditSelect,
        });
        await recomputeProcurementTotals(tx, before.id);
        await writeAdminAuditLog(tx, {
          actorUserId,
          action: "finance.procurement.update",
          resourceType: "procurement_order",
          resourceId: after.publicId,
          before,
          after,
        });
        return { ok: true as const, publicId: after.publicId };
      }

      const created = await tx.procurementOrder.create({
        data: {
          ...data,
          orderNumber: createProcurementNumber(new Date()),
          createdByUserId: actorUserId,
        },
        select: procurementAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.procurement.create",
        resourceType: "procurement_order",
        resourceId: created.publicId,
        before: { exists: false },
        after: created,
      });
      return { ok: true as const, publicId: created.publicId };
    }, transactionOptions()),
  );
}

export async function upsertProcurementItem(
  input: ProcurementItemFormInput,
): Promise<MutationResult> {
  const authorization = await requirePermission("finance.procurement.manage", RETURN_TO);
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const order = await tx.procurementOrder.findFirst({
        where: { publicId: input.procurementPublicId },
        select: { id: true, publicId: true, status: true },
      });
      if (!order) return failure("not_found", "Purchase order not found.");
      if (order.status === "RECEIVED" || order.status === "CANCELED") {
        return failure("immutable_status", "Received or canceled purchase orders cannot change lines.");
      }

      if (input.remove === "true") {
        if (!input.itemPublicId) return failure("invalid", "Missing line id.");
        const line = await tx.procurementOrderItem.findFirst({
          where: { publicId: input.itemPublicId, procurementOrderId: order.id },
          select: { id: true, publicId: true, variantId: true, quantity: true, unitPriceMinor: true },
        });
        if (!line) return failure("not_found", "Purchase line not found.");
        await tx.procurementOrderItem.delete({ where: { id: line.id }, select: { id: true } });
        await recomputeProcurementTotals(tx, order.id);
        await writeAdminAuditLog(tx, {
          actorUserId,
          action: "finance.procurement.item.remove",
          resourceType: "procurement_order",
          resourceId: order.publicId,
          before: line,
          after: { removed: true },
        });
        return { ok: true as const, publicId: order.publicId };
      }

      if (!input.variantPublicId || input.quantity === undefined || input.unitPriceCny === undefined) {
        return failure("invalid", "Variant, quantity, and CNY unit price are required.");
      }
      const variant = await tx.productVariant.findFirst({
        where: { publicId: input.variantPublicId, deletedAt: null },
        select: { id: true },
      });
      if (!variant) return failure("variant_not_found", "Variant not found.");

      const lineMinor = input.unitPriceCny * BigInt(input.quantity);
      const values = {
        quantity: input.quantity,
        unitPriceMinor: input.unitPriceCny,
        lineMinor,
        // Before receipt no extra costs are allocated; the line total equals
        // the goods value and is finalized at receiving time.
        totalMinor: lineMinor,
      };

      const before = await tx.procurementOrderItem.findFirst({
        where: { procurementOrderId: order.id, variantId: variant.id },
        select: { id: true, publicId: true, quantity: true, unitPriceMinor: true, lineMinor: true },
      });
      const after = before
        ? await tx.procurementOrderItem.update({
            where: { id: before.id },
            data: values,
            select: { publicId: true, quantity: true, unitPriceMinor: true, lineMinor: true },
          })
        : await tx.procurementOrderItem.create({
            data: {
              ...values,
              totalMinor: lineMinor,
              procurementOrderId: order.id,
              variantId: variant.id,
            },
            select: { publicId: true, quantity: true, unitPriceMinor: true, lineMinor: true },
          });
      await recomputeProcurementTotals(tx, order.id);
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: before ? "finance.procurement.item.update" : "finance.procurement.item.add",
        resourceType: "procurement_order",
        resourceId: order.publicId,
        before: before ?? { exists: false },
        after,
      });
      return { ok: true as const, publicId: order.publicId };
    }, transactionOptions()),
  );
}

export async function setProcurementFxRate(
  input: ProcurementFxFormInput,
): Promise<MutationResult> {
  const authorization = await requirePermission("finance.procurement.manage", RETURN_TO);
  const actorUserId = authorization.session.user.id;

  let rate: string;
  try {
    rate = validateFxRate(input.fxRate);
  } catch (error) {
    return failure("invalid_rate", error instanceof Error ? error.message : "Invalid rate.");
  }
  let fxRateDate: Date | null;
  try {
    fxRateDate = parseOptionalInstant(input.fxRateDate, "Rate time");
  } catch (error) {
    return failure("invalid_dates", error instanceof Error ? error.message : "Invalid date.");
  }

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const order = await tx.procurementOrder.findFirst({
        where: { publicId: input.procurementPublicId },
        select: {
          id: true,
          publicId: true,
          status: true,
          fxRateCnyPerUsd: true,
          fxRateDate: true,
          fxRateSource: true,
          fxRateNote: true,
          totalUsdMinor: true,
          items: {
            select: { id: true, publicId: true, quantity: true, totalMinor: true, totalUsdMinor: true },
          },
        },
      });
      if (!order) return failure("not_found", "Purchase order not found.");
      if (order.status === "CANCELED") {
        return failure("immutable_status", "Canceled purchase orders cannot change rates.");
      }

      const before = {
        fxRateCnyPerUsd: order.fxRateCnyPerUsd?.toString() ?? null,
        fxRateDate: order.fxRateDate,
        fxRateSource: order.fxRateSource,
        fxRateNote: order.fxRateNote,
        totalUsdMinor: order.totalUsdMinor,
      };

      // Rate corrections on a RECEIVED order re-value the remaining stock via
      // a MANUAL_ADJUSTMENT ledger entry. Locked settlements are unaffected;
      // consumed order snapshots deliberately never change.
      if (order.status === "RECEIVED") {
        for (const item of order.items) {
          const line = await tx.procurementOrderItem.findUniqueOrThrow({
            where: { id: item.id },
            select: { variantId: true, totalMinor: true },
          });
          const oldUsd = item.totalUsdMinor ?? BigInt(0);
          const newUsd = cnyMinorToUsdMinor(line.totalMinor, rate);
          // Self-idempotent: the delta is measured against the stored item
          // snapshot, so re-applying the current rate is a no-op and A→B→A
          // sequences re-value by exactly the difference each time. A
          // rate-valued idempotency key would skip the third step and desync
          // the valuation from the PO snapshot.
          const deltaUsd = newUsd - oldUsd;
          if (deltaUsd === BigInt(0)) continue;

          {
            const state = await tx.inventoryCostState.findUnique({
              where: { variantId: line.variantId },
              select: { quantity: true, totalCostUsdMinor: true },
            });
            const currentQuantity = state?.quantity ?? 0;
            const currentTotal = state?.totalCostUsdMinor ?? BigInt(0);
            // Remaining valued stock is re-valued; value never drops below
            // zero (already-consumed units keep their snapshots).
            const appliedDelta =
              deltaUsd < BigInt(0) && currentTotal + deltaUsd < BigInt(0)
                ? -currentTotal
                : deltaUsd;
            const nextTotal = currentTotal + appliedDelta;
            await tx.inventoryCostState.upsert({
              where: { variantId: line.variantId },
              create: {
                variantId: line.variantId,
                quantity: currentQuantity,
                totalCostUsdMinor: nextTotal,
              },
              update: { totalCostUsdMinor: nextTotal },
              select: { id: true },
            });
            await tx.inventoryCostEntry.create({
              data: {
                variantId: line.variantId,
                entryType: "MANUAL_ADJUSTMENT",
                quantityDelta: 0,
                costDeltaUsdMinor: appliedDelta,
                quantityAfter: currentQuantity,
                totalCostAfterUsdMinor: nextTotal,
                referenceType: "procurement_fx_correction",
                referenceId: order.publicId,
                idempotencyKey: `po-fx:${order.publicId}:${item.publicId}:${randomUUID()}`,
                reason: `Exchange-rate correction re-valuation to ${rate} (quantity unchanged).`,
                createdByUserId: actorUserId,
              },
              select: { id: true },
            });
          }

          await tx.procurementOrderItem.update({
            where: { id: item.id },
            data: {
              totalUsdMinor: newUsd,
              unitCostUsdMinor: divideRoundHalfUp(newUsd, BigInt(item.quantity)),
            },
            select: { id: true },
          });
        }
      }

      const items = await tx.procurementOrderItem.findMany({
        where: { procurementOrderId: order.id },
        select: { totalUsdMinor: true },
      });
      const totalUsdMinor =
        order.status === "RECEIVED"
          ? sumSignedMinor(items.map((item) => item.totalUsdMinor ?? BigInt(0)))
          : null;

      const after = await tx.procurementOrder.update({
        where: { id: order.id },
        data: {
          fxRateCnyPerUsd: rate,
          fxRateDate,
          fxRateSource: input.fxRateSource,
          fxRateNote: input.fxRateNote || null,
          ...(totalUsdMinor === null ? {} : { totalUsdMinor }),
          updatedByUserId: actorUserId,
        },
        select: {
          publicId: true,
          fxRateCnyPerUsd: true,
          fxRateDate: true,
          fxRateSource: true,
          fxRateNote: true,
          totalUsdMinor: true,
        },
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.procurement.fx_rate.set",
        resourceType: "procurement_order",
        resourceId: order.publicId,
        before,
        after: { ...after, fxRateCnyPerUsd: after.fxRateCnyPerUsd?.toString() ?? null },
      });
      return { ok: true as const, publicId: order.publicId };
    }, transactionOptions()),
  );
}

export async function receiveProcurementOrder(
  input: ProcurementReceiveFormInput,
): Promise<MutationResult> {
  const authorization = await requirePermission("finance.procurement.manage", RETURN_TO);
  const actorUserId = authorization.session.user.id;
  let receivedAt: Date;
  try {
    receivedAt = parseOptionalInstant(input.receivedAt, "Received time") ?? new Date();
  } catch (error) {
    return failure("invalid_dates", error instanceof Error ? error.message : "Invalid date.");
  }

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const order = await tx.procurementOrder.findFirst({
        where: { publicId: input.procurementPublicId },
        select: {
          id: true,
          publicId: true,
          status: true,
          fxRateCnyPerUsd: true,
          domesticShippingMinor: true,
          internationalShippingMinor: true,
          customsMinor: true,
          procurementFeeMinor: true,
          packagingMinor: true,
          otherCostMinor: true,
          items: {
            orderBy: { id: "asc" },
            select: {
              id: true,
              publicId: true,
              variantId: true,
              quantity: true,
              lineMinor: true,
            },
          },
        },
      });
      if (!order) return failure("not_found", "Purchase order not found.");
      if (order.status === "RECEIVED") {
        return { ok: true as const, publicId: order.publicId }; // Idempotent.
      }
      if (order.status === "CANCELED") {
        return failure("immutable_status", "Canceled purchase orders cannot be received.");
      }
      if (order.items.length === 0) {
        return failure("no_items", "Add at least one purchase line before receiving.");
      }
      if (!order.fxRateCnyPerUsd) {
        return failure(
          "missing_fx_rate",
          "Record the CNY/USD exchange rate before receiving; USD costs are locked at receipt.",
        );
      }
      const location = await tx.inventoryLocation.findFirst({
        where: { publicId: input.locationPublicId, isActive: true },
        select: { id: true, publicId: true },
      });
      if (!location) {
        return failure("location_not_found", "Choose an active inventory location.");
      }

      const rate = order.fxRateCnyPerUsd.toString();
      const extrasMinor =
        order.domesticShippingMinor +
        order.internationalShippingMinor +
        order.customsMinor +
        order.procurementFeeMinor +
        order.packagingMinor +
        order.otherCostMinor;
      // allocateProportionally cannot split a non-zero total across all-zero
      // weights; surface it as a form error instead of an uncaught throw.
      if (
        extrasMinor !== BigInt(0) &&
        order.items.every((item) => item.lineMinor === BigInt(0))
      ) {
        return failure(
          "zero_goods_value",
          "Extra costs cannot be allocated while every line has a zero goods value; set unit prices first.",
        );
      }
      const allocations = allocateProportionally(
        extrasMinor,
        order.items.map((item) => item.lineMinor),
      );

      let totalUsdMinor = BigInt(0);
      for (const [index, item] of order.items.entries()) {
        const allocatedCostMinor = allocations[index];
        const itemTotalCny = item.lineMinor + allocatedCostMinor;
        const itemTotalUsd = cnyMinorToUsdMinor(itemTotalCny, rate);
        totalUsdMinor += itemTotalUsd;

        await tx.procurementOrderItem.update({
          where: { id: item.id },
          data: {
            allocatedCostMinor,
            totalMinor: itemTotalCny,
            totalUsdMinor: itemTotalUsd,
            unitCostUsdMinor: divideRoundHalfUp(itemTotalUsd, BigInt(item.quantity)),
            receivedQuantity: item.quantity,
          },
          select: { id: true },
        });

        // Valuation: moving-average receipt of the full USD landed cost.
        await applyCostReceipt(tx, {
          variantId: item.variantId,
          quantity: item.quantity,
          totalCostUsdMinor: itemTotalUsd,
          entryType: "PROCUREMENT_RECEIPT",
          referenceType: "procurement_order",
          referenceId: order.publicId,
          idempotencyKey: `po-receipt:${order.publicId}:${item.publicId}`,
          reason: `Received ${item.quantity} units at CNY/USD ${rate}.`,
          actorUserId,
          occurredAt: receivedAt,
        });

        // Physical stock: on-hand increment + RECEIPT movement.
        const level = await tx.inventoryLevel.upsert({
          where: {
            variantId_locationId: { variantId: item.variantId, locationId: location.id },
          },
          create: {
            variantId: item.variantId,
            locationId: location.id,
            onHandQuantity: item.quantity,
          },
          update: { onHandQuantity: { increment: item.quantity } },
          select: { id: true, onHandQuantity: true },
        });
        await tx.inventoryMovement.create({
          data: {
            inventoryLevelId: level.id,
            idempotencyKey: `po-receipt:${order.publicId}:${item.publicId}`,
            type: "RECEIPT",
            quantityDelta: item.quantity,
            onHandAfter: level.onHandQuantity,
            referenceType: "procurement_order",
            referenceId: order.publicId,
            reason: "Procurement receipt.",
            createdByUserId: actorUserId,
            occurredAt: receivedAt,
          },
          select: { id: true },
        });
      }

      const after = await tx.procurementOrder.update({
        where: { id: order.id },
        data: {
          status: "RECEIVED",
          receivedAt,
          totalUsdMinor,
          updatedByUserId: actorUserId,
        },
        select: procurementAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.procurement.receive",
        resourceType: "procurement_order",
        resourceId: order.publicId,
        before: { status: order.status },
        after: { ...after, fxRateCnyPerUsd: after.fxRateCnyPerUsd?.toString() ?? null },
      });
      await writeFinanceOutbox(tx, {
        aggregateId: order.publicId,
        eventType: "finance.procurement.received",
        payload: {
          procurementPublicId: order.publicId,
          locationPublicId: location.publicId,
          totalUsdMinor: totalUsdMinor.toString(),
        },
      });
      return { ok: true as const, publicId: order.publicId };
    }, transactionOptions()),
  );
}

export async function cancelProcurementOrder(publicIdInput: string): Promise<MutationResult> {
  const authorization = await requirePermission("finance.procurement.manage", RETURN_TO);
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const order = await tx.procurementOrder.findFirst({
        where: { publicId: publicIdInput },
        select: { id: true, publicId: true, status: true },
      });
      if (!order) return failure("not_found", "Purchase order not found.");
      if (order.status === "RECEIVED") {
        return failure("immutable_status", "Received purchase orders cannot be canceled.");
      }
      if (order.status === "CANCELED") {
        return { ok: true as const, publicId: order.publicId };
      }
      await tx.procurementOrder.update({
        where: { id: order.id },
        data: { status: "CANCELED", updatedByUserId: actorUserId },
        select: { id: true },
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.procurement.cancel",
        resourceType: "procurement_order",
        resourceId: order.publicId,
        before: { status: order.status },
        after: { status: "CANCELED" },
      });
      return { ok: true as const, publicId: order.publicId };
    }, transactionOptions()),
  );
}

export type ProcurementImportResult =
  | { ok: true; publicId: string; imported: number; errors: string[] }
  | { ok: false; reason: string; message: string };

/**
 * Imports purchase lines from pasted CSV text with the fixed header
 * `sku,quantity,unitPriceCny`. Existing lines for the same variant are
 * replaced; malformed rows are reported per line without aborting the rest.
 */
export async function importProcurementLines(input: {
  procurementPublicId: string;
  csvText: string;
}): Promise<ProcurementImportResult> {
  const authorization = await requirePermission("finance.procurement.manage", RETURN_TO);
  const actorUserId = authorization.session.user.id;

  const lines = input.csvText
    .replace(/^﻿/u, "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { ok: false, reason: "empty", message: "Paste CSV rows first." };
  }
  const header = lines[0].toLowerCase().replaceAll(" ", "");
  const body = header === "sku,quantity,unitpricecny" ? lines.slice(1) : lines;
  if (body.length === 0 || body.length > 500) {
    return { ok: false, reason: "size", message: "Import supports 1–500 rows." };
  }

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const order = await tx.procurementOrder.findFirst({
        where: { publicId: input.procurementPublicId },
        select: { id: true, publicId: true, status: true },
      });
      if (!order) return { ok: false as const, reason: "not_found", message: "Purchase order not found." };
      if (order.status === "RECEIVED" || order.status === "CANCELED") {
        return {
          ok: false as const,
          reason: "immutable_status",
          message: "Received or canceled purchase orders cannot change lines.",
        };
      }

      const errors: string[] = [];
      let imported = 0;
      for (const [index, row] of body.entries()) {
        const cells = row.split(",").map((cell) => cell.trim().replace(/^"|"$/gu, ""));
        const [sku, quantityRaw, priceRaw] = cells;
        const rowLabel = `Row ${index + 1}`;
        if (!sku || !quantityRaw || !priceRaw) {
          errors.push(`${rowLabel}: expected sku,quantity,unitPriceCny.`);
          continue;
        }
        const quantity = Number(quantityRaw);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
          errors.push(`${rowLabel}: quantity must be a positive integer.`);
          continue;
        }
        if (!/^\d{1,13}(?:\.\d{1,2})?$/u.test(priceRaw)) {
          errors.push(`${rowLabel}: unit price must look like 1234.56.`);
          continue;
        }
        const [wholeCny, fractionCny = ""] = priceRaw.split(".");
        const unitPriceMinor =
          BigInt(wholeCny) * BigInt(100) + BigInt(fractionCny.padEnd(2, "0") || "0");
        const variant = await tx.productVariant.findFirst({
          where: { sku, deletedAt: null },
          select: { id: true },
        });
        if (!variant) {
          errors.push(`${rowLabel}: no variant with SKU "${sku}".`);
          continue;
        }
        const lineMinor = unitPriceMinor * BigInt(quantity);
        await tx.procurementOrderItem.upsert({
          where: {
            procurementOrderId_variantId: {
              procurementOrderId: order.id,
              variantId: variant.id,
            },
          },
          create: {
            procurementOrderId: order.id,
            variantId: variant.id,
            quantity,
            unitPriceMinor,
            lineMinor,
            totalMinor: lineMinor,
          },
          update: { quantity, unitPriceMinor, lineMinor, totalMinor: lineMinor },
          select: { id: true },
        });
        imported += 1;
      }

      await recomputeProcurementTotals(tx, order.id);
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.procurement.import_lines",
        resourceType: "procurement_order",
        resourceId: order.publicId,
        before: { rows: body.length },
        after: { imported, errors: errors.length },
      });
      return { ok: true as const, publicId: order.publicId, imported, errors };
    }, transactionOptions()),
  );
}
