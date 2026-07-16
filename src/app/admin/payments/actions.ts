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
  updateAdminCheckoutCharges,
  updateAdminOnlinePaymentSwitch,
  updateAdminPaymentMethodConfig,
} from "@/server/admin/payments/mutations";
import {
  CHECKOUT_CHARGES_FORM_FIELDS,
  checkoutChargesSchema,
  ONLINE_PAYMENT_SWITCH_FORM_FIELDS,
  onlinePaymentSwitchSchema,
  PAYMENT_METHOD_CONFIG_FORM_FIELDS,
  paymentMethodConfigSchema,
} from "@/server/admin/payments/validators";

type PaymentsActionState = AdminActionState & {
  refreshPending?: boolean;
};

type RevalidationTarget = {
  path: string;
  type?: "page" | "layout";
};

const MAX_PAYMENT_REVALIDATION_TARGETS = 4;

function revalidatePaymentSettings(
  errorScope: `${string}.cache-refresh`,
  { customerOrderPages = false } = {},
) {
  const candidates: RevalidationTarget[] = [
    { path: "/admin/payments" },
    { path: "/checkout" },
    ...(customerOrderPages
      ? [{ path: "/account/orders/[publicId]", type: "page" as const }]
      : []),
    { path: "/admin" },
  ];
  const targets = new Map<string, RevalidationTarget>();
  for (const target of candidates) {
    targets.set(`${target.path}:${target.type ?? "literal"}`, target);
  }
  let refreshPending = false;

  if (targets.size > MAX_PAYMENT_REVALIDATION_TARGETS) {
    refreshPending = true;
    logUnexpectedAdminActionError(
      errorScope,
      new Error("Payment cache refresh target limit was exceeded."),
    );
  }

  for (const target of [...targets.values()].slice(
    0,
    MAX_PAYMENT_REVALIDATION_TARGETS,
  )) {
    try {
      revalidatePath(target.path, target.type);
    } catch (error) {
      unstable_rethrow(error);
      refreshPending = true;
      logUnexpectedAdminActionError(errorScope, error);
    }
  }

  return refreshPending;
}

function committedPaymentSuccess(
  message: string,
  refreshPending: boolean,
): PaymentsActionState {
  if (!refreshPending) return actionSuccess(message);
  return {
    status: "success",
    message: `${message} The database operation is committed, but one or more affected page refreshes may be delayed. Do not resubmit solely to retry the refresh; reload the affected page later.`,
    refreshPending: true,
  };
}

export async function updatePaymentMethodConfigAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<PaymentsActionState> {
  const fields = readStrictFormData(
    formData,
    PAYMENT_METHOD_CONFIG_FORM_FIELDS,
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = paymentMethodConfigSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminPaymentMethodConfig>>;
  try {
    result = await updateAdminPaymentMethodConfig(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("payments.method_config.update", error);
    return actionFailure("Payment method settings could not be saved.");
  }
  if (!result.ok) {
    return actionFailure("The payment method could not be found.");
  }
  const refreshPending = revalidatePaymentSettings(
    "payments.method_config.update.cache-refresh",
    { customerOrderPages: true },
  );
  return committedPaymentSuccess(
    "Payment method settings saved.",
    refreshPending,
  );
}

export async function updateOnlinePaymentSwitchAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<PaymentsActionState> {
  const fields = readStrictFormData(
    formData,
    ONLINE_PAYMENT_SWITCH_FORM_FIELDS,
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = onlinePaymentSwitchSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminOnlinePaymentSwitch>>;
  try {
    result = await updateAdminOnlinePaymentSwitch(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("settings.online_payments.update", error);
    return actionFailure("The online payment switch could not be saved.");
  }
  if (!result.ok) {
    return actionFailure("The online payment switch is not configured.");
  }
  const refreshPending = revalidatePaymentSettings(
    "settings.online_payments.update.cache-refresh",
  );
  return committedPaymentSuccess(
    result.isEnabled
      ? "Online payment initiation enabled."
      : "Online payment initiation disabled.",
    refreshPending,
  );
}

export async function updateCheckoutChargesAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<PaymentsActionState> {
  const fields = readStrictFormData(formData, CHECKOUT_CHARGES_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = checkoutChargesSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminCheckoutCharges>>;
  try {
    result = await updateAdminCheckoutCharges(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("settings.checkout_charges.update", error);
    return actionFailure("Checkout charge settings could not be saved.");
  }
  if (!result.ok) {
    return actionFailure("Checkout charge settings are not configured.");
  }
  const refreshPending = revalidatePaymentSettings(
    "settings.checkout_charges.update.cache-refresh",
  );
  return committedPaymentSuccess(
    "Checkout charge settings saved.",
    refreshPending,
  );
}
