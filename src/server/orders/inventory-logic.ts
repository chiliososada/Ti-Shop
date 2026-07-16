export type LockedInventoryLevel = {
  id: bigint;
  onHandQuantity: number;
  reservedQuantity: number;
  safetyStockQuantity: number;
  allowBackorder: boolean;
};

export type InventoryAllocation = {
  levelId: bigint;
  quantity: number;
};

export function hasCompleteTrackedInventoryReservations(
  items: ReadonlyArray<{
    id: bigint;
    quantity: number;
    trackInventory: boolean;
  }>,
  reservations: ReadonlyArray<{
    orderItemId: bigint | null;
    quantity: number;
  }>,
) {
  const reservedByOrderItem = new Map<bigint, number>();
  for (const reservation of reservations) {
    if (reservation.orderItemId === null) continue;
    reservedByOrderItem.set(
      reservation.orderItemId,
      (reservedByOrderItem.get(reservation.orderItemId) ?? 0) +
        reservation.quantity,
    );
  }

  return items.every(
    (item) =>
      !item.trackInventory ||
      reservedByOrderItem.get(item.id) === item.quantity,
  );
}

export function allocateInventory(
  levels: readonly LockedInventoryLevel[],
  requestedQuantity: number,
) {
  if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1) {
    throw new RangeError("Inventory allocation quantity must be positive.");
  }

  let remaining = requestedQuantity;
  const allocations: InventoryAllocation[] = [];

  for (const level of levels) {
    const available = Math.max(
      0,
      level.onHandQuantity -
        level.reservedQuantity -
        level.safetyStockQuantity,
    );
    const quantity = Math.min(available, remaining);
    if (quantity > 0) {
      allocations.push({ levelId: level.id, quantity });
      remaining -= quantity;
    }
    if (remaining === 0) break;
  }

  if (remaining > 0) {
    const backorderLevel = levels.find((level) => level.allowBackorder);
    if (backorderLevel) {
      const existing = allocations.find(
        (allocation) => allocation.levelId === backorderLevel.id,
      );
      if (existing) existing.quantity += remaining;
      else allocations.push({ levelId: backorderLevel.id, quantity: remaining });
      remaining = 0;
    }
  }

  return { allocations, remaining };
}
