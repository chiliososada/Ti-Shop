export const CHECKOUT_QUOTA = {
  recentWindowMilliseconds: 10 * 60 * 1_000,
  maximumRecentOrders: 5,
  maximumPendingOrders: 20,
  maximumActiveReservedQuantity: 200,
} as const;

export function checkoutQuotaViolation({
  recentOrders,
  pendingOrders,
  activeReservedQuantity,
  requestedReservedQuantity,
}: {
  recentOrders: number;
  pendingOrders: number;
  activeReservedQuantity: number;
  requestedReservedQuantity: number;
}) {
  if (recentOrders >= CHECKOUT_QUOTA.maximumRecentOrders) return "RECENT";
  if (pendingOrders >= CHECKOUT_QUOTA.maximumPendingOrders) return "PENDING";
  if (
    activeReservedQuantity + requestedReservedQuantity >
    CHECKOUT_QUOTA.maximumActiveReservedQuantity
  ) {
    return "INVENTORY";
  }
  return null;
}

