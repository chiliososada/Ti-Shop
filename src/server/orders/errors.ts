import "server-only";

export type OrderErrorCode =
  | "AUTH_REQUIRED"
  | "CROSS_ORIGIN_REQUEST"
  | "INVALID_CONTENT_TYPE"
  | "INVALID_REQUEST"
  | "REQUEST_TOO_LARGE"
  | "IDEMPOTENCY_CONFLICT"
  | "ADMIN_AUTHORIZATION_CHANGED"
  | "CUSTOMER_INELIGIBLE"
  | "ADDRESS_UNAVAILABLE"
  | "PAYMENT_METHOD_UNAVAILABLE"
  | "PRODUCT_UNAVAILABLE"
  | "QUOTE_REQUIRED"
  | "PRICE_UNAVAILABLE"
  | "MINIMUM_ORDER_QUANTITY_NOT_MET"
  | "CHECKOUT_CONFIGURATION_INCOMPLETE"
  | "OUT_OF_STOCK"
  | "CHECKOUT_LIMIT_REACHED"
  | "ORDER_NOT_FOUND"
  | "ORDER_CREATE_FAILED";

export class OrderServiceError extends Error {
  constructor(
    readonly code: OrderErrorCode,
    message: string,
    readonly status: number,
    readonly contactWhatsApp = false,
  ) {
    super(message);
    this.name = "OrderServiceError";
  }
}

export function orderError(
  code: OrderErrorCode,
  message: string,
  status: number,
  contactWhatsApp = false,
) {
  return new OrderServiceError(code, message, status, contactWhatsApp);
}
