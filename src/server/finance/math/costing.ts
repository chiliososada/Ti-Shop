import { divideRoundHalfUp } from "@/server/finance/math/rounding";

/**
 * Moving-weighted-average inventory valuation, computed as pure state
 * transitions. The state keeps total quantity and total USD cost; the average
 * unit cost is always derived, never stored rounded, so no drift accumulates
 * across receipts.
 */
export type CostState = {
  quantity: number;
  totalCostUsdMinor: bigint;
};

export const ZERO_COST_STATE: CostState = { quantity: 0, totalCostUsdMinor: BigInt(0) };

function assertState(state: CostState): void {
  if (!Number.isSafeInteger(state.quantity) || state.quantity < 0) {
    throw new RangeError("Cost state quantity must be a non-negative integer.");
  }
  if (state.totalCostUsdMinor < BigInt(0)) {
    throw new RangeError("Cost state total cost must not be negative.");
  }
}

function assertQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new RangeError("Quantity must be a positive integer.");
  }
}

/** Derived average unit cost in USD cents (half-up), null for empty stock. */
export function averageUnitCostUsdMinor(state: CostState): bigint | null {
  assertState(state);
  if (state.quantity === 0) return null;
  return divideRoundHalfUp(state.totalCostUsdMinor, BigInt(state.quantity));
}

export type ReceiptResult = {
  state: CostState;
  costDeltaUsdMinor: bigint;
};

/**
 * Receives stock at a known total cost (procurement receipt, restock at a
 * snapshot cost). New average = (old total + received total) / (old qty +
 * received qty) — implicitly, since the state stores the exact totals.
 */
export function receiveStock(
  state: CostState,
  quantity: number,
  totalCostUsdMinor: bigint,
): ReceiptResult {
  assertState(state);
  assertQuantity(quantity);
  if (totalCostUsdMinor < BigInt(0)) {
    throw new RangeError("Received stock cost must not be negative.");
  }
  return {
    state: {
      quantity: state.quantity + quantity,
      totalCostUsdMinor: state.totalCostUsdMinor + totalCostUsdMinor,
    },
    costDeltaUsdMinor: totalCostUsdMinor,
  };
}

export type ConsumptionResult = {
  state: CostState;
  /** COGS for the covered units, at the pre-consumption moving average. */
  cogsUsdMinor: bigint;
  /** Unit-cost snapshot (half-up) recorded on the consuming document. */
  unitCostUsdMinor: bigint;
  /** Units actually covered by valued stock. */
  coveredQuantity: number;
  /** Units consumed beyond valued stock (backorder/untracked); zero cost. */
  uncoveredQuantity: number;
};

/**
 * Consumes stock at the current moving average. Draining the state exactly
 * transfers the exact remaining total (no residual cents). Consuming more
 * than the valued quantity covers what exists and reports the shortfall so
 * callers can flag the result as estimated.
 */
export function consumeStock(state: CostState, quantity: number): ConsumptionResult {
  assertState(state);
  assertQuantity(quantity);

  const coveredQuantity = Math.min(quantity, state.quantity);
  const uncoveredQuantity = quantity - coveredQuantity;

  if (coveredQuantity === 0) {
    return {
      state,
      cogsUsdMinor: BigInt(0),
      unitCostUsdMinor: BigInt(0),
      coveredQuantity,
      uncoveredQuantity,
    };
  }

  const cogsUsdMinor =
    coveredQuantity === state.quantity
      ? state.totalCostUsdMinor
      : divideRoundHalfUp(
          state.totalCostUsdMinor * BigInt(coveredQuantity),
          BigInt(state.quantity),
        );
  const unitCostUsdMinor = divideRoundHalfUp(cogsUsdMinor, BigInt(coveredQuantity));

  return {
    state: {
      quantity: state.quantity - coveredQuantity,
      totalCostUsdMinor: state.totalCostUsdMinor - cogsUsdMinor,
    },
    cogsUsdMinor,
    unitCostUsdMinor,
    coveredQuantity,
    uncoveredQuantity,
  };
}

/**
 * Writes stock out of the valuation without a sale (damage, disposal,
 * write-off). Identical math to consumption; the caller decides how the
 * removed cost is expensed.
 */
export const writeOffStock = consumeStock;
