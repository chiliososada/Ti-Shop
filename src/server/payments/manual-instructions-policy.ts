type ManualInstructionState = {
  orderStatus: string;
  orderPaymentStatus: string;
  paymentStatus: string;
};

const OPEN_ORDER_PAYMENT_STATUSES = new Set([
  "UNPAID",
  "PENDING",
  "PARTIALLY_PAID",
]);

const OPEN_PAYMENT_ATTEMPT_STATUSES = new Set([
  "CREATED",
  "PENDING",
  "AWAITING_CONFIRMATION",
]);

/**
 * Recipient details are useful only while the authenticated customer's order
 * can still accept that manual payment. Historical payment/order rows remain
 * visible, but their instructions must not remain a standing disclosure after
 * confirmation, cancellation, failure, expiry, or refund.
 */
export function canExposeManualPaymentInstructions(
  state: ManualInstructionState,
) {
  return (
    state.orderStatus === "PENDING_PAYMENT" &&
    OPEN_ORDER_PAYMENT_STATUSES.has(state.orderPaymentStatus) &&
    OPEN_PAYMENT_ATTEMPT_STATUSES.has(state.paymentStatus)
  );
}
