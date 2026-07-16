"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import {
  actionFailure,
  actionSuccess,
  formDataFailure,
  logUnexpectedAdminActionError,
  type AdminActionState,
  validationFailure,
} from "@/server/admin/audit/action-state";
import { readStrictFormData } from "@/server/admin/audit/form-data";
import {
  recordAdminManualPaymentRefund,
  reviewAdminManualPayment,
} from "@/server/admin/orders/mutations";
import {
  cancelAdminUnlinkedNowPaymentsPayment,
  linkAdminNowPaymentsProviderPayment,
} from "@/server/admin/orders/nowpayments-review";
import {
  MANUAL_PAYMENT_REVIEW_FORM_FIELDS,
  MANUAL_PAYMENT_REFUND_FORM_FIELDS,
  NOWPAYMENTS_CANCEL_UNLINKED_FORM_FIELDS,
  NOWPAYMENTS_LINK_FORM_FIELDS,
  manualPaymentReviewSchema,
  manualPaymentRefundSchema,
  nowPaymentsCancelUnlinkedSchema,
  nowPaymentsLinkSchema,
} from "@/server/admin/orders/validators";

type OrdersActionState = AdminActionState & {
  refreshPending?: boolean;
};

const MAX_ORDER_REVALIDATION_TARGETS = 7;

function revalidateOrderSurfaces(
  orderPublicId: string,
  errorScope: `${string}.cache-refresh`,
) {
  const targets = new Set([
    "/admin/orders",
    `/admin/orders/${orderPublicId}`,
    "/account/orders",
    `/account/orders/${orderPublicId}`,
    "/admin/fulfillment",
    `/admin/fulfillment/orders/${orderPublicId}`,
    "/admin",
  ]);
  let refreshPending = false;

  if (targets.size > MAX_ORDER_REVALIDATION_TARGETS) {
    refreshPending = true;
    logUnexpectedAdminActionError(
      errorScope,
      new Error("Order cache refresh target limit was exceeded."),
    );
  }

  for (const path of [...targets].slice(0, MAX_ORDER_REVALIDATION_TARGETS)) {
    try {
      revalidatePath(path);
    } catch (error) {
      unstable_rethrow(error);
      refreshPending = true;
      logUnexpectedAdminActionError(errorScope, error);
    }
  }

  return refreshPending;
}

function committedOrderSuccess(
  message: string,
  refreshPending: boolean,
): OrdersActionState {
  if (!refreshPending) return actionSuccess(message);
  return {
    status: "success",
    message: `${message} The database operation is committed, but one or more affected page refreshes may be delayed. Do not resubmit solely to retry the refresh; reload the affected page later.`,
    refreshPending: true,
  };
}

export async function reviewManualPaymentAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<OrdersActionState> {
  const fields = readStrictFormData(
    formData,
    MANUAL_PAYMENT_REVIEW_FORM_FIELDS,
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = manualPaymentReviewSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof reviewAdminManualPayment>>;
  try {
    result = await reviewAdminManualPayment(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("payments.manual.review", error);
    return actionFailure(
      "The payment review could not be saved. Refresh and try again.",
    );
  }
  if (!result.ok) {
    if (result.reason === "not_manual") {
      return actionFailure(
        "NOWPayments and other provider-managed payments cannot be changed here.",
      );
    }
    if (result.reason === "not_reviewable" || result.reason === "conflict") {
      return actionFailure(
        "This payment is no longer awaiting manual review. Refresh the order.",
      );
    }
    if (result.reason === "order_not_payable") {
      return actionFailure(
        "This order is no longer awaiting payment. A late transfer requires a separate refund or exception review.",
      );
    }
    return actionFailure("The payment could not be found.");
  }

  const message =
    result.decision === "CONFIRM"
      ? `Payment confirmed for ${result.orderNumber}.`
      : `Payment rejected for ${result.orderNumber}.`;
  const refreshPending = revalidateOrderSurfaces(
    result.orderPublicId,
    "payments.manual.review.cache-refresh",
  );
  return committedOrderSuccess(message, refreshPending);
}

export async function recordManualPaymentRefundAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<OrdersActionState> {
  const fields = readStrictFormData(
    formData,
    MANUAL_PAYMENT_REFUND_FORM_FIELDS,
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = manualPaymentRefundSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof recordAdminManualPaymentRefund>>;
  try {
    result = await recordAdminManualPaymentRefund(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("payments.manual.external-refund", error);
    return actionFailure(
      "The external refund record could not be saved. Refresh and verify the order before retrying; do not assume that no change occurred.",
    );
  }
  if (!result.ok) {
    if (result.reason === "not_manual") {
      return actionFailure(
        "Only settled Wire transfer or Zelle payments can use this external-refund record.",
      );
    }
    if (
      result.reason === "not_refundable" ||
      result.reason === "already_refunded" ||
      result.reason === "conflict"
    ) {
      return actionFailure(
        "This payment is no longer eligible for refund recording. Refresh the order and inspect its event history.",
      );
    }
    if (result.reason === "order_not_refundable") {
      return actionFailure(
        "The order is not currently a paid confirmed, processing, or completed order.",
      );
    }
    if (result.reason === "not_full_order_payment") {
      return actionFailure(
        "This payment does not exactly cover the order total and currency. Use an exception review instead of recording a full refund.",
      );
    }
    if (result.reason === "other_payment_attempts_require_review") {
      return actionFailure(
        "Another non-terminal payment attempt exists on this order. Resolve it before recording a full refund.",
      );
    }
    if (result.reason === "cancel_pre_dispatch_shipments_first") {
      return actionFailure(
        "Cancel every draft or label-created shipment in Fulfillment first, then record the external refund.",
      );
    }
    return actionFailure("The payment could not be found.");
  }

  const message = result.duplicate
    ? `This external refund was already recorded for ${result.orderNumber}; no duplicate inventory or event changes were made.`
    : result.hasPhysicalDispatch
      ? `External refund recorded for ${result.orderNumber}. Funds were not sent by this site; dispatched inventory and tracking were preserved.`
      : result.inventoryRestoredQuantity > 0
        ? `External refund recorded for ${result.orderNumber}. Funds were not sent by this site; ${result.inventoryRestoredQuantity} unit(s) of tracked pre-dispatch inventory were restored.`
        : `External refund recorded for ${result.orderNumber}. Funds were not sent by this site; no tracked sale quantity required restoration.`;
  const refreshPending = revalidateOrderSurfaces(
    result.orderPublicId,
    "payments.manual.external-refund.cache-refresh",
  );
  return committedOrderSuccess(message, refreshPending);
}

export async function linkNowPaymentsProviderPaymentAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<OrdersActionState> {
  const fields = readStrictFormData(formData, NOWPAYMENTS_LINK_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = nowPaymentsLinkSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<
    ReturnType<typeof linkAdminNowPaymentsProviderPayment>
  >;
  try {
    result = await linkAdminNowPaymentsProviderPayment(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("payments.nowpayments.link", error);
    return actionFailure(
      "The provider-link request did not return a confirmed result. Refresh this order and verify provider state before retrying; do not assume that nothing changed.",
    );
  }
  if (!result.ok) {
    if (result.reason === "provider_unavailable") {
      return actionFailure(
        "NOWPayments is disabled or not configured on this deployment.",
      );
    }
    if (result.reason === "provider_mode_mismatch") {
      return actionFailure(
        "This invoice was created in a different NOWPayments environment. Restore the matching mode before reconciliation.",
      );
    }
    if (result.reason === "provider_lookup_failed") {
      return actionFailure(
        "NOWPayments did not return that payment ID. Verify the ID and provider environment.",
      );
    }
    if (
      result.reason === "payment_id_mismatch" ||
      result.reason === "invoice_id_mismatch" ||
      result.reason === "provider_integrity_mismatch"
    ) {
      return actionFailure(
        "The provider response does not exactly match this invoice, order, currency, and amount. Nothing was linked.",
      );
    }
    if (
      result.reason === "already_linked" ||
      result.reason === "not_unlinked_review"
    ) {
      return actionFailure(
        "This invoice is no longer awaiting a provider payment ID. Refresh the order.",
      );
    }
    return actionFailure("The NOWPayments review record could not be found.");
  }

  const message = `Provider payment linked for ${result.orderNumber}; current payment status is ${result.paymentStatus.toLowerCase().replaceAll("_", " ")}.`;
  const refreshPending = revalidateOrderSurfaces(
    result.orderPublicId,
    "payments.nowpayments.link.cache-refresh",
  );
  return committedOrderSuccess(message, refreshPending);
}

export async function cancelUnlinkedNowPaymentsPaymentAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<OrdersActionState> {
  const fields = readStrictFormData(
    formData,
    NOWPAYMENTS_CANCEL_UNLINKED_FORM_FIELDS,
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = nowPaymentsCancelUnlinkedSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<
    ReturnType<typeof cancelAdminUnlinkedNowPaymentsPayment>
  >;
  try {
    result = await cancelAdminUnlinkedNowPaymentsPayment(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("payments.nowpayments.cancel-unlinked", error);
    return actionFailure(
      "The invoice review could not be completed. Refresh and verify provider state again.",
    );
  }
  if (!result.ok) {
    if (result.reason === "invoice_mismatch") {
      return actionFailure(
        "The invoice ID does not exactly match this review record.",
      );
    }
    if (result.reason === "order_not_payable") {
      return actionFailure(
        "This order is no longer awaiting payment and cannot be canceled by this review action.",
      );
    }
    if (
      result.reason === "already_linked" ||
      result.reason === "not_unlinked_review" ||
      result.reason === "conflict"
    ) {
      return actionFailure(
        "This invoice is no longer an unresolved invoice-only payment. Refresh the order.",
      );
    }
    return actionFailure("The NOWPayments review record could not be found.");
  }

  const message = result.orderClosed
    ? `Unpaid provider invoice canceled and inventory released for ${result.orderNumber}.`
    : `Unpaid provider invoice canceled for ${result.orderNumber}; another payment attempt remains active.`;
  const refreshPending = revalidateOrderSurfaces(
    result.orderPublicId,
    "payments.nowpayments.cancel-unlinked.cache-refresh",
  );
  return committedOrderSuccess(message, refreshPending);
}
