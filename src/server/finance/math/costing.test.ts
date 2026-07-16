import { describe, expect, it } from "vitest";

import {
  averageUnitCostUsdMinor,
  consumeStock,
  receiveStock,
  writeOffStock,
  ZERO_COST_STATE,
  type CostState,
} from "@/server/finance/math/costing";

const b = BigInt;

describe("moving weighted average costing", () => {
  it("averages purchases made at different CNY prices and FX rates", () => {
    // Purchase 1: 10 units, $10.00 total cost each -> $100.00
    let state: CostState = receiveStock(ZERO_COST_STATE, 10, b(10_000)).state;
    expect(averageUnitCostUsdMinor(state)).toBe(b(1_000));

    // Purchase 2 (different price/rate): 5 units at $16.00 each -> $80.00
    state = receiveStock(state, 5, b(8_000)).state;
    // (100 + 80) / 15 = $12.00
    expect(averageUnitCostUsdMinor(state)).toBe(b(1_200));
    expect(state.quantity).toBe(15);
    expect(state.totalCostUsdMinor).toBe(b(18_000));
  });

  it("consumes at the current average and keeps totals exact", () => {
    let state = receiveStock(ZERO_COST_STATE, 3, b(1_000)).state; // 333.33.. per unit
    const first = consumeStock(state, 1);
    expect(first.cogsUsdMinor).toBe(b(333));
    expect(first.unitCostUsdMinor).toBe(b(333));
    state = first.state;
    expect(state.totalCostUsdMinor).toBe(b(667));

    const drain = consumeStock(state, 2);
    // Draining transfers the exact remaining total — no lost cent.
    expect(drain.cogsUsdMinor).toBe(b(667));
    expect(drain.state.quantity).toBe(0);
    expect(drain.state.totalCostUsdMinor).toBe(b(0));
  });

  it("re-stocks cleanly after the state reaches zero", () => {
    let state = receiveStock(ZERO_COST_STATE, 2, b(500)).state;
    state = consumeStock(state, 2).state;
    expect(state).toEqual({ quantity: 0, totalCostUsdMinor: b(0) });
    state = receiveStock(state, 4, b(4_000)).state;
    expect(averageUnitCostUsdMinor(state)).toBe(b(1_000));
  });

  it("reports uncovered quantity when consuming beyond valued stock", () => {
    const state = receiveStock(ZERO_COST_STATE, 2, b(2_000)).state;
    const result = consumeStock(state, 5);
    expect(result.coveredQuantity).toBe(2);
    expect(result.uncoveredQuantity).toBe(3);
    expect(result.cogsUsdMinor).toBe(b(2_000));
    expect(result.state.quantity).toBe(0);
  });

  it("returns zero cost when there is no valued stock at all", () => {
    const result = consumeStock(ZERO_COST_STATE, 3);
    expect(result.cogsUsdMinor).toBe(b(0));
    expect(result.coveredQuantity).toBe(0);
    expect(result.uncoveredQuantity).toBe(3);
  });

  it("write-offs remove value with the same math as consumption", () => {
    const state = receiveStock(ZERO_COST_STATE, 4, b(4_001)).state;
    const writeOff = writeOffStock(state, 1);
    expect(writeOff.cogsUsdMinor).toBe(b(1_000)); // 1000.25 -> 1000
    expect(writeOff.state.totalCostUsdMinor).toBe(b(3_001));
  });

  it("restocking a customer return at its snapshot cost restores value", () => {
    let state = receiveStock(ZERO_COST_STATE, 10, b(10_000)).state;
    const sale = consumeStock(state, 2);
    state = sale.state;
    expect(state.totalCostUsdMinor).toBe(b(8_000));
    // Return restock at the sale's snapshot cost.
    state = receiveStock(state, 2, sale.cogsUsdMinor).state;
    expect(state.quantity).toBe(10);
    expect(state.totalCostUsdMinor).toBe(b(10_000));
  });

  it("rejects invalid quantities and negative costs", () => {
    expect(() => receiveStock(ZERO_COST_STATE, 0, b(1))).toThrow(/positive/u);
    expect(() => receiveStock(ZERO_COST_STATE, 1, b(-1))).toThrow(/negative/u);
    expect(() => consumeStock(ZERO_COST_STATE, -1)).toThrow(/positive/u);
    expect(() =>
      consumeStock({ quantity: -1, totalCostUsdMinor: b(0) }, 1),
    ).toThrow(/non-negative/u);
  });
});
