import { describe, expect, it } from "vitest";

import {
  manualPaymentRefundSchema,
  manualPaymentReviewSchema,
} from "@/server/admin/orders/validators";

const PAYMENT_PUBLIC_ID = "00000000-0000-4000-8000-000000000001";

describe("manual payment review validator", () => {
  it("accepts only explicit confirm or reject decisions", () => {
    expect(
      manualPaymentReviewSchema.safeParse({
        paymentPublicId: PAYMENT_PUBLIC_ID,
        decision: "CONFIRM",
      }).success,
    ).toBe(true);
    expect(
      manualPaymentReviewSchema.safeParse({
        paymentPublicId: PAYMENT_PUBLIC_ID,
        decision: "APPROVE_NOWPAYMENTS",
      }).success,
    ).toBe(false);
  });

  it("rejects unsafe identifiers and extra fields", () => {
    expect(
      manualPaymentReviewSchema.safeParse({
        paymentPublicId: "not-a-public-id",
        decision: "REJECT",
      }).success,
    ).toBe(false);
    expect(
      manualPaymentReviewSchema.safeParse({
        paymentPublicId: PAYMENT_PUBLIC_ID,
        decision: "REJECT",
        method: "NOWPAYMENTS",
      }).success,
    ).toBe(false);
  });
});

describe("manual payment refund validator", () => {
  const valid = {
    paymentPublicId: PAYMENT_PUBLIC_ID,
    refundReference: "ZELLE-REFUND-2026-0001",
    note: "Customer confirmed receipt.",
    confirmation: "CONFIRM_EXTERNAL_REFUND_COMPLETED",
  };

  it("requires the external refund reference and exact confirmation", () => {
    expect(manualPaymentRefundSchema.safeParse(valid).success).toBe(true);
    expect(
      manualPaymentRefundSchema.safeParse({
        ...valid,
        refundReference: "   ",
      }).success,
    ).toBe(false);
    expect(
      manualPaymentRefundSchema.safeParse({
        ...valid,
        confirmation: "SEND_REFUND_NOW",
      }).success,
    ).toBe(false);
  });

  it("normalizes an empty note and rejects extra or control-character data", () => {
    const parsed = manualPaymentRefundSchema.parse({ ...valid, note: "  " });
    expect(parsed.note).toBeNull();
    expect(
      manualPaymentRefundSchema.safeParse({
        ...valid,
        refundReference: "BANK\nREFERENCE",
      }).success,
    ).toBe(false);
    expect(
      manualPaymentRefundSchema.safeParse({
        ...valid,
        amountMinor: "1000",
      }).success,
    ).toBe(false);
  });
});
