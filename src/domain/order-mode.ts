/**
 * How the storefront takes orders. "whatsapp" routes every purchase action
 * to a prefilled WhatsApp conversation (staff then create the order in the
 * admin); "checkout" restores the self-service cart → checkout flow.
 */
export const ORDER_MODES = ["whatsapp", "checkout"] as const;

export type OrderMode = (typeof ORDER_MODES)[number];

export const DEFAULT_ORDER_MODE: OrderMode = "whatsapp";

export function parseOrderMode(value: unknown): OrderMode {
  return value === "checkout" || value === "whatsapp"
    ? value
    : DEFAULT_ORDER_MODE;
}
