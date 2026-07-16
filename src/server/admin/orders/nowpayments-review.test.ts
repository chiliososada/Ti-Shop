import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { validateNowPaymentsProviderLink } from "@/server/admin/orders/nowpayments-review";
import type { NowPaymentsPaymentPayload } from "@/server/payments/nowpayments/schemas";

const payload: NowPaymentsPaymentPayload = {
  payment_id: "provider-payment-1",
  parent_payment_id: null,
  invoice_id: "provider-invoice-1",
  payment_status: "waiting",
  price_amount: "59.18",
  price_currency: "usd",
  pay_amount: "0.001",
  actually_paid: "0",
  actually_paid_at_fiat: "0",
  pay_currency: "btc",
  pay_address: null,
  payin_extra_id: null,
  order_id: "SA-TEST-1",
  purchase_id: null,
  outcome_amount: null,
  outcome_currency: null,
};

const expected = {
  providerPaymentId: "provider-payment-1",
  providerInvoiceId: "provider-invoice-1",
  orderNumber: "SA-TEST-1",
  currency: "USD",
  amountMinor: BigInt(5_918),
};

describe("NOWPayments admin provider-link validation", () => {
  it("accepts only the exact payment and invoice identity", () => {
    expect(validateNowPaymentsProviderLink(payload, expected)).toEqual({
      ok: true,
    });
    expect(
      validateNowPaymentsProviderLink(
        { ...payload, payment_id: "different-payment" },
        expected,
      ),
    ).toEqual({ ok: false, reason: "payment_id_mismatch" });
    expect(
      validateNowPaymentsProviderLink(
        { ...payload, invoice_id: "different-invoice" },
        expected,
      ),
    ).toEqual({ ok: false, reason: "invoice_id_mismatch" });
  });

  it("rejects provider data that mismatches the local order, currency, or amount", () => {
    const result = validateNowPaymentsProviderLink(
      {
        ...payload,
        order_id: "OTHER-ORDER",
        price_currency: "eur",
        price_amount: "1.00",
      },
      expected,
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "provider_integrity_mismatch",
      integrityIssues: [
        "ORDER_REFERENCE_MISMATCH",
        "PRICE_CURRENCY_MISMATCH",
        "PRICE_AMOUNT_MISMATCH",
      ],
    });
  });

  it("allows an unknown provider status to link only into review", () => {
    expect(
      validateNowPaymentsProviderLink(
        { ...payload, payment_status: "provider_new_review_state" },
        expected,
      ),
    ).toEqual({ ok: true });
  });
});
