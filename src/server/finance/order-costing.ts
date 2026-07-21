import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { applyCostConsumption } from "@/server/finance/inventory-costing";
import { divideRoundHalfUp } from "@/server/finance/math/rounding";

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
 *   valued stock fully covers the line. If stock valuation is unavailable but
 *   a supplier-list reference cost exists, lock that value as an explicitly
 *   estimated MANUAL snapshot. A line stays null only when neither source is
 *   available.
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
          variant: {
            select: { referenceCostUsdMinor: true },
          },
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
      const compensationReferenceCost = item.variant?.referenceCostUsdMinor ?? null;
      const estimatedUncoveredCost =
        compensationReferenceCost === null
          ? BigInt(0)
          : compensationReferenceCost * BigInt(consumed.result.uncoveredQuantity);
      const totalCostUsdMinor = consumed.result.cogsUsdMinor + estimatedUncoveredCost;
      const unitCostUsdMinor = divideRoundHalfUp(
        totalCostUsdMinor,
        BigInt(item.quantity),
      );
      await tx.afterSalesItem.updateMany({
        where: {
          eventId: event.id,
          variantId: item.variantId,
          kind: "COMPENSATION",
          appliedToOrderId: orderId,
          totalCostUsdMinor: null,
        },
        data: {
          unitCostUsdMinor,
          totalCostUsdMinor,
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
          originalAmountMinor: totalCostUsdMinor,
          originalCurrency: "USD",
          signedUsdMinor: -totalCostUsdMinor,
          effectiveAt: occurredAt,
          reason: `Compensation goods cost for gift shipped with order ${order.publicId}.`,
          isEstimated: consumed.result.uncoveredQuantity > 0,
        },
        select: { id: true },
      });
      compensations += 1;
      continue;
    }

    // Snapshots are immutable. Actual moving-average valuation wins; the
    // supplier-list reference is a transparent fallback and never changes
    // physical stock or the inventory cost ledger.
    const state = await tx.inventoryCostState.findUnique({
      where: { variantId: item.variantId },
      select: { quantity: true },
    });
    if ((state?.quantity ?? 0) < item.quantity) {
      const referenceCost = item.variant?.referenceCostUsdMinor;
      if (referenceCost == null) continue;
      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          unitCostUsdMinor: referenceCost,
          totalCogsUsdMinor: referenceCost * BigInt(item.quantity),
          costMethod: "MANUAL",
          costIsEstimated: true,
          costSnapshotAt: occurredAt,
        },
        select: { id: true },
      });
      snapshotted += 1;
      continue;
    }

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
        costIsEstimated: false,
        costSnapshotAt: occurredAt,
      },
      select: { id: true },
    });
    snapshotted += 1;
  }

  return { snapshotted, compensations };
}
