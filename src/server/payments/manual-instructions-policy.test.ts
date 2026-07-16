import { describe, expect, it } from "vitest";

import { canExposeManualPaymentInstructions } from "@/server/payments/manual-instructions-policy";

describe("manual payment instruction disclosure policy", () => {
  it.each([
    ["PENDING", "PENDING"],
    ["UNPAID", "CREATED"],
    ["PARTIALLY_PAID", "AWAITING_CONFIRMATION"],
  ])(
    "allows an open pending-payment order (%s / %s)",
    (orderPaymentStatus, paymentStatus) => {
      expect(
        canExposeManualPaymentInstructions({
          orderStatus: "PENDING_PAYMENT",
          orderPaymentStatus,
          paymentStatus,
        }),
      ).toBe(true);
    },
  );

  it.each([
    ["CANCELED", "PENDING", "PENDING"],
    ["CONFIRMED", "PAID", "CONFIRMED"],
    ["COMPLETED", "REFUNDED", "REFUNDED"],
    ["PENDING_PAYMENT", "FAILED", "FAILED"],
    ["PENDING_PAYMENT", "VOIDED", "EXPIRED"],
  ])(
    "hides instructions for closed state %s / %s / %s",
    (orderStatus, orderPaymentStatus, paymentStatus) => {
      expect(
        canExposeManualPaymentInstructions({
          orderStatus,
          orderPaymentStatus,
          paymentStatus,
        }),
      ).toBe(false);
    },
  );
});
