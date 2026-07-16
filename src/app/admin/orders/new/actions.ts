"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

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
  ADMIN_MANUAL_ORDER_FORM_FIELDS,
  adminManualOrderFormSchema,
} from "@/server/admin/orders/manual-order-input";
import { createAdminManualOrder } from "@/server/admin/orders/manual-order-mutations";
import { OrderServiceError } from "@/server/orders/errors";

type ManualOrderActionState = AdminActionState & {
  refreshPending?: boolean;
};

const MAX_MANUAL_ORDER_REVALIDATION_TARGETS = 4;

function revalidateManualOrder(
  orderPublicId: string,
  errorScope: `${string}.cache-refresh`,
) {
  const targets = new Set([
    "/admin/orders",
    `/admin/orders/${orderPublicId}`,
    "/account/orders",
    `/account/orders/${orderPublicId}`,
  ]);
  let refreshPending = false;

  if (targets.size > MAX_MANUAL_ORDER_REVALIDATION_TARGETS) {
    refreshPending = true;
    logUnexpectedAdminActionError(
      errorScope,
      new Error("Manual-order cache refresh target limit was exceeded."),
    );
  }

  for (const path of [...targets].slice(
    0,
    MAX_MANUAL_ORDER_REVALIDATION_TARGETS,
  )) {
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

function manualOrderFailure(error: OrderServiceError) {
  if (error.code === "ADMIN_AUTHORIZATION_CHANGED") {
    return actionFailure(
      "Your administrator access changed before the order was created. Refresh and sign in again if access was restored.",
    );
  }
  if (error.code === "CUSTOMER_INELIGIBLE") {
    return actionFailure(
      "The customer is no longer eligible. Choose a verified, active US customer account.",
    );
  }
  if (error.code === "ADDRESS_UNAVAILABLE") {
    return actionFailure(
      "The saved address is no longer available or valid. Refresh and choose another address.",
    );
  }
  if (error.code === "IDEMPOTENCY_CONFLICT") {
    return actionFailure(
      "This form submission was already used for different order details. Refresh before retrying.",
    );
  }
  if (
    error.code === "PAYMENT_METHOD_UNAVAILABLE" ||
    error.code === "CHECKOUT_CONFIGURATION_INCOMPLETE"
  ) {
    return actionFailure(
      "The selected payment method or checkout charges are no longer operational. Review payment settings and refresh.",
    );
  }
  if (
    error.code === "PRODUCT_UNAVAILABLE" ||
    error.code === "QUOTE_REQUIRED" ||
    error.code === "PRICE_UNAVAILABLE" ||
    error.code === "MINIMUM_ORDER_QUANTITY_NOT_MET"
  ) {
    return actionFailure(
      "A selected product, price, or minimum quantity changed. Refresh and review the order items.",
    );
  }
  if (error.code === "OUT_OF_STOCK") {
    return actionFailure(
      "The requested inventory is no longer available. Refresh and adjust the quantities.",
    );
  }
  if (error.code === "CHECKOUT_LIMIT_REACHED") {
    return actionFailure(
      "This customer has reached the active checkout reservation limit. Resolve or expire an earlier pending order first.",
    );
  }
  return actionFailure("The pending manual order could not be created. Try again.");
}

export async function createManualOrderAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<ManualOrderActionState> {
  const fields = readStrictFormData(
    formData,
    ADMIN_MANUAL_ORDER_FORM_FIELDS,
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = adminManualOrderFormSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof createAdminManualOrder>>;
  try {
    result = await createAdminManualOrder(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof OrderServiceError) return manualOrderFailure(error);
    logUnexpectedAdminActionError("orders.manual.create", error);
    return actionFailure("The pending manual order could not be created. Try again.");
  }

  const refreshPending = revalidateManualOrder(
    result.order.publicId,
    "orders.manual.create.cache-refresh",
  );
  if (refreshPending) {
    return {
      ...actionSuccess(`Pending order ${result.order.orderNumber} created.`),
      message: `Pending order ${result.order.orderNumber} created. The database operation is committed, but one or more affected page refreshes may be delayed. Do not resubmit solely to retry the refresh; open the order list and reload the affected page later.`,
      refreshPending: true,
    };
  }

  redirect(`/admin/orders/${result.order.publicId}`);
}
