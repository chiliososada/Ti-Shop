export type PaymentMethodOperationalState = {
  isEnabled: boolean;
  settingKey: string | null;
  setting: { value: unknown } | null;
};

/** A linked boolean site setting acts as an additional kill switch. */
export function isPaymentMethodOperational(
  state: PaymentMethodOperationalState,
) {
  if (!state.isEnabled) return false;
  if (!state.settingKey) return true;
  return state.setting?.value === true;
}
