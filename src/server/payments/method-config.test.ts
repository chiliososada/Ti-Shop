import { describe, expect, it } from "vitest";

import { isPaymentMethodOperational } from "./method-config";

describe("payment method operational state", () => {
  it("requires the method itself to be enabled", () => {
    expect(
      isPaymentMethodOperational({
        isEnabled: false,
        settingKey: null,
        setting: null,
      }),
    ).toBe(false);
  });

  it("honors a linked boolean kill switch", () => {
    expect(
      isPaymentMethodOperational({
        isEnabled: true,
        settingKey: "commerce.online_payments_enabled",
        setting: { value: false },
      }),
    ).toBe(false);
    expect(
      isPaymentMethodOperational({
        isEnabled: true,
        settingKey: "commerce.online_payments_enabled",
        setting: { value: true },
      }),
    ).toBe(true);
  });

  it("allows enabled manual methods that have no linked switch", () => {
    expect(
      isPaymentMethodOperational({
        isEnabled: true,
        settingKey: null,
        setting: null,
      }),
    ).toBe(true);
  });
});
