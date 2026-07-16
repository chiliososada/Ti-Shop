import { describe, expect, it } from "vitest";

import {
  addMinorAmounts,
  formatUsdMinor,
  MAX_POSTGRES_BIGINT,
  multiplyMinorAmount,
} from "@/domain/money";

describe("minor-unit money", () => {
  it("calculates line and order totals entirely with bigint cents", () => {
    const first = multiplyMinorAmount(BigInt(1_999), 3);
    const second = multiplyMinorAmount(BigInt(250), 2);

    expect(first).toBe(BigInt(5_997));
    expect(addMinorAmounts([first, second])).toBe(BigInt(6_497));
    expect(formatUsdMinor(BigInt(6_497))).toBe("$64.97");
  });

  it("rejects negative, unsafe, and PostgreSQL bigint-overflow values", () => {
    expect(() => multiplyMinorAmount(BigInt(-1), 1)).toThrow(RangeError);
    expect(() => multiplyMinorAmount(BigInt(100), 0)).toThrow(RangeError);
    expect(() => addMinorAmounts([MAX_POSTGRES_BIGINT, BigInt(1)])).toThrow(
      RangeError,
    );
  });
});

