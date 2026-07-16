import { compareDecimal } from "@/server/payments/nowpayments/decimal";

export type LocalPaymentStatus =
  | "CREATED"
  | "PENDING"
  | "AWAITING_CONFIRMATION"
  | "PROCESSING"
  | "PARTIALLY_PAID"
  | "OVERPAID"
  | "REVIEW_REQUIRED"
  | "CONFIRMED"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELED";

export type LocalOrderPaymentStatus =
  | "UNPAID"
  | "PENDING"
  | "PARTIALLY_PAID"
  | "PAID"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "FAILED"
  | "VOIDED";

export type NowPaymentsStatusDecision = {
  providerStatus: string;
  paymentStatus: LocalPaymentStatus;
  orderPaymentStatus: LocalOrderPaymentStatus;
  final: boolean;
  requiresReview: boolean;
};

function normalizeStatus(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/gu, "_");
}

export function mapNowPaymentsStatus(
  rawStatus: string,
  amounts?: { payAmount?: string | null; actuallyPaid?: string | null },
): NowPaymentsStatusDecision {
  const providerStatus = normalizeStatus(rawStatus);

  switch (providerStatus) {
    case "waiting":
      return {
        providerStatus,
        paymentStatus: "PENDING",
        orderPaymentStatus: "PENDING",
        final: false,
        requiresReview: false,
      };
    case "confirming":
    case "confirmed":
      return {
        providerStatus,
        paymentStatus: "AWAITING_CONFIRMATION",
        orderPaymentStatus: "PENDING",
        final: false,
        requiresReview: false,
      };
    case "sending":
      return {
        providerStatus,
        paymentStatus: "PROCESSING",
        orderPaymentStatus: "PENDING",
        final: false,
        requiresReview: false,
      };
    case "partially_paid":
      return {
        providerStatus,
        paymentStatus: "PARTIALLY_PAID",
        orderPaymentStatus: "PARTIALLY_PAID",
        final: true,
        requiresReview: true,
      };
    case "finished": {
      const overpaid =
        amounts?.payAmount && amounts.actuallyPaid
          ? compareDecimal(amounts.actuallyPaid, amounts.payAmount) > 0
          : false;
      return {
        providerStatus,
        paymentStatus: overpaid ? "OVERPAID" : "CONFIRMED",
        orderPaymentStatus: "PAID",
        final: true,
        requiresReview: overpaid,
      };
    }
    case "refunded":
      return {
        providerStatus,
        paymentStatus: "REFUNDED",
        orderPaymentStatus: "REFUNDED",
        final: true,
        requiresReview: false,
      };
    case "failed":
      return {
        providerStatus,
        paymentStatus: "FAILED",
        orderPaymentStatus: "FAILED",
        final: true,
        requiresReview: true,
      };
    case "expired":
      return {
        providerStatus,
        paymentStatus: "EXPIRED",
        orderPaymentStatus: "FAILED",
        final: true,
        requiresReview: false,
      };
    case "cancelled":
    case "canceled":
      return {
        providerStatus,
        paymentStatus: "CANCELED",
        orderPaymentStatus: "VOIDED",
        final: true,
        requiresReview: true,
      };
    case "wrong_asset_confirmed":
      return {
        providerStatus,
        paymentStatus: "REVIEW_REQUIRED",
        orderPaymentStatus: "PENDING",
        final: false,
        requiresReview: true,
      };
    default:
      return {
        providerStatus,
        paymentStatus: "REVIEW_REQUIRED",
        orderPaymentStatus: "PENDING",
        final: false,
        requiresReview: true,
      };
  }
}

export function aggregateOrderPaymentStatus(
  statuses: readonly LocalPaymentStatus[],
): LocalOrderPaymentStatus {
  if (statuses.some((status) => status === "CONFIRMED" || status === "OVERPAID")) {
    return "PAID";
  }
  if (statuses.some((status) => status === "PARTIALLY_PAID")) {
    return "PARTIALLY_PAID";
  }
  if (statuses.some((status) => status === "PARTIALLY_REFUNDED")) {
    return "PARTIALLY_REFUNDED";
  }
  if (statuses.some((status) => status === "REFUNDED")) {
    return "REFUNDED";
  }
  if (
    statuses.some((status) =>
      [
        "CREATED",
        "PENDING",
        "AWAITING_CONFIRMATION",
        "PROCESSING",
        "REVIEW_REQUIRED",
      ].includes(status),
    )
  ) {
    return "PENDING";
  }
  if (statuses.length > 0 && statuses.every((status) => status === "CANCELED")) {
    return "VOIDED";
  }
  if (
    statuses.some((status) => status === "FAILED" || status === "EXPIRED")
  ) {
    return "FAILED";
  }
  return "UNPAID";
}

export function resolvePaymentStatusTransition(
  current: LocalPaymentStatus,
  incoming: LocalPaymentStatus,
): LocalPaymentStatus {
  if (current === incoming) {
    return current;
  }
  if (incoming === "REVIEW_REQUIRED") {
    return incoming;
  }
  if (current === "REFUNDED") {
    return current;
  }
  if (incoming === "REFUNDED" || incoming === "PARTIALLY_REFUNDED") {
    return incoming;
  }
  if (incoming === "OVERPAID") {
    return incoming;
  }
  if (incoming === "CONFIRMED") {
    return current === "OVERPAID" ? current : incoming;
  }
  if (current === "CONFIRMED" || current === "OVERPAID") {
    return current;
  }
  if (
    current === "REVIEW_REQUIRED" &&
    ["CREATED", "PENDING", "AWAITING_CONFIRMATION", "PROCESSING"].includes(
      incoming,
    )
  ) {
    return current;
  }
  if (current === "PARTIALLY_PAID") {
    return current;
  }
  if (
    ["FAILED", "EXPIRED", "CANCELED"].includes(current) &&
    ["CREATED", "PENDING", "AWAITING_CONFIRMATION", "PROCESSING"].includes(
      incoming,
    )
  ) {
    return current;
  }
  return incoming;
}
