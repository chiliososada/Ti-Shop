import { describe, expect, it } from "vitest";

import {
  aggregateOrderPaymentStatus,
  mapNowPaymentsStatus,
  resolvePaymentStatusTransition,
} from "@/server/payments/nowpayments/status";

describe("NOWPayments status mapping", () => {
  it.each([
    ["waiting", "PENDING", "PENDING"],
    ["confirming", "AWAITING_CONFIRMATION", "PENDING"],
    ["confirmed", "AWAITING_CONFIRMATION", "PENDING"],
    ["sending", "PROCESSING", "PENDING"],
    ["partially_paid", "PARTIALLY_PAID", "PARTIALLY_PAID"],
    ["finished", "CONFIRMED", "PAID"],
    ["failed", "FAILED", "FAILED"],
    ["refunded", "REFUNDED", "REFUNDED"],
    ["expired", "EXPIRED", "FAILED"],
    ["cancelled", "CANCELED", "VOIDED"],
    ["wrong asset confirmed", "REVIEW_REQUIRED", "PENDING"],
  ] as const)("maps %s without declaring intermediate states paid", (raw, payment, order) => {
    expect(mapNowPaymentsStatus(raw)).toMatchObject({
      paymentStatus: payment,
      orderPaymentStatus: order,
    });
  });

  it("detects a finished overpayment with decimal precision", () => {
    expect(
      mapNowPaymentsStatus("finished", {
        payAmount: "0.00000001",
        actuallyPaid: "0.000000010000000001",
      }),
    ).toMatchObject({
      paymentStatus: "OVERPAID",
      orderPaymentStatus: "PAID",
      requiresReview: true,
    });
  });

  it("fails unknown provider statuses closed", () => {
    expect(mapNowPaymentsStatus("brand_new_status")).toMatchObject({
      paymentStatus: "REVIEW_REQUIRED",
      orderPaymentStatus: "PENDING",
      requiresReview: true,
    });
  });

  it("aggregates multiple attempts without letting a failed attempt override payment", () => {
    expect(aggregateOrderPaymentStatus(["FAILED", "PENDING"])).toBe("PENDING");
    expect(aggregateOrderPaymentStatus(["FAILED", "CONFIRMED"])).toBe("PAID");
    expect(aggregateOrderPaymentStatus(["PARTIALLY_PAID", "PENDING"])).toBe(
      "PARTIALLY_PAID",
    );
  });

  it("does not regress a finished payment when IPNs arrive out of order", () => {
    expect(resolvePaymentStatusTransition("CONFIRMED", "PENDING")).toBe(
      "CONFIRMED",
    );
    expect(resolvePaymentStatusTransition("OVERPAID", "CONFIRMED")).toBe(
      "OVERPAID",
    );
    expect(resolvePaymentStatusTransition("CONFIRMED", "REFUNDED")).toBe(
      "REFUNDED",
    );
    expect(resolvePaymentStatusTransition("CONFIRMED", "REVIEW_REQUIRED")).toBe(
      "REVIEW_REQUIRED",
    );
    expect(resolvePaymentStatusTransition("REVIEW_REQUIRED", "PENDING")).toBe(
      "REVIEW_REQUIRED",
    );
    expect(resolvePaymentStatusTransition("REVIEW_REQUIRED", "CONFIRMED")).toBe(
      "CONFIRMED",
    );
  });
});
