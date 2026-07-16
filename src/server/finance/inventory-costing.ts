import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  consumeStock,
  receiveStock,
  ZERO_COST_STATE,
  type ConsumptionResult,
  type CostState,
} from "@/server/finance/math/costing";

/**
 * Transactional persistence for the moving-weighted-average valuation. Every
 * change appends an InventoryCostEntry journal row; the state row carries the
 * exact running quantity + total cost. Callers run inside a SERIALIZABLE
 * transaction (concurrent receipts/consumptions retry through the standard
 * withSerializableRetry wrapper), and idempotency keys make redelivery safe.
 */

type CostEntryContext = {
  entryType:
    | "PROCUREMENT_RECEIPT"
    | "PROCUREMENT_RETURN"
    | "SALE_CONSUMPTION"
    | "RETURN_RESTOCK"
    | "RETURN_DAMAGED"
    | "RETURN_DISPOSAL"
    | "CUSTOMER_COMPENSATION"
    | "WARRANTY_REPLACEMENT"
    | "GOODWILL_GIFT"
    | "WRITE_OFF"
    | "MANUAL_ADJUSTMENT";
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  reason?: string;
  actorUserId?: string | null;
  occurredAt?: Date;
};

async function readState(
  tx: Prisma.TransactionClient,
  variantId: bigint,
): Promise<CostState> {
  const row = await tx.inventoryCostState.findUnique({
    where: { variantId },
    select: { quantity: true, totalCostUsdMinor: true },
  });
  return row
    ? { quantity: row.quantity, totalCostUsdMinor: row.totalCostUsdMinor }
    : ZERO_COST_STATE;
}

async function writeState(
  tx: Prisma.TransactionClient,
  variantId: bigint,
  state: CostState,
): Promise<void> {
  await tx.inventoryCostState.upsert({
    where: { variantId },
    create: {
      variantId,
      quantity: state.quantity,
      totalCostUsdMinor: state.totalCostUsdMinor,
    },
    update: {
      quantity: state.quantity,
      totalCostUsdMinor: state.totalCostUsdMinor,
    },
    select: { id: true },
  });
}

async function alreadyApplied(
  tx: Prisma.TransactionClient,
  idempotencyKey: string,
): Promise<boolean> {
  const existing = await tx.inventoryCostEntry.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });
  return existing !== null;
}

async function appendEntry(
  tx: Prisma.TransactionClient,
  variantId: bigint,
  context: CostEntryContext,
  quantityDelta: number,
  costDeltaUsdMinor: bigint,
  after: CostState,
): Promise<void> {
  await tx.inventoryCostEntry.create({
    data: {
      variantId,
      entryType: context.entryType,
      quantityDelta,
      costDeltaUsdMinor,
      quantityAfter: after.quantity,
      totalCostAfterUsdMinor: after.totalCostUsdMinor,
      referenceType: context.referenceType,
      referenceId: context.referenceId,
      idempotencyKey: context.idempotencyKey,
      reason: context.reason ?? null,
      createdByUserId: context.actorUserId ?? null,
      occurredAt: context.occurredAt ?? new Date(),
    },
    select: { id: true },
  });
}

/** Adds valued stock (procurement receipts, return restocks). Idempotent. */
export async function applyCostReceipt(
  tx: Prisma.TransactionClient,
  input: {
    variantId: bigint;
    quantity: number;
    totalCostUsdMinor: bigint;
  } & CostEntryContext,
): Promise<{ applied: boolean; state: CostState }> {
  if (await alreadyApplied(tx, input.idempotencyKey)) {
    return { applied: false, state: await readState(tx, input.variantId) };
  }
  const before = await readState(tx, input.variantId);
  const { state } = receiveStock(before, input.quantity, input.totalCostUsdMinor);
  await writeState(tx, input.variantId, state);
  await appendEntry(tx, input.variantId, input, input.quantity, input.totalCostUsdMinor, state);
  return { applied: true, state };
}

/**
 * Removes valued stock at the moving average (sales, gifts, damage,
 * disposal). Returns the COGS snapshot for the consuming document. Idempotent:
 * a redelivered key reports applied=false and zeroed amounts so callers must
 * not double-book costs.
 */
export async function applyCostConsumption(
  tx: Prisma.TransactionClient,
  input: {
    variantId: bigint;
    quantity: number;
  } & CostEntryContext,
): Promise<{ applied: boolean; result: ConsumptionResult | null }> {
  if (await alreadyApplied(tx, input.idempotencyKey)) {
    return { applied: false, result: null };
  }
  const before = await readState(tx, input.variantId);
  const result = consumeStock(before, input.quantity);
  await writeState(tx, input.variantId, result.state);
  await appendEntry(
    tx,
    input.variantId,
    input,
    -result.coveredQuantity,
    -result.cogsUsdMinor,
    result.state,
  );
  return { applied: true, result };
}
