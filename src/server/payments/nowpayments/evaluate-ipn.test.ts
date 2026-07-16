import { describe, expect, it } from "vitest";

import { evaluateNowPaymentsPayload } from "@/server/payments/nowpayments/evaluate-ipn";
import { nowPaymentsPaymentPayloadSchema } from "@/server/payments/nowpayments/schemas";

function payload(overrides: Record<string, unknown> = {}) {
  return nowPaymentsPaymentPayloadSchema.parse({
    payment_id: 123,
    parent_payment_id: null,
    invoice_id: 456,
    payment_status: "finished",
    price_amount: 46,
    price_currency: "usd",
    pay_amount: 0.001,
    actually_paid: 0.001,
    actually_paid_at_fiat: null,
    pay_currency: "btc",
    pay_address: null,
    payin_extra_id: null,
    outcome_amount: null,
    outcome_currency: null,
    order_id: "TI-TEST-1",
    purchase_id: 789,
    ...overrides,
  });
}

describe("NOWPayments IPN integrity evaluation", () => {
  const expected = {
    orderNumber: "TI-TEST-1",
    currency: "USD",
    amountMinor: BigInt(4_600),
  };

  it("accepts an exact finished payment as paid", () => {
    expect(evaluateNowPaymentsPayload(payload(), expected)).toMatchObject({
      integrityIssues: [],
      priceAmountMinor: BigInt(4_600),
      decision: { paymentStatus: "CONFIRMED", orderPaymentStatus: "PAID" },
    });
  });

  it.each([
    [{ order_id: "OTHER" }, "ORDER_REFERENCE_MISMATCH"],
    [{ price_currency: "eur" }, "PRICE_CURRENCY_MISMATCH"],
    [{ price_amount: "45.99" }, "PRICE_AMOUNT_MISMATCH"],
    [{ parent_payment_id: 999 }, "REPEATED_DEPOSIT"],
  ] as const)("forces review for provider integrity mismatch", (override, issue) => {
    expect(evaluateNowPaymentsPayload(payload(override), expected)).toMatchObject({
      integrityIssues: [issue],
      decision: {
        paymentStatus: "REVIEW_REQUIRED",
        orderPaymentStatus: "PENDING",
      },
    });
  });

  it.each([
    [{ actually_paid: "0.0009" }, "INCOMPLETE_PROVIDER_AMOUNT"],
    [{ actually_paid: null }, "INCOMPLETE_PROVIDER_AMOUNT"],
    [{ pay_currency: null }, "MISSING_PAYMENT_ASSET"],
  ] as const)(
    "never marks an incomplete finished payload paid",
    (override, issue) => {
      expect(evaluateNowPaymentsPayload(payload(override), expected)).toMatchObject({
        integrityIssues: [issue],
        decision: {
          paymentStatus: "REVIEW_REQUIRED",
          orderPaymentStatus: "PENDING",
        },
      });
    },
  );
});
