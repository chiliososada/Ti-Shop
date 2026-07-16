import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import type {
  AfterSalesAttachFormInput,
  AfterSalesCompleteFormInput,
  AfterSalesEventFormInput,
  AfterSalesItemFormInput,
} from "@/server/admin/finance/after-sales/validators";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import {
  applyCostConsumption,
  applyCostReceipt,
} from "@/server/finance/inventory-costing";
import { sumSignedMinor } from "@/server/finance/math/rounding";
import { reserveOrderItemInventory } from "@/server/orders/inventory";
import { withSerializableRetry } from "@/server/orders/retry";

const RETURN_TO = "/admin/finance/after-sales";

type MutationResult =
  | { ok: true; publicId: string }
  | { ok: false; reason: string; message: string };

function failure(reason: string, message: string): MutationResult {
  return { ok: false, reason, message };
}

function transactionOptions() {
  return {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 20_000,
  } as const;
}

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

const eventAuditSelect = {
  publicId: true,
  status: true,
  responsibility: true,
  reason: true,
  refundAmountMinor: true,
  shippingRefundMinor: true,
  returnShippingCostMinor: true,
  compensationShippingCostMinor: true,
  evidenceNotes: true,
} satisfies Prisma.AfterSalesEventSelect;

export async function upsertAfterSalesEvent(
  input: AfterSalesEventFormInput,
): Promise<MutationResult> {
  const authorization = await requirePermission("finance.returns.manage", RETURN_TO);
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { publicId: input.orderPublicId },
        select: { id: true, publicId: true, status: true, totalMinor: true },
      });
      if (!order) return failure("order_not_found", "Order not found.");
      if (order.status === "DRAFT") {
        return failure("order_draft", "After-sales events require a placed order.");
      }

      const data = {
        responsibility: input.responsibility,
        reason: input.reason,
        refundAmountMinor: input.refundAmount,
        shippingRefundMinor: input.shippingRefund,
        returnShippingCostMinor: input.returnShippingCost,
        compensationShippingCostMinor: input.compensationShippingCost,
        evidenceNotes: input.evidenceNotes || null,
      };

      if (input.publicId) {
        const before = await tx.afterSalesEvent.findFirst({
          where: { publicId: input.publicId },
          select: { id: true, ...eventAuditSelect },
        });
        if (!before) return failure("not_found", "After-sales event not found.");
        if (before.status !== "DRAFT" && before.status !== "APPROVED") {
          return failure(
            "immutable_status",
            "Completed or voided events are immutable; corrections go through financial adjustments.",
          );
        }
        const after = await tx.afterSalesEvent.update({
          where: { id: before.id },
          data,
          select: eventAuditSelect,
        });
        await writeAdminAuditLog(tx, {
          actorUserId,
          action: "finance.after_sales.update",
          resourceType: "after_sales_event",
          resourceId: after.publicId,
          before,
          after,
        });
        return { ok: true as const, publicId: after.publicId };
      }

      const created = await tx.afterSalesEvent.create({
        data: { ...data, orderId: order.id, createdByUserId: actorUserId },
        select: eventAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.after_sales.create",
        resourceType: "after_sales_event",
        resourceId: created.publicId,
        before: { exists: false },
        after: created,
      });
      return { ok: true as const, publicId: created.publicId };
    }, transactionOptions()),
  );
}

export async function upsertAfterSalesItem(
  input: AfterSalesItemFormInput,
): Promise<MutationResult> {
  const authorization = await requirePermission("finance.returns.manage", RETURN_TO);
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const event = await tx.afterSalesEvent.findFirst({
        where: { publicId: input.eventPublicId },
        select: { id: true, publicId: true, status: true, orderId: true },
      });
      if (!event) return failure("not_found", "After-sales event not found.");
      if (event.status !== "DRAFT" && event.status !== "APPROVED") {
        return failure("immutable_status", "Completed or voided events cannot change items.");
      }

      if (input.remove === "true") {
        if (!input.itemPublicId) return failure("invalid", "Missing item id.");
        const item = await tx.afterSalesItem.findFirst({
          where: { publicId: input.itemPublicId, eventId: event.id },
          select: { id: true, publicId: true, kind: true, quantity: true, appliedToOrderId: true },
        });
        if (!item) return failure("not_found", "After-sales item not found.");
        if (item.appliedToOrderId !== null) {
          return failure(
            "already_applied",
            "This compensation is already attached to an order and cannot be removed.",
          );
        }
        await tx.afterSalesItem.delete({ where: { id: item.id }, select: { id: true } });
        await writeAdminAuditLog(tx, {
          actorUserId,
          action: "finance.after_sales.item.remove",
          resourceType: "after_sales_event",
          resourceId: event.publicId,
          before: item,
          after: { removed: true },
        });
        return { ok: true as const, publicId: event.publicId };
      }

      if (!input.kind || input.quantity === undefined) {
        return failure("invalid", "Kind and quantity are required.");
      }

      let orderItemId: bigint | null = null;
      let variantId: bigint | null = null;
      if (input.orderItemId) {
        const orderItem = await tx.orderItem.findFirst({
          where: { id: BigInt(input.orderItemId), orderId: event.orderId },
          select: { id: true, variantId: true, quantity: true },
        });
        if (!orderItem) return failure("order_item_not_found", "Order line not found on this order.");
        if (input.kind === "RETURN") {
          // Cap the CUMULATIVE returned units for this order line across all
          // non-voided events — otherwise a second event could restock and
          // reverse the same COGS again.
          const priorReturns = await tx.afterSalesItem.aggregate({
            where: {
              kind: "RETURN",
              orderItemId: orderItem.id,
              event: { status: { not: "VOIDED" } },
              ...(input.itemPublicId ? { publicId: { not: input.itemPublicId } } : {}),
            },
            _sum: { quantity: true },
          });
          const alreadyReturned = priorReturns._sum.quantity ?? 0;
          if (alreadyReturned + input.quantity > orderItem.quantity) {
            return failure(
              "quantity_exceeds",
              `Cannot return more units than were ordered (${alreadyReturned} of ${orderItem.quantity} already in other return events).`,
            );
          }
        }
        orderItemId = orderItem.id;
        variantId = orderItem.variantId;
      }
      if (input.variantPublicId) {
        const variant = await tx.productVariant.findFirst({
          where: { publicId: input.variantPublicId, deletedAt: null },
          select: { id: true },
        });
        if (!variant) return failure("variant_not_found", "Variant not found.");
        variantId = variant.id;
      }
      if (variantId === null) {
        return failure("invalid", "Choose an order line or a variant.");
      }
      if (input.kind === "RETURN" && !input.disposition) {
        return failure("invalid", "Returns need a disposition (resalable/damaged/lost/destroyed).");
      }
      if (input.kind === "COMPENSATION" && !input.compensationDelivery) {
        return failure("invalid", "Compensations need a delivery mode.");
      }

      const created = await tx.afterSalesItem.create({
        data: {
          eventId: event.id,
          kind: input.kind,
          orderItemId,
          variantId,
          quantity: input.quantity,
          disposition: input.kind === "RETURN" ? (input.disposition as never) : null,
          compensationDelivery:
            input.kind === "COMPENSATION" ? (input.compensationDelivery as never) : null,
        },
        select: { publicId: true, kind: true, quantity: true },
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.after_sales.item.add",
        resourceType: "after_sales_event",
        resourceId: event.publicId,
        before: { exists: false },
        after: created,
      });
      return { ok: true as const, publicId: event.publicId };
    }, transactionOptions()),
  );
}

export async function approveAfterSalesEvent(publicId: string): Promise<MutationResult> {
  const authorization = await requirePermission("finance.returns.manage", RETURN_TO);
  const actorUserId = authorization.session.user.id;
  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const event = await tx.afterSalesEvent.findFirst({
        where: { publicId },
        select: { id: true, publicId: true, status: true },
      });
      if (!event) return failure("not_found", "After-sales event not found.");
      if (event.status === "APPROVED") return { ok: true as const, publicId };
      if (event.status !== "DRAFT") {
        return failure("immutable_status", "Only draft events can be approved.");
      }
      await tx.afterSalesEvent.update({
        where: { id: event.id },
        data: { status: "APPROVED", approvedByUserId: actorUserId },
        select: { id: true },
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.after_sales.approve",
        resourceType: "after_sales_event",
        resourceId: publicId,
        before: { status: event.status },
        after: { status: "APPROVED" },
      });
      return { ok: true as const, publicId };
    }, transactionOptions()),
  );
}

export async function voidAfterSalesEvent(publicId: string): Promise<MutationResult> {
  const authorization = await requirePermission("finance.returns.manage", RETURN_TO);
  const actorUserId = authorization.session.user.id;
  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const event = await tx.afterSalesEvent.findFirst({
        where: { publicId },
        select: {
          id: true,
          publicId: true,
          status: true,
          items: { select: { appliedToOrderId: true } },
        },
      });
      if (!event) return failure("not_found", "After-sales event not found.");
      if (event.status === "VOIDED") return { ok: true as const, publicId };
      if (event.status === "COMPLETED") {
        return failure(
          "immutable_status",
          "Completed events are immutable; use reversing financial adjustments.",
        );
      }
      if (event.items.some((item) => item.appliedToOrderId !== null)) {
        return failure(
          "already_applied",
          "A compensation from this event is already attached to an order.",
        );
      }
      await tx.afterSalesEvent.update({
        where: { id: event.id },
        data: { status: "VOIDED", voidedAt: new Date() },
        select: { id: true },
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.after_sales.void",
        resourceType: "after_sales_event",
        resourceId: publicId,
        before: { status: event.status },
        after: { status: "VOIDED" },
      });
      return { ok: true as const, publicId };
    }, transactionOptions()),
  );
}

/**
 * Completes an approved event: validates the refund cap, writes the
 * append-only financial adjustments, restocks resalable returns at their
 * snapshot cost, moves damaged-return losses from COGS into after-sales cost,
 * and ships dedicated compensations out of stock at the moving average.
 * Idempotent: completing twice is a no-op.
 */
export async function completeAfterSalesEvent(
  input: AfterSalesCompleteFormInput,
): Promise<MutationResult> {
  const authorization = await requirePermission("finance.returns.manage", RETURN_TO);
  const actorUserId = authorization.session.user.id;
  const now = new Date();

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const event = await tx.afterSalesEvent.findFirst({
        where: { publicId: input.eventPublicId },
        select: {
          id: true,
          publicId: true,
          status: true,
          refundAmountMinor: true,
          shippingRefundMinor: true,
          returnShippingCostMinor: true,
          compensationShippingCostMinor: true,
          order: {
            select: { id: true, publicId: true, totalMinor: true, profitSettledSettlementId: true },
          },
          items: {
            select: {
              id: true,
              publicId: true,
              kind: true,
              quantity: true,
              disposition: true,
              compensationDelivery: true,
              variantId: true,
              orderItem: {
                select: { id: true, unitCostUsdMinor: true, totalCogsUsdMinor: true, quantity: true },
              },
            },
          },
        },
      });
      if (!event) return failure("not_found", "After-sales event not found.");
      if (event.status === "COMPLETED") return { ok: true as const, publicId: event.publicId };
      if (event.status !== "APPROVED") {
        return failure("not_approved", "Approve the event before completing it.");
      }

      // Refund cap: total refunds across completed events never exceed what
      // the customer actually paid for the order.
      const priorEvents = await tx.afterSalesEvent.findMany({
        where: { orderId: event.order.id, status: "COMPLETED" },
        select: { refundAmountMinor: true, shippingRefundMinor: true },
      });
      const priorRefunded = sumSignedMinor(
        priorEvents.flatMap((prior) => [prior.refundAmountMinor, prior.shippingRefundMinor]),
      );
      const thisRefund = event.refundAmountMinor + event.shippingRefundMinor;
      if (priorRefunded + thisRefund > event.order.totalMinor) {
        return failure(
          "refund_exceeds",
          "Cumulative refunds would exceed the amount the customer paid.",
        );
      }

      // Same cumulative guard for returned units (defense in depth for drafts
      // created concurrently or before this rule existed): the restock and
      // COGS reversal must never exceed what the order line sold.
      for (const item of event.items) {
        if (item.kind !== "RETURN" || !item.orderItem) continue;
        const otherReturns = await tx.afterSalesItem.aggregate({
          where: {
            kind: "RETURN",
            orderItemId: item.orderItem.id,
            id: { not: item.id },
            event: { status: "COMPLETED" },
          },
          _sum: { quantity: true },
        });
        if ((otherReturns._sum.quantity ?? 0) + item.quantity > item.orderItem.quantity) {
          return failure(
            "quantity_exceeds",
            "Completing this event would return more units than the order line sold.",
          );
        }
      }

      const needsLocation = event.items.some(
        (item) =>
          (item.kind === "RETURN" && item.disposition === "RESALABLE") ||
          (item.kind === "COMPENSATION" && item.compensationDelivery === "DEDICATED_SHIPMENT"),
      );
      let location: { id: bigint; publicId: string } | null = null;
      if (needsLocation) {
        if (!input.locationPublicId) {
          return failure(
            "location_required",
            "Choose an inventory location for restocks and dedicated compensation shipments.",
          );
        }
        location = await tx.inventoryLocation.findFirst({
          where: { publicId: input.locationPublicId, isActive: true },
          select: { id: true, publicId: true },
        });
        if (!location) return failure("location_not_found", "Inventory location not found.");
      }

      const adjust = async (
        type:
          | "REFUND"
          | "SHIPPING_REFUND"
          | "RETURN_SHIPPING"
          | "COMPENSATION_SHIPPING"
          | "COMPENSATION_PRODUCT"
          | "DAMAGED_RETURN"
          | "COST_CORRECTION",
        signedUsdMinor: bigint,
        reason: string,
        extras?: { orderItemId?: bigint; isEstimated?: boolean },
      ) => {
        if (signedUsdMinor === BigInt(0)) return;
        await tx.financialAdjustment.create({
          data: {
            type,
            orderId: event.order.id,
            orderItemId: extras?.orderItemId ?? null,
            afterSalesEventId: event.id,
            originalAmountMinor: signedUsdMinor < BigInt(0) ? -signedUsdMinor : signedUsdMinor,
            originalCurrency: "USD",
            signedUsdMinor,
            effectiveAt: now,
            reason,
            isEstimated: extras?.isEstimated ?? false,
            createdByUserId: actorUserId,
            approvedByUserId: actorUserId,
          },
          select: { id: true },
        });
      };

      await adjust("REFUND", -event.refundAmountMinor, "After-sales refund to the customer.");
      await adjust(
        "SHIPPING_REFUND",
        -event.shippingRefundMinor,
        "Shipping charge refunded to the customer.",
      );
      await adjust(
        "RETURN_SHIPPING",
        -event.returnShippingCostMinor,
        "Return shipping paid by the merchant.",
      );
      await adjust(
        "COMPENSATION_SHIPPING",
        -event.compensationShippingCostMinor,
        "Extra shipping for the compensation delivery.",
      );

      for (const item of event.items) {
        if (item.kind === "RETURN") {
          const snapshotUnit = item.orderItem?.unitCostUsdMinor ?? null;
          const restoreCost =
            snapshotUnit !== null ? snapshotUnit * BigInt(item.quantity) : BigInt(0);

          if (item.disposition === "RESALABLE" && location) {
            // Physical restock + valuation restore at the snapshot cost.
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
                idempotencyKey: `after-sales-restock:${event.publicId}:${item.publicId}`,
                type: "RETURN_RESTOCK",
                quantityDelta: item.quantity,
                onHandAfter: level.onHandQuantity,
                referenceType: "after_sales_event",
                referenceId: event.publicId,
                reason: "Customer return restocked as resalable.",
                createdByUserId: actorUserId,
                occurredAt: now,
              },
              select: { id: true },
            });
            await applyCostReceipt(tx, {
              variantId: item.variantId,
              quantity: item.quantity,
              totalCostUsdMinor: restoreCost,
              entryType: "RETURN_RESTOCK",
              referenceType: "after_sales_event",
              referenceId: event.publicId,
              idempotencyKey: `after-sales-restock:${event.publicId}:${item.publicId}`,
              reason: "Return restocked at the original order's cost snapshot.",
              actorUserId,
              occurredAt: now,
            });
            await adjust(
              "COST_CORRECTION",
              restoreCost,
              "COGS reversed: returned goods restocked as resalable.",
              { orderItemId: item.orderItem?.id, isEstimated: snapshotUnit === null },
            );
            await tx.afterSalesItem.update({
              where: { id: item.id },
              data: {
                restocked: true,
                unitCostUsdMinor: snapshotUnit,
                totalCostUsdMinor: restoreCost,
                costSnapshotAt: now,
              },
              select: { id: true },
            });
          } else if (item.disposition === "DAMAGED" || item.disposition === "DESTROYED") {
            // The loss moves from COGS into visible after-sales cost:
            // reverse COGS, book the same amount as a damaged-return loss.
            await adjust(
              "COST_CORRECTION",
              restoreCost,
              "COGS reclassified for a damaged/destroyed return.",
              { orderItemId: item.orderItem?.id, isEstimated: snapshotUnit === null },
            );
            await adjust(
              "DAMAGED_RETURN",
              -restoreCost,
              "Returned goods cannot be resold; goods loss recognized.",
              { orderItemId: item.orderItem?.id, isEstimated: snapshotUnit === null },
            );
            await tx.afterSalesItem.update({
              where: { id: item.id },
              data: {
                unitCostUsdMinor: snapshotUnit,
                totalCostUsdMinor: restoreCost,
                costSnapshotAt: now,
              },
              select: { id: true },
            });
          }
          // LOST (refund without return): the original COGS simply stays.
          continue;
        }

        // COMPENSATION items.
        if (item.compensationDelivery === "DEDICATED_SHIPMENT" && location) {
          const consumed = await applyCostConsumption(tx, {
            variantId: item.variantId,
            quantity: item.quantity,
            entryType: item.orderItem ? "WARRANTY_REPLACEMENT" : "GOODWILL_GIFT",
            referenceType: "after_sales_event",
            referenceId: event.publicId,
            idempotencyKey: `after-sales-compensation:${event.publicId}:${item.publicId}`,
            reason: item.orderItem
              ? "Free replacement shipped for a problem order."
              : "Goodwill gift shipped to the customer.",
            actorUserId,
            occurredAt: now,
          });
          if (consumed.applied && consumed.result) {
            const level = await tx.inventoryLevel.upsert({
              where: {
                variantId_locationId: { variantId: item.variantId, locationId: location.id },
              },
              create: { variantId: item.variantId, locationId: location.id, onHandQuantity: 0 },
              update: {},
              select: { id: true, onHandQuantity: true },
            });
            const onHandAfter = Math.max(0, level.onHandQuantity - item.quantity);
            await tx.inventoryLevel.update({
              where: { id: level.id },
              data: { onHandQuantity: onHandAfter },
              select: { id: true },
            });
            await tx.inventoryMovement.create({
              data: {
                inventoryLevelId: level.id,
                idempotencyKey: `after-sales-compensation:${event.publicId}:${item.publicId}`,
                type: item.orderItem ? "WARRANTY_REPLACEMENT" : "GOODWILL_GIFT",
                quantityDelta: -Math.min(level.onHandQuantity, item.quantity),
                onHandAfter,
                referenceType: "after_sales_event",
                referenceId: event.publicId,
                reason: "Compensation goods shipped free of charge.",
                createdByUserId: actorUserId,
                occurredAt: now,
              },
              select: { id: true },
            });
            await tx.afterSalesItem.update({
              where: { id: item.id },
              data: {
                unitCostUsdMinor: consumed.result.unitCostUsdMinor,
                totalCostUsdMinor: consumed.result.cogsUsdMinor,
                costSnapshotAt: now,
              },
              select: { id: true },
            });
            await adjust(
              "COMPENSATION_PRODUCT",
              -consumed.result.cogsUsdMinor,
              "Compensation goods cost at the moving-average snapshot.",
              { orderItemId: item.orderItem?.id, isEstimated: consumed.result.uncoveredQuantity > 0 },
            );
          }
        }
        // NEXT_ORDER compensations are consumed when the target order's
        // payment confirms (captureOrderCostSnapshots books the cost there).
      }

      await tx.afterSalesEvent.update({
        where: { id: event.id },
        data: { status: "COMPLETED", completedAt: now },
        select: { id: true },
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.after_sales.complete",
        resourceType: "after_sales_event",
        resourceId: event.publicId,
        before: { status: "APPROVED" },
        after: {
          status: "COMPLETED",
          refundAmountMinor: event.refundAmountMinor.toString(),
          shippingRefundMinor: event.shippingRefundMinor.toString(),
        },
      });
      await writeFinanceOutbox(tx, {
        aggregateId: event.order.publicId,
        eventType: "finance.after_sales.completed",
        payload: {
          afterSalesPublicId: event.publicId,
          orderPublicId: event.order.publicId,
        },
      });
      return { ok: true as const, publicId: event.publicId };
    }, transactionOptions()),
  );
}

/**
 * Attaches a NEXT_ORDER compensation item to one of the customer's later
 * orders as a zero-priced line. Inventory is reserved like any other line so
 * payment confirmation consumes it; the goods cost is booked once, against
 * the ORIGINAL order, when that consumption happens.
 */
export async function attachCompensationToOrder(
  input: AfterSalesAttachFormInput,
): Promise<MutationResult> {
  const authorization = await requirePermission("finance.returns.manage", RETURN_TO);
  const actorUserId = authorization.session.user.id;
  const now = new Date();

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const event = await tx.afterSalesEvent.findFirst({
        where: { publicId: input.eventPublicId },
        select: { id: true, publicId: true, status: true, order: { select: { userId: true } } },
      });
      if (!event) return failure("not_found", "After-sales event not found.");
      if (event.status !== "APPROVED" && event.status !== "COMPLETED") {
        return failure("not_approved", "Approve the event before attaching its compensation.");
      }
      const item = await tx.afterSalesItem.findFirst({
        where: { publicId: input.itemPublicId, eventId: event.id },
        select: {
          id: true,
          kind: true,
          quantity: true,
          compensationDelivery: true,
          appliedToOrderId: true,
          variant: {
            select: {
              id: true,
              title: true,
              sku: true,
              trackInventory: true,
              product: { select: { id: true, title: true, slug: true } },
            },
          },
        },
      });
      if (!item) return failure("not_found", "Compensation item not found.");
      if (item.kind !== "COMPENSATION" || item.compensationDelivery !== "NEXT_ORDER") {
        return failure("invalid", "Only next-order compensations can be attached.");
      }
      if (item.appliedToOrderId !== null) {
        return failure("already_applied", "This compensation is already attached to an order.");
      }

      const target = await tx.order.findFirst({
        where: { publicId: input.targetOrderPublicId },
        select: { id: true, publicId: true, status: true, userId: true },
      });
      if (!target) return failure("target_not_found", "Target order not found.");
      if (target.userId !== event.order.userId) {
        return failure("customer_mismatch", "The target order belongs to a different customer.");
      }
      if (target.status !== "DRAFT" && target.status !== "PENDING_PAYMENT") {
        return failure(
          "target_not_open",
          "Attach compensations before the target order's payment is confirmed.",
        );
      }

      const orderItem = await tx.orderItem.create({
        data: {
          orderId: target.id,
          productId: item.variant.product.id,
          variantId: item.variant.id,
          productName: item.variant.product.title,
          productSlug: item.variant.product.slug,
          variantName: item.variant.title,
          sku: item.variant.sku,
          quantity: item.quantity,
          unitPriceMinor: BigInt(0),
          discountMinor: BigInt(0),
          taxMinor: BigInt(0),
          lineTotalMinor: BigInt(0),
          compensationEventId: event.id,
        },
        select: { id: true },
      });
      if (item.variant.trackInventory) {
        await reserveOrderItemInventory(tx, {
          variantId: item.variant.id,
          orderItemId: orderItem.id,
          quantity: item.quantity,
          now,
          expiresAt: new Date(now.getTime() + 24 * 3_600_000),
        });
      }
      await tx.afterSalesItem.update({
        where: { id: item.id },
        data: { appliedToOrderId: target.id },
        select: { id: true },
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.after_sales.attach_next_order",
        resourceType: "after_sales_event",
        resourceId: event.publicId,
        before: { appliedToOrder: null },
        after: { appliedToOrder: target.publicId, quantity: item.quantity },
      });
      await writeFinanceOutbox(tx, {
        aggregateId: target.publicId,
        eventType: "finance.after_sales.compensation_attached",
        payload: {
          afterSalesPublicId: event.publicId,
          targetOrderPublicId: target.publicId,
        },
      });
      return { ok: true as const, publicId: event.publicId };
    }, transactionOptions()),
  );
}
