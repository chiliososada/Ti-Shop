import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isStaleNowPaymentsInitialization } from "@/server/payments/nowpayments/initialize";

describe("NOWPayments initialization recovery window", () => {
  const now = Date.parse("2026-07-13T12:00:00Z");

  it("keeps a recent in-flight initialization protected from duplicate calls", () => {
    expect(
      isStaleNowPaymentsInitialization("2026-07-13T11:50:01Z", now),
    ).toBe(false);
  });

  it("moves missing, invalid, future, and stale claims to review", () => {
    expect(isStaleNowPaymentsInitialization(null, now)).toBe(true);
    expect(isStaleNowPaymentsInitialization("invalid", now)).toBe(true);
    expect(
      isStaleNowPaymentsInitialization("2026-07-13T12:02:00Z", now),
    ).toBe(true);
    expect(
      isStaleNowPaymentsInitialization("2026-07-13T11:45:00Z", now),
    ).toBe(true);
  });
});
