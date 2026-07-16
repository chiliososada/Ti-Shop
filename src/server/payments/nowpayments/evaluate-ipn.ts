import { createHash } from "node:crypto";

import type { NowPaymentsPaymentPayload } from "@/server/payments/nowpayments/schemas";
import {
  canonicalizeNowPaymentsPayload,
} from "@/server/payments/nowpayments/canonical-json";
import {
  compareDecimal,
  usdDecimalToMinor,
} from "@/server/payments/nowpayments/decimal";
import {
  mapNowPaymentsStatus,
  type NowPaymentsStatusDecision,
} from "@/server/payments/nowpayments/status";

export type NowPaymentsIntegrityIssue =
  | "ORDER_REFERENCE_MISMATCH"
  | "PRICE_CURRENCY_MISMATCH"
  | "PRICE_AMOUNT_MISMATCH"
  | "INVALID_PRICE_AMOUNT"
  | "INCOMPLETE_PROVIDER_AMOUNT"
  | "MISSING_PAYMENT_ASSET"
  | "REPEATED_DEPOSIT"
  | "UNKNOWN_OR_REVIEW_STATUS";

export type EvaluatedNowPaymentsPayload = {
  decision: NowPaymentsStatusDecision;
  integrityIssues: NowPaymentsIntegrityIssue[];
  priceAmountMinor: bigint | null;
};

export function nowPaymentsEventFingerprint(
  source: "ipn" | "reconcile",
  rawPayload: unknown,
) {
  const digest = createHash("sha256")
    .update(`${source}:`)
    .update(canonicalizeNowPaymentsPayload(rawPayload))
    .digest("hex");
  return `nowpayments:${source}:${digest}`;
}

export function evaluateNowPaymentsPayload(
  payload: NowPaymentsPaymentPayload,
  expected: {
    orderNumber: string;
    currency: string;
    amountMinor: bigint;
  },
): EvaluatedNowPaymentsPayload {
  const integrityIssues: NowPaymentsIntegrityIssue[] = [];
  let priceAmountMinor: bigint | null = null;

  if (payload.order_id !== expected.orderNumber) {
    integrityIssues.push("ORDER_REFERENCE_MISMATCH");
  }
  if (payload.price_currency.toUpperCase() !== expected.currency.toUpperCase()) {
    integrityIssues.push("PRICE_CURRENCY_MISMATCH");
  }
  try {
    priceAmountMinor = usdDecimalToMinor(payload.price_amount);
    if (priceAmountMinor !== expected.amountMinor) {
      integrityIssues.push("PRICE_AMOUNT_MISMATCH");
    }
  } catch {
    integrityIssues.push("INVALID_PRICE_AMOUNT");
  }
  if (payload.parent_payment_id !== null) {
    integrityIssues.push("REPEATED_DEPOSIT");
  }

  const normalizedStatus = payload.payment_status
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, "_");
  if (normalizedStatus === "finished") {
    try {
      if (
        !payload.pay_amount ||
        !payload.actually_paid ||
        compareDecimal(payload.pay_amount, "0") <= 0 ||
        compareDecimal(payload.actually_paid, payload.pay_amount) < 0
      ) {
        integrityIssues.push("INCOMPLETE_PROVIDER_AMOUNT");
      }
    } catch {
      integrityIssues.push("INCOMPLETE_PROVIDER_AMOUNT");
    }
    if (!payload.pay_currency) {
      integrityIssues.push("MISSING_PAYMENT_ASSET");
    }
  }

  let decision = mapNowPaymentsStatus(payload.payment_status, {
    payAmount: payload.pay_amount,
    actuallyPaid: payload.actually_paid,
  });
  if (decision.paymentStatus === "REVIEW_REQUIRED") {
    integrityIssues.push("UNKNOWN_OR_REVIEW_STATUS");
  }

  if (integrityIssues.length > 0) {
    decision = {
      ...decision,
      paymentStatus: "REVIEW_REQUIRED",
      orderPaymentStatus: "PENDING",
      final: false,
      requiresReview: true,
    };
  }

  return { decision, integrityIssues, priceAmountMinor };
}
