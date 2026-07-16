import "server-only";

import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import {
  checkoutChargesValueSchema,
  isSafePublicPaymentInstructions,
} from "@/server/admin/payments/validators";
import { getNowPaymentsRuntimeConfig } from "@/server/payments/nowpayments/runtime-config";

const ONLINE_PAYMENT_SWITCH_KEY = "commerce.online_payments_enabled";
const CHECKOUT_CHARGES_KEY = "commerce.checkout_charges";

export async function getAdminPaymentSettings() {
  const authorization = await requirePermission(
    "payments.read",
    "/admin/payments",
  );
  const [methods, onlinePaymentSwitch, checkoutChargesSetting] = await Promise.all([
    getDb().paymentMethodConfig.findMany({
      orderBy: [{ method: "asc" }],
      select: {
        method: true,
        displayName: true,
        isEnabled: true,
        publicInstructions: true,
        updatedAt: true,
      },
    }),
    getDb().siteSetting.findUnique({
      where: { key: ONLINE_PAYMENT_SWITCH_KEY },
      select: { key: true, value: true, updatedAt: true },
    }),
    getDb().siteSetting.findUnique({
      where: { key: CHECKOUT_CHARGES_KEY },
      select: { key: true, value: true, updatedAt: true },
    }),
  ]);
  const checkoutCharges = checkoutChargesSetting
    ? checkoutChargesValueSchema.safeParse(checkoutChargesSetting.value)
    : null;
  let nowPaymentsRuntime:
    | { valid: true; mode: "disabled" | "mock" | "sandbox" | "production" }
    | { valid: false; mode: "invalid" };
  try {
    nowPaymentsRuntime = {
      valid: true,
      mode: getNowPaymentsRuntimeConfig().mode,
    };
  } catch {
    nowPaymentsRuntime = { valid: false, mode: "invalid" };
  }

  return {
    methods: methods.map((method) => ({
      method: method.method,
      displayName: method.displayName,
      isEnabled: method.isEnabled,
      publicInstructions: isSafePublicPaymentInstructions(
        method.method,
        method.publicInstructions,
      )
        ? method.publicInstructions
        : null,
      publicInstructionsRejected: !isSafePublicPaymentInstructions(
        method.method,
        method.publicInstructions,
      ),
      updatedAt: method.updatedAt.toISOString(),
    })),
    onlinePaymentSwitch: onlinePaymentSwitch
      ? {
          key: onlinePaymentSwitch.key,
          isEnabled: onlinePaymentSwitch.value === true,
          updatedAt: onlinePaymentSwitch.updatedAt.toISOString(),
        }
      : null,
    checkoutCharges:
      checkoutChargesSetting && checkoutCharges?.success
        ? {
            key: checkoutChargesSetting.key,
            ...checkoutCharges.data,
            updatedAt: checkoutChargesSetting.updatedAt.toISOString(),
          }
        : null,
    checkoutChargesInvalid:
      checkoutChargesSetting !== null && checkoutCharges?.success === false,
    nowPaymentsRuntime,
    canManagePaymentMethods: authorization.permissions.has("payments.manage"),
    canManageOnlinePaymentSwitch:
      authorization.permissions.has("settings.manage"),
  };
}
