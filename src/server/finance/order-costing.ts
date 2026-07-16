import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { applyCostConsumption } from "@/server/finance/inventory-costing";

/**
 * Locks the immutable USD unit-cost snapshot on every order item when a paid
 * order consumes its inventory. Runs inside the same SERIALIZABLE transaction
 * as consumeOrderInventoryReservations, so a payment is either fully
 * confirmed with snapshots or not at all.
 *
 * Costing follows cost knowledge, not the trackInventory flag — that flag
 * only governs reservations/stock levels, while valuation exists for any
 * variant that went through procurement.
 *
 * - Regular lines: consume the moving-average valuation and store
 *   unitCostUsdMinor/totalCogsUsdMinor on the order item, but only when the
 *   valued stock fully covers the line. A shortfall leaves the snapshot null
 *   (the order item has no estimation flag), so profit reports mark the order
 *   estimated via missing_cost_snapshot and the admin corrects it with a
 *   COST_CORRECTION adjustment.
 * - Compensation lines (compensationEventId set): the goods leave valuation
 *   as CUSTOMER_COMPENSATION; the cost lands on the after-sales item and a
 *   COMPENSATION_PRODUCT adjustment against the ORIGINAL order, never as
 *   COGS on the new order — the cost is booked exactly once. Shortfalls are
 *   recorded there with isEstimated, which the adjustment can carry.
 *
 * Idempotent per order item via the costing ledger's idempotency keys.
 */
export async function captureOrderCostSnapshots(
  tx: Prisma.TransactionClient,
  orderId: bigint,
  occurredAt: Date,
): Promise<{ snapshotted: number; compensations: number }> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      publicId: true,
      items: {
        select: {
          id: true,
          quantity: true,
          variantId: true,
          compensationEventId: true,
          unitCostUsdMinor: true,
        },
      },
    },
  });

  let snapshotted = 0;
  let compensations = 0;

  for (const item of order.items) {
    if (!item.variantId) continue;

    if (item.compensationEventId !== null) {
      const consumed = await applyCostConsumption(tx, {
        variantId: item.variantId,
        quantity: item.quantity,
        entryType: "CUSTOMER_COMPENSATION",
        referenceType: "order_item_compensation",
        referenceId: `${order.publicId}:${item.id.toString()}`,
        idempotencyKey: `order-compensation-cogs:${order.publicId}:${item.id.toString()}`,
        reason: "Compensation gift shipped with a later order.",
        occurredAt,
      });
      if (!consumed.applied || !consumed.result) continue;

      const event = await tx.afterSalesEvent.findUniqueOrThrow({
        where: { id: item.compensationEventId },
        select: { id: true, publicId: true, orderId: true },
      });
      await tx.afterSalesItem.updateMany({
        where: {
          eventId: event.id,
          variantId: item.variantId,
          kind: "COMPENSATION",
          appliedToOrderId: orderId,
          totalCostUsdMinor: null,
        },
        data: {
          unitCostUsdMinor: consumed.result.unitCostUsdMinor,
          totalCostUsdMinor: consumed.result.cogsUsdMinor,
          costSnapshotAt: occurredAt,
        },
      });
      // Books the goods cost once, against the original order's profit.
      await tx.financialAdjustment.create({
        data: {
          type: "COMPENSATION_PRODUCT",
          orderId: event.orderId,
          orderItemId: item.id,
          afterSalesEventId: event.id,
          originalAmountMinor: consumed.result.cogsUsdMinor,
          originalCurrency: "USD",
          signedUsdMinor: -consumed.result.cogsUsdMinor,
          effectiveAt: occurredAt,
          reason: `Compensation goods cost for gift shipped with order ${order.publicId}.`,
          isEstimated: consumed.result.uncoveredQuantity > 0,
        },
        select: { id: true },
      });
      compensations += 1;
      continue;
    }

    // Snapshots are immutable, so only lock one in when the valuation fully
    // covers the line; otherwise stay null and let profit reports flag it.
    const state = await tx.inventoryCostState.findUnique({
      where: { variantId: item.variantId },
      select: { quantity: true },
    });
    if ((state?.quantity ?? 0) < item.quantity) continue;

    const consumed = await applyCostConsumption(tx, {
      variantId: item.variantId,
      quantity: item.quantity,
      entryType: "SALE_CONSUMPTION",
      referenceType: "order",
      referenceId: order.publicId,
      idempotencyKey: `order-cogs:${order.publicId}:${item.id.toString()}`,
      reason: "Paid order consumed inventory at the current moving average.",
      occurredAt,
    });
    if (!consumed.applied || !consumed.result) continue;

    await tx.orderItem.update({
      where: { id: item.id },
      data: {
        unitCostUsdMinor: consumed.result.unitCostUsdMinor,
        totalCogsUsdMinor: consumed.result.cogsUsdMinor,
        costMethod: "MOVING_AVERAGE",
        costSnapshotAt: occurredAt,
      },
      select: { id: true },
    });
    snapshotted += 1;
  }

  return { snapshotted, compensations };
}
