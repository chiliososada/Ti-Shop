import { describe, expect, it } from "vitest";

import { computePartnerShare } from "@/server/finance/math/settlement";

const b = BigInt;

describe("computePartnerShare", () => {
  it("splits positive profit 50/50 using basis points", () => {
    const result = computePartnerShare({
      periodProfitUsdMinor: b(100_000), // $1000.00
      carryoverInUsdMinor: b(0),
      shareBps: 5_000,
    });
    expect(result.distributableUsdMinor).toBe(b(100_000));
    expect(result.partnerShareUsdMinor).toBe(b(50_000));
    expect(result.ownerShareUsdMinor).toBe(b(50_000));
    expect(result.carryoverOutUsdMinor).toBe(b(0));
  });

  it("assigns the odd cent deterministically (half-up on the partner share)", () => {
    const result = computePartnerShare({
      periodProfitUsdMinor: b(101), // $1.01
      carryoverInUsdMinor: b(0),
      shareBps: 5_000,
    });
    // 50.5 cents rounds half-up to 51 for the partner; owner gets 50.
    expect(result.partnerShareUsdMinor).toBe(b(51));
    expect(result.ownerShareUsdMinor).toBe(b(50));
    expect(result.partnerShareUsdMinor + result.ownerShareUsdMinor).toBe(b(101));
  });

  it("produces no positive share on losses and carries the loss forward", () => {
    const result = computePartnerShare({
      periodProfitUsdMinor: b(-40_000),
      carryoverInUsdMinor: b(0),
      shareBps: 5_000,
    });
    expect(result.partnerShareUsdMinor).toBe(b(0));
    expect(result.ownerShareUsdMinor).toBe(b(0));
    expect(result.carryoverOutUsdMinor).toBe(b(-40_000));
  });

  it("nets carried-over losses against later profit", () => {
    const result = computePartnerShare({
      periodProfitUsdMinor: b(100_000),
      carryoverInUsdMinor: b(-40_000),
      shareBps: 5_000,
    });
    expect(result.distributableUsdMinor).toBe(b(60_000));
    expect(result.partnerShareUsdMinor).toBe(b(30_000));
    expect(result.ownerShareUsdMinor).toBe(b(30_000));
    expect(result.carryoverOutUsdMinor).toBe(b(0));
  });

  it("keeps carrying forward when the carryover exceeds the period profit", () => {
    const result = computePartnerShare({
      periodProfitUsdMinor: b(10_000),
      carryoverInUsdMinor: b(-25_000),
      shareBps: 5_000,
    });
    expect(result.distributableUsdMinor).toBe(b(-15_000));
    expect(result.partnerShareUsdMinor).toBe(b(0));
    expect(result.carryoverOutUsdMinor).toBe(b(-15_000));
  });

  it("models post-settlement refunds as next-period negative adjustments", () => {
    // Period 1: $500 profit settled and paid.
    const period1 = computePartnerShare({
      periodProfitUsdMinor: b(50_000),
      carryoverInUsdMinor: b(0),
      shareBps: 5_000,
    });
    expect(period1.partnerShareUsdMinor).toBe(b(25_000));

    // Later a $600 refund hits an already-settled order: period 2 profit is
    // -$600 + new $200 profit = -$400 distributable → nothing to share and
    // the balance carries on, so the partner is never double-paid.
    const period2 = computePartnerShare({
      periodProfitUsdMinor: b(-60_000) + b(20_000),
      carryoverInUsdMinor: b(0),
      shareBps: 5_000,
    });
    expect(period2.partnerShareUsdMinor).toBe(b(0));
    expect(period2.carryoverOutUsdMinor).toBe(b(-40_000));

    // Period 3 recovers: $900 profit − $400 carryover → $500 distributable.
    const period3 = computePartnerShare({
      periodProfitUsdMinor: b(90_000),
      carryoverInUsdMinor: period2.carryoverOutUsdMinor,
      shareBps: 5_000,
    });
    expect(period3.partnerShareUsdMinor).toBe(b(25_000));
  });

  it("rejects positive carryover and invalid share rates", () => {
    expect(() =>
      computePartnerShare({
        periodProfitUsdMinor: b(0),
        carryoverInUsdMinor: b(1),
        shareBps: 5_000,
      }),
    ).toThrow(/never positive/u);
    expect(() =>
      computePartnerShare({
        periodProfitUsdMinor: b(0),
        carryoverInUsdMinor: b(0),
        shareBps: 10_001,
      }),
    ).toThrow(/partner share/u);
  });
});
