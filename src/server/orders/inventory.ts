import "server-only";

import {
  InventoryMovementType,
  InventoryReservationStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { applyCostReceipt } from "@/server/finance/inventory-costing";
import { captureOrderCostSnapshots } from "@/server/finance/order-costing";
import { orderError } from "@/server/orders/errors";
import {
  allocateInventory,
  hasCompleteTrackedInventoryReservations,
  type LockedInventoryLevel,
} from "@/server/orders/inventory-logic";
import {
  aggregateOrderPaymentStatus,
  type LocalPaymentStatus,
} from "@/server/payments/nowpayments/status";
import { withSerializableRetry } from "@/server/orders/retry";

export class InventoryLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryLifecycleError";
  }
}

const EXPIRABLE_UNPAID_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  PaymentStatus.CREATED,
  PaymentStatus.PENDING,
  PaymentStatus.AWAITING_CONFIRMATION,
  PaymentStatus.PROCESSING,
];

const AUTOMATIC_EXPIRATION_BLOCKING_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  PaymentStatus.CREATED,
  PaymentStatus.PENDING,
  PaymentStatus.AWAITING_CONFIRMATION,
  PaymentStatus.PROCESSING,
  PaymentStatus.PARTIALLY_PAID,
  PaymentStatus.REVIEW_REQUIRED,
];

// An invoice is created before NOWPayments exposes a payment ID. If the first
// IPN is permanently lost, API-key reconciliation cannot query the payment by
// invoice ID (the provider's list endpoint requires separate dashboard JWT
// credentials). Keep these orders out of automatic inventory expiration until
// the reconciliation job raises a monitored manual-review hold.
const automaticallyExpirableReservationWhere = {
  OR: [
    { orderItemId: null },
    {
      orderItem: {
        is: {
          order: {
            is: {
              OR: [
                { status: { not: OrderStatus.PENDING_PAYMENT } },
                {
                  payments: {
                    none: {
                      method: PaymentMethod.NOWPAYMENTS,
                      status: {
                        in: [...AUTOMATIC_EXPIRATION_BLOCKING_PAYMENT_STATUSES],
                      },
                      providerInvoiceId: { not: null },
                      providerPaymentId: null,
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
  ],
} satisfies Prisma.InventoryReservationWhereInput;

async function lockVariantLevels(
  tx: Prisma.TransactionClient,
  variantId: bigint,
) {
  return tx.$queryRaw<LockedInventoryLevel[]>`
    SELECT
      il."id",
      il."on_hand_quantity" AS "onHandQuantity",
      il."reserved_quantity" AS "reservedQuantity",
      il."safety_stock_quantity" AS "safetyStockQuantity",
      il."allow_backorder" AS "allowBackorder"
    FROM "app"."inventory_levels" AS il
    INNER JOIN "app"."inventory_locations" AS location
      ON location."id" = il."location_id"
    WHERE il."variant_id" = ${variantId}
      AND location."is_active" = true
      AND location."country_code" = 'US'
    ORDER BY il."id" ASC
    FOR UPDATE OF il
  `;
}

async function lockActiveOrderLevels(
  tx: Prisma.TransactionClient,
  orderId: bigint,
) {
  return tx.$queryRaw<LockedInventoryLevel[]>`
    SELECT
      il."id",
      il."on_hand_quantity" AS "onHandQuantity",
      il."reserved_quantity" AS "reservedQuantity",
      il."safety_stock_quantity" AS "safetyStockQuantity",
      il."allow_backorder" AS "allowBackorder"
    FROM "app"."inventory_levels" AS il
    WHERE il."id" IN (
      SELECT reservation."inventory_level_id"
      FROM "app"."inventory_reservations" AS reservation
      INNER JOIN "app"."order_items" AS item
        ON item."id" = reservation."order_item_id"
      WHERE item."order_id" = ${orderId}
        AND reservation."status" = 'active'
    )
    ORDER BY il."id" ASC
    FOR UPDATE OF il
  `;
}

async function lockLevelsById(
  tx: Prisma.TransactionClient,
  levelIds: readonly bigint[],
) {
  if (levelIds.length === 0) return [];
  const identifiers = Prisma.join(levelIds);
  return tx.$queryRaw<LockedInventoryLevel[]>(Prisma.sql`
    SELECT
      il."id",
      il."on_hand_quantity" AS "onHandQuantity",
      il."reserved_quantity" AS "reservedQuantity",
      il."safety_stock_quantity" AS "safetyStockQuantity",
      il."allow_backorder" AS "allowBackorder"
    FROM "app"."inventory_levels" AS il
    WHERE il."id" IN (${identifiers})
    ORDER BY il."id" ASC
    FOR UPDATE OF il
  `);
}

/**
 * Frees NEXT_ORDER compensation gifts whose carrier order died before payment
 * so they can be re-attached to a later order. Safe to release: the goods
 * cost is only booked at payment confirmation, which never happened
 * (totalCostUsdMinor is still null).
 */
async function releaseCompensationAttachments(
  tx: Prisma.TransactionClient,
  orderIds: readonly bigint[],
): Promise<void> {
  if (orderIds.length === 0) return;
  await tx.afterSalesItem.updateMany({
    where: {
      appliedToOrderId: { in: [...orderIds] },
      totalCostUsdMinor: null,
    },
    data: { appliedToOrderId: null },
  });
}

async function expireReservationRows(
  tx: Prisma.TransactionClient,
  levels: LockedInventoryLevel[],
  expired: ReadonlyArray<{
    id: bigint;
    inventoryLevelId: bigint;
    quantity: number;
    orderItem: { orderId: bigint } | null;
  }>,
  expiredAt: Date,
) {
  if (expired.length === 0) {
    return { reservations: 0, quantity: 0, ordersCanceled: 0 };
  }

  await tx.inventoryReservation.updateMany({
    where: {
      id: { in: expired.map((reservation) => reservation.id) },
      status: InventoryReservationStatus.ACTIVE,
    },
    data: { status: InventoryReservationStatus.EXPIRED },
  });

  const expiredByLevel = new Map<bigint, number>();
  for (const reservation of expired) {
    expiredByLevel.set(
      reservation.inventoryLevelId,
      (expiredByLevel.get(reservation.inventoryLevelId) ?? 0) +
        reservation.quantity,
    );
  }

  for (const level of levels) {
    const quantity = expiredByLevel.get(level.id) ?? 0;
    if (quantity === 0) continue;
    if (level.reservedQuantity < quantity) {
      throw new InventoryLifecycleError(
        "Stored inventory reservations exceed the reserved quantity.",
      );
    }
    await tx.inventoryLevel.update({
      where: { id: level.id },
      data: { reservedQuantity: { decrement: quantity } },
      select: { id: true },
    });
    level.reservedQuantity -= quantity;
  }

  const orderIds = [
    ...new Set(
      expired
        .map((reservation) => reservation.orderItem?.orderId)
        .filter((orderId): orderId is bigint => orderId !== undefined),
    ),
  ];
  let ordersCanceled = 0;
  if (orderIds.length > 0) {
    const orders = await tx.order.findMany({
      where: {
        id: { in: orderIds },
        status: OrderStatus.PENDING_PAYMENT,
      },
      select: {
        id: true,
        publicId: true,
        paymentStatus: true,
        payments: {
          select: {
            id: true,
            publicId: true,
            status: true,
            amountMinor: true,
            expiresAt: true,
          },
        },
      },
    });

    for (const order of orders) {
      const resultingStatuses: LocalPaymentStatus[] = [];
      for (const payment of order.payments) {
        const nextStatus = EXPIRABLE_UNPAID_PAYMENT_STATUSES.includes(
          payment.status,
        )
          ? PaymentStatus.EXPIRED
          : payment.status === PaymentStatus.PARTIALLY_PAID
            ? PaymentStatus.REVIEW_REQUIRED
            : payment.status;
        resultingStatuses.push(nextStatus as LocalPaymentStatus);
        if (nextStatus === payment.status) continue;

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: nextStatus,
            ...(nextStatus === PaymentStatus.EXPIRED
              ? { expiresAt: payment.expiresAt ?? expiredAt }
              : {}),
          },
          select: { id: true },
        });
        await tx.paymentEvent.create({
          data: {
            paymentId: payment.id,
            eventType: "inventory.reservation_expired",
            statusBefore: payment.status,
            statusAfter: nextStatus,
            amountMinor: payment.amountMinor,
            occurredAt: expiredAt,
          },
          select: { id: true },
        });
      }

      const paymentStatus = aggregateOrderPaymentStatus(resultingStatuses);
      const canceled = await tx.order.updateMany({
        where: { id: order.id, status: OrderStatus.PENDING_PAYMENT },
        data: {
          status: OrderStatus.CANCELED,
          paymentStatus,
          canceledAt: expiredAt,
          cancellationReason:
            "The inventory reservation expired before payment confirmation.",
        },
      });
      if (canceled.count !== 1) continue;
      ordersCanceled += 1;
      await releaseCompensationAttachments(tx, [order.id]);
      await tx.outboxEvent.create({
        data: {
          aggregateType: "order",
          aggregateId: order.publicId,
          eventType: "order.inventory_reservation_expired",
          payload: {
            orderPublicId: order.publicId,
            paymentStatusBefore: order.paymentStatus,
            paymentStatusAfter: paymentStatus,
          },
        },
        select: { id: true },
      });
    }
  }

  return {
    reservations: expired.length,
    quantity: expired.reduce((sum, reservation) => sum + reservation.quantity, 0),
    ordersCanceled,
  };
}

async function expireLockedReservations(
  tx: Prisma.TransactionClient,
  levels: LockedInventoryLevel[],
  now: Date,
) {
  if (levels.length === 0) return;

  const expired = await tx.inventoryReservation.findMany({
    where: {
      ...automaticallyExpirableReservationWhere,
      inventoryLevelId: { in: levels.map((level) => level.id) },
      status: InventoryReservationStatus.ACTIVE,
      expiresAt: { not: null, lte: now },
    },
    select: {
      id: true,
      inventoryLevelId: true,
      quantity: true,
      orderItem: { select: { orderId: true } },
    },
  });
  await expireReservationRows(tx, levels, expired, now);
}

export async function reserveOrderItemInventory(
  tx: Prisma.TransactionClient,
  {
    variantId,
    orderItemId,
    quantity,
    now,
    expiresAt,
  }: {
    variantId: bigint;
    orderItemId: bigint;
    quantity: number;
    now: Date;
    expiresAt: Date;
  },
) {
  const levels = await lockVariantLevels(tx, variantId);
  await expireLockedReservations(tx, levels, now);

  const { allocations, remaining } = allocateInventory(levels, quantity);
  if (remaining > 0) {
    throw orderError(
      "OUT_OF_STOCK",
      "One or more items do not currently have enough reservable inventory.",
      409,
      true,
    );
  }

  for (const allocation of allocations) {
    await tx.inventoryLevel.update({
      where: { id: allocation.levelId },
      data: { reservedQuantity: { increment: allocation.quantity } },
      select: { id: true },
    });
    await tx.inventoryReservation.create({
      data: {
        inventoryLevelId: allocation.levelId,
        orderItemId,
        status: InventoryReservationStatus.ACTIVE,
        quantity: allocation.quantity,
        expiresAt,
      },
      select: { id: true },
    });
  }

  return allocations;
}

async function activeOrderReservations(
  tx: Prisma.TransactionClient,
  orderId: bigint,
) {
  return tx.inventoryReservation.findMany({
    where: {
      status: InventoryReservationStatus.ACTIVE,
      orderItem: { is: { orderId } },
    },
    orderBy: [{ inventoryLevelId: "asc" }, { id: "asc" }],
    select: {
      id: true,
      inventoryLevelId: true,
      orderItemId: true,
      quantity: true,
    },
  });
}

function reservationTotals(
  reservations: ReadonlyArray<{
    inventoryLevelId: bigint;
    quantity: number;
  }>,
) {
  const totals = new Map<bigint, number>();
  for (const reservation of reservations) {
    totals.set(
      reservation.inventoryLevelId,
      (totals.get(reservation.inventoryLevelId) ?? 0) + reservation.quantity,
    );
  }
  return totals;
}

/**
 * Converts every ACTIVE reservation on an order to CONSUMED. Call this inside
 * the same Serializable transaction that first confirms payment for the order.
 */
export async function consumeOrderInventoryReservations(
  tx: Prisma.TransactionClient,
  orderId: bigint,
  consumedAt: Date,
) {
  const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        publicId: true,
        items: {
          select: {
            id: true,
            quantity: true,
            variant: { select: { trackInventory: true } },
          },
        },
      },
    });
  const levels = await lockActiveOrderLevels(tx, orderId);
  if (!order) {
    throw new InventoryLifecycleError("Cannot consume inventory for a missing order.");
  }

  const reservations = await activeOrderReservations(tx, orderId);
  if (
    !hasCompleteTrackedInventoryReservations(
      order.items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        trackInventory: item.variant?.trackInventory ?? false,
      })),
      reservations,
    )
  ) {
    throw new InventoryLifecycleError(
      "A tracked order item no longer has complete active inventory reservations.",
    );
  }
  if (reservations.length === 0) {
    // Even without reservations (untracked variants), the paid order still
    // locks its USD cost snapshots for profit reporting.
    await captureOrderCostSnapshots(tx, orderId, consumedAt);
    return { reservations: 0, quantity: 0 };
  }
  const totals = reservationTotals(reservations);
  const levelById = new Map(levels.map((level) => [level.id, level]));

  for (const [levelId, reservedQuantity] of totals) {
    const level = levelById.get(levelId);
    if (!level || level.reservedQuantity < reservedQuantity) {
      throw new InventoryLifecycleError(
        "Inventory reservation totals are inconsistent during consumption.",
      );
    }

    const onHandDeduction = Math.min(level.onHandQuantity, reservedQuantity);
    if (!level.allowBackorder && onHandDeduction !== reservedQuantity) {
      throw new InventoryLifecycleError(
        "Non-backordered inventory is insufficient during consumption.",
      );
    }
    const onHandAfter = level.onHandQuantity - onHandDeduction;
    await tx.inventoryLevel.update({
      where: { id: levelId },
      data: {
        reservedQuantity: { decrement: reservedQuantity },
        ...(onHandDeduction > 0
          ? { onHandQuantity: { decrement: onHandDeduction } }
          : {}),
      },
      select: { id: true },
    });
    if (onHandDeduction > 0) {
      await tx.inventoryMovement.create({
        data: {
          inventoryLevelId: levelId,
          idempotencyKey: `order-consume:${order.publicId}:${levelId.toString()}`,
          type: InventoryMovementType.SALE,
          quantityDelta: -onHandDeduction,
          onHandAfter,
          referenceType: "order",
          referenceId: order.publicId,
          reason:
            onHandDeduction === reservedQuantity
              ? "Consumed paid order reservation."
              : "Consumed available stock for a paid backorder reservation.",
          occurredAt: consumedAt,
        },
        select: { id: true },
      });
    }
  }

  await tx.inventoryReservation.updateMany({
    where: {
      id: { in: reservations.map((reservation) => reservation.id) },
      status: InventoryReservationStatus.ACTIVE,
    },
    data: {
      status: InventoryReservationStatus.CONSUMED,
      consumedAt,
    },
  });

  // Lock the USD cost snapshots for profit reporting in the same transaction
  // that confirms the sale; historical profit never reads current costs.
  await captureOrderCostSnapshots(tx, orderId, consumedAt);

  return {
    reservations: reservations.length,
    quantity: reservations.reduce((sum, reservation) => sum + reservation.quantity, 0),
  };
}

/** Releases ACTIVE reservations without changing on-hand stock. */
export async function releaseOrderInventoryReservations(
  tx: Prisma.TransactionClient,
  orderId: bigint,
  releasedAt: Date,
) {
  const levels = await lockActiveOrderLevels(tx, orderId);
  const reservations = await activeOrderReservations(tx, orderId);
  // Runs before the early return: a gift-carrying order can consist entirely
  // of untracked lines with no reservations.
  await releaseCompensationAttachments(tx, [orderId]);
  if (reservations.length === 0) return { reservations: 0, quantity: 0 };
  const totals = reservationTotals(reservations);
  const levelById = new Map(levels.map((level) => [level.id, level]));

  for (const [levelId, quantity] of totals) {
    const level = levelById.get(levelId);
    if (!level || level.reservedQuantity < quantity) {
      throw new InventoryLifecycleError(
        "Inventory reservation totals are inconsistent during release.",
      );
    }
    await tx.inventoryLevel.update({
      where: { id: levelId },
      data: { reservedQuantity: { decrement: quantity } },
      select: { id: true },
    });
  }

  await tx.inventoryReservation.updateMany({
    where: {
      id: { in: reservations.map((reservation) => reservation.id) },
      status: InventoryReservationStatus.ACTIVE,
    },
    data: {
      status: InventoryReservationStatus.RELEASED,
      releasedAt,
    },
  });

  return {
    reservations: reservations.length,
    quantity: reservations.reduce((sum, reservation) => sum + reservation.quantity, 0),
  };
}

/**
 * Reverses the on-hand portion of a paid order's SALE movements when a full
 * refund arrives before carrier dispatch. CONSUMED reservations remain as the
 * immutable history of the original sale; a uniquely keyed RETURN movement is
 * the compensating record and makes provider retries safe.
 */
export async function restoreOrderInventoryAfterPreDispatchRefund(
  tx: Prisma.TransactionClient,
  orderId: bigint,
  returnedAt: Date,
) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      publicId: true,
      items: {
        select: {
          id: true,
          variantId: true,
          quantity: true,
          totalCogsUsdMinor: true,
          compensationEventId: true,
        },
      },
    },
  });
  if (!order) {
    throw new InventoryLifecycleError(
      "Cannot restore inventory for a missing order.",
    );
  }

  // The goods never left the warehouse, so their cost re-enters the
  // moving-average valuation at the snapshot amount — otherwise a later sale
  // of the physically restored units hits a cost-state shortfall and gets
  // wrongly flagged as missing its cost. Compensation lines are skipped: their
  // cost lives on the after-sales event, not this order. Idempotent per line
  // via the costing ledger. The snapshot itself stays on the order item as
  // history; refunded orders are excluded from profit reports by status.
  for (const item of order.items) {
    if (!item.variantId || item.compensationEventId !== null) continue;
    if (item.totalCogsUsdMinor === null) continue;
    await applyCostReceipt(tx, {
      variantId: item.variantId,
      quantity: item.quantity,
      totalCostUsdMinor: item.totalCogsUsdMinor,
      entryType: "RETURN_RESTOCK",
      referenceType: "order",
      referenceId: order.publicId,
      idempotencyKey: `order-refund-valuation:${order.publicId}:${item.id.toString()}`,
      reason: "Valuation restored after a full refund before carrier dispatch.",
      occurredAt: returnedAt,
    });
  }

  const saleMovements = await tx.inventoryMovement.findMany({
    where: {
      referenceType: "order",
      referenceId: order.publicId,
      type: InventoryMovementType.SALE,
      quantityDelta: { lt: 0 },
    },
    orderBy: [{ inventoryLevelId: "asc" }, { id: "asc" }],
    select: { inventoryLevelId: true, quantityDelta: true },
  });
  if (saleMovements.length === 0) return { movements: 0, quantity: 0 };

  const quantityByLevel = new Map<bigint, number>();
  for (const movement of saleMovements) {
    quantityByLevel.set(
      movement.inventoryLevelId,
      (quantityByLevel.get(movement.inventoryLevelId) ?? 0) -
        movement.quantityDelta,
    );
  }
  const levels = await lockLevelsById(
    tx,
    [...quantityByLevel.keys()].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
  const levelById = new Map(levels.map((level) => [level.id, level]));
  let restoredMovements = 0;
  let restoredQuantity = 0;

  for (const [levelId, quantity] of quantityByLevel) {
    const idempotencyKey =
      `order-refund-before-dispatch:${order.publicId}:${levelId.toString()}`;
    const existingReturn = await tx.inventoryMovement.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existingReturn) continue;

    const level = levelById.get(levelId);
    if (!level) {
      throw new InventoryLifecycleError(
        "The original sale inventory level no longer exists.",
      );
    }
    const onHandAfter = level.onHandQuantity + quantity;
    await tx.inventoryLevel.update({
      where: { id: levelId },
      data: { onHandQuantity: { increment: quantity } },
      select: { id: true },
    });
    await tx.inventoryMovement.create({
      data: {
        inventoryLevelId: levelId,
        idempotencyKey,
        type: InventoryMovementType.RETURN,
        quantityDelta: quantity,
        onHandAfter,
        referenceType: "order",
        referenceId: order.publicId,
        reason: "Restored stock after a full refund before carrier dispatch.",
        occurredAt: returnedAt,
      },
      select: { id: true },
    });
    level.onHandQuantity = onHandAfter;
    restoredMovements += 1;
    restoredQuantity += quantity;
  }

  return { movements: restoredMovements, quantity: restoredQuantity };
}

/**
 * Expires at most 100 stale reservations. Designed for a recurring Docker job;
 * callers should repeat batches until `reservations` is zero.
 */
export async function expireInventoryReservationsBatch({
  limit = 100,
  now = new Date(),
}: {
  limit?: number;
  now?: Date;
} = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Inventory expiration batch size must be 1–100.");
  }

  const db = getDb();
  return withSerializableRetry(() =>
    db.$transaction(
      async (tx) => {
        const candidates = await tx.inventoryReservation.findMany({
          where: {
            ...automaticallyExpirableReservationWhere,
            status: InventoryReservationStatus.ACTIVE,
            expiresAt: { not: null, lte: now },
          },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          take: limit,
          select: { inventoryLevelId: true },
        });
        if (candidates.length === 0) {
          return {
            reservations: 0,
            quantity: 0,
            levels: 0,
            ordersCanceled: 0,
          };
        }

        const levelIds = [
          ...new Set(candidates.map(({ inventoryLevelId }) => inventoryLevelId)),
        ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
        const levels = await lockLevelsById(tx, levelIds);
        const expired = await tx.inventoryReservation.findMany({
          where: {
            ...automaticallyExpirableReservationWhere,
            inventoryLevelId: { in: levelIds },
            status: InventoryReservationStatus.ACTIVE,
            expiresAt: { not: null, lte: now },
          },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          take: limit,
          select: {
            id: true,
            inventoryLevelId: true,
            quantity: true,
            orderItem: { select: { orderId: true } },
          },
        });
        const result = await expireReservationRows(tx, levels, expired, now);
        return { ...result, levels: new Set(expired.map((row) => row.inventoryLevelId)).size };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      },
    ),
  );
}
