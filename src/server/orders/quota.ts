import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { orderError } from "@/server/orders/errors";
import {
  CHECKOUT_QUOTA,
  checkoutQuotaViolation,
} from "@/server/orders/quota-logic";

export async function assertCustomerCheckoutQuota(
  tx: Prisma.TransactionClient,
  {
    userId,
    requestedReservedQuantity,
    now,
  }: {
    userId: string;
    requestedReservedQuantity: number;
    now: Date;
  },
) {
  const recentCutoff = new Date(
    now.getTime() - CHECKOUT_QUOTA.recentWindowMilliseconds,
  );
  const recentOrders = await tx.order.count({
      where: { userId, createdAt: { gte: recentCutoff } },
    });
  const pendingOrders = await tx.order.count({
      where: { userId, status: "PENDING_PAYMENT" },
    });
  const activeReservations = await tx.inventoryReservation.aggregate({
      where: {
        status: "ACTIVE",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        orderItem: { is: { order: { is: { userId } } } },
      },
      _sum: { quantity: true },
    });

  const violation = checkoutQuotaViolation({
    recentOrders,
    pendingOrders,
    activeReservedQuantity: activeReservations._sum.quantity ?? 0,
    requestedReservedQuantity,
  });
  if (!violation) return;

  throw orderError(
    "CHECKOUT_LIMIT_REACHED",
    violation === "RECENT"
      ? "Too many orders were created recently. Please wait before trying again."
      : "This account has reached its pending-order reservation limit. Complete or resolve an existing order before trying again.",
    429,
    true,
  );
}
