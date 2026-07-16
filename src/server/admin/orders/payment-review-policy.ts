import type { Prisma } from "@/generated/prisma/client";

const MANUAL_METHODS = ["WIRE_TRANSFER", "ZELLE", "OTHER_MANUAL"] as const;
const MANUAL_METHOD_SET = new Set<string>(MANUAL_METHODS);
const REVIEWABLE_STATUSES = new Set(["PENDING", "REVIEW_REQUIRED"]);
const EXTERNALLY_REFUNDABLE_METHODS = new Set(["WIRE_TRANSFER", "ZELLE"]);

/**
 * Orders that need a human payment decision: any attempt flagged for review,
 * or a manual attempt still waiting to be confirmed. Order.paymentStatus is an
 * aggregate and has no review state, so this must be expressed against the
 * attempts. Shared by the admin overview metric and the orders index filter so
 * the headline count and the filtered list can never disagree.
 */
export const PAYMENT_REVIEW_ORDER_WHERE: Prisma.OrderWhereInput = {
  payments: {
    some: {
      OR: [
        { status: "REVIEW_REQUIRED" },
        { method: { in: [...MANUAL_METHODS] }, status: "PENDING" },
      ],
    },
  },
};

export function isManualAdminPaymentMethod(method: string) {
  return MANUAL_METHOD_SET.has(method);
}

export function isReviewableManualPayment(method: string, status: string) {
  return (
    isManualAdminPaymentMethod(method) && REVIEWABLE_STATUSES.has(status)
  );
}

/**
 * A refund recorded here represents money already returned outside the site.
 * OTHER_MANUAL remains excluded until it has an explicit operational policy.
 */
export function isExternallyRefundableManualPayment(
  method: string,
  status: string,
) {
  return EXTERNALLY_REFUNDABLE_METHODS.has(method) && status === "CONFIRMED";
}

export function shouldClosePendingOrderAfterPaymentReview(
  orderStatus: string,
  orderPaymentStatus: string,
) {
  return (
    orderStatus === "PENDING_PAYMENT" &&
    (orderPaymentStatus === "FAILED" || orderPaymentStatus === "VOIDED")
  );
}
