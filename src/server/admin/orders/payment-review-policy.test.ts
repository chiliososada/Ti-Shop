import { describe, expect, it } from "vitest";

import {
  isExternallyRefundableManualPayment,
  isManualAdminPaymentMethod,
  isReviewableManualPayment,
  shouldClosePendingOrderAfterPaymentReview,
} from "@/server/admin/orders/payment-review-policy";

describe("manual payment review policy", () => {
  it("permits only pending manual methods", () => {
    for (const method of ["WIRE_TRANSFER", "ZELLE", "OTHER_MANUAL"]) {
      expect(isManualAdminPaymentMethod(method)).toBe(true);
      expect(isReviewableManualPayment(method, "PENDING")).toBe(true);
      expect(isReviewableManualPayment(method, "REVIEW_REQUIRED")).toBe(true);
      expect(isReviewableManualPayment(method, "CONFIRMED")).toBe(false);
    }
  });

  it("never permits NOWPayments provider state changes", () => {
    expect(isManualAdminPaymentMethod("NOWPAYMENTS")).toBe(false);
    for (const status of ["PENDING", "REVIEW_REQUIRED", "CONFIRMED"]) {
      expect(isReviewableManualPayment("NOWPAYMENTS", status)).toBe(false);
    }
  });

  it("records external refunds only for confirmed wire or Zelle payments", () => {
    for (const method of ["WIRE_TRANSFER", "ZELLE"]) {
      expect(isExternallyRefundableManualPayment(method, "CONFIRMED")).toBe(
        true,
      );
      expect(isExternallyRefundableManualPayment(method, "PENDING")).toBe(
        false,
      );
      expect(isExternallyRefundableManualPayment(method, "REFUNDED")).toBe(
        false,
      );
    }
    expect(
      isExternallyRefundableManualPayment("OTHER_MANUAL", "CONFIRMED"),
    ).toBe(false);
    expect(
      isExternallyRefundableManualPayment("NOWPAYMENTS", "CONFIRMED"),
    ).toBe(false);
  });

  it("closes only an unpaid pending order whose attempts are terminal", () => {
    expect(
      shouldClosePendingOrderAfterPaymentReview("PENDING_PAYMENT", "FAILED"),
    ).toBe(true);
    expect(
      shouldClosePendingOrderAfterPaymentReview("PENDING_PAYMENT", "VOIDED"),
    ).toBe(true);
    expect(
      shouldClosePendingOrderAfterPaymentReview("PENDING_PAYMENT", "PENDING"),
    ).toBe(false);
    expect(
      shouldClosePendingOrderAfterPaymentReview("CONFIRMED", "FAILED"),
    ).toBe(false);
  });
});
