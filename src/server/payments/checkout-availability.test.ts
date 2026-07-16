import { describe, expect, it } from "vitest";

import { isCheckoutPaymentMethodAvailable } from "./checkout-availability";

const enabledOnlineState = {
  isEnabled: true,
  settingKey: "commerce.online_payments_enabled",
  setting: { value: true },
};

describe("checkout payment-method availability", () => {
  it("keeps NOWPayments unavailable when its runtime is disabled", () => {
    expect(
      isCheckoutPaymentMethodAvailable(
        "NOWPAYMENTS",
        enabledOnlineState,
        false,
      ),
    ).toBe(false);
  });

  it("requires both database switches and a usable NOWPayments runtime", () => {
    expect(
      isCheckoutPaymentMethodAvailable(
        "NOWPAYMENTS",
        enabledOnlineState,
        true,
      ),
    ).toBe(true);
    expect(
      isCheckoutPaymentMethodAvailable(
        "NOWPAYMENTS",
        { ...enabledOnlineState, setting: { value: false } },
        true,
      ),
    ).toBe(false);
    expect(
      isCheckoutPaymentMethodAvailable(
        "NOWPAYMENTS",
        { ...enabledOnlineState, isEnabled: false },
        true,
      ),
    ).toBe(false);
  });

  it("does not make manual methods depend on NOWPayments configuration", () => {
    expect(
      isCheckoutPaymentMethodAvailable(
        "WIRE_TRANSFER",
        { isEnabled: true, settingKey: null, setting: null },
        false,
      ),
    ).toBe(true);
  });
});
