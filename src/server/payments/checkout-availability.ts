import type { CheckoutPaymentMethod } from "@/domain/order";
import {
  isPaymentMethodOperational,
  type PaymentMethodOperationalState,
} from "@/server/payments/method-config";

/**
 * Database switches are necessary but insufficient for a provider-backed
 * method: checkout must also be able to initialize the provider at runtime.
 */
export function isCheckoutPaymentMethodAvailable(
  method: CheckoutPaymentMethod,
  state: PaymentMethodOperationalState,
  nowPaymentsRuntimeOperational: boolean,
) {
  if (!isPaymentMethodOperational(state)) return false;
  return method !== "NOWPAYMENTS" || nowPaymentsRuntimeOperational;
}
