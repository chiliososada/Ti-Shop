import "server-only";

import {
  parseNowPaymentsRuntimeConfig,
  type NowPaymentsRuntimeConfig,
} from "@/server/payments/nowpayments/config";

let cachedConfig: NowPaymentsRuntimeConfig | undefined;

export function getNowPaymentsRuntimeConfig() {
  cachedConfig ??= parseNowPaymentsRuntimeConfig(
    {
      NOWPAYMENTS_MODE: process.env.NOWPAYMENTS_MODE,
      NOWPAYMENTS_API_BASE_URL: process.env.NOWPAYMENTS_API_BASE_URL,
      NOWPAYMENTS_API_KEY: process.env.NOWPAYMENTS_API_KEY,
      NOWPAYMENTS_IPN_SECRET: process.env.NOWPAYMENTS_IPN_SECRET,
      NOWPAYMENTS_TIMEOUT_MS: process.env.NOWPAYMENTS_TIMEOUT_MS,
    },
    process.env.NODE_ENV,
  );
  return cachedConfig;
}

export function isNowPaymentsRuntimeOperational() {
  try {
    return getNowPaymentsRuntimeConfig().mode !== "disabled";
  } catch {
    return false;
  }
}
