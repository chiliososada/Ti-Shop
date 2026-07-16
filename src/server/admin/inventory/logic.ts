export type InventoryAdjustmentInput = {
  onHandQuantity: number;
  reservedQuantity: number;
  allowBackorder: boolean;
  quantityDelta: number;
};

export type InventoryAdjustmentResult =
  | { ok: true; onHandAfter: number }
  | {
      ok: false;
      reason: "invalid_quantity" | "negative_on_hand" | "below_reserved";
    };

const MAX_POSTGRES_INTEGER = 2_147_483_647;

export function calculateInventoryAdjustment(
  input: InventoryAdjustmentInput,
): InventoryAdjustmentResult {
  const values = [
    input.onHandQuantity,
    input.reservedQuantity,
    input.quantityDelta,
  ];
  if (!values.every(Number.isSafeInteger) || input.reservedQuantity < 0) {
    return { ok: false, reason: "invalid_quantity" };
  }

  const onHandAfter = input.onHandQuantity + input.quantityDelta;
  if (
    !Number.isSafeInteger(onHandAfter) ||
    onHandAfter > MAX_POSTGRES_INTEGER
  ) {
    return { ok: false, reason: "invalid_quantity" };
  }
  if (onHandAfter < 0) {
    return { ok: false, reason: "negative_on_hand" };
  }
  if (!input.allowBackorder && onHandAfter < input.reservedQuantity) {
    return { ok: false, reason: "below_reserved" };
  }

  return { ok: true, onHandAfter };
}

export function inventoryAdjustmentIdempotencyKey(
  actorUserId: string,
  submissionId: string,
) {
  return `admin-inventory-adjustment:${actorUserId}:${submissionId}`;
}
