export const CHECKOUT_PAYMENT_METHODS = [
  "NOWPAYMENTS",
  "WIRE_TRANSFER",
  "ZELLE",
  "OTHER_MANUAL",
] as const;

export type CheckoutPaymentMethod =
  (typeof CHECKOUT_PAYMENT_METHODS)[number];

export const MANUAL_PAYMENT_METHODS = [
  "WIRE_TRANSFER",
  "ZELLE",
  "OTHER_MANUAL",
] as const satisfies readonly CheckoutPaymentMethod[];

export function isManualPaymentMethod(
  method: CheckoutPaymentMethod,
): method is (typeof MANUAL_PAYMENT_METHODS)[number] {
  return (MANUAL_PAYMENT_METHODS as readonly string[]).includes(method);
}

export const PAYMENT_METHOD_LABELS: Record<CheckoutPaymentMethod, string> = {
  NOWPAYMENTS: "NOWPayments",
  WIRE_TRANSFER: "Electronic wire transfer",
  ZELLE: "Zelle",
  OTHER_MANUAL: "Manual payment arrangement",
};

export function humanizeCommerceStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export type EnabledPaymentMethodDto = {
  method: CheckoutPaymentMethod;
  displayName: string;
};

export type CustomerOrderSummaryDto = {
  publicId: string;
  orderNumber: string;
  currency: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  totalMinor: string;
  itemCount: number;
  createdAt: string;
};

export type CustomerOrderDetailDto = CustomerOrderSummaryDto & {
  customerEmail: string;
  subtotalMinor: string;
  discountMinor: string;
  shippingMinor: string;
  taxMinor: string;
  items: Array<{
    productName: string;
    productSlug: string | null;
    variantName: string | null;
    sku: string | null;
    quantity: number;
    fulfilledQuantity: number;
    unitPriceMinor: string;
    lineTotalMinor: string;
    currency: string;
  }>;
  addresses: Array<{
    kind: string;
    recipientName: string;
    company: string | null;
    line1: string;
    line2: string | null;
    city: string;
    region: string;
    postalCode: string;
    countryCode: string;
    phone: string | null;
  }>;
  payments: Array<{
    publicId: string;
    method: CheckoutPaymentMethod;
    status: string;
    amountMinor: string;
    currency: string;
    createdAt: string;
    updatedAt: string;
    publicInstructions: string | null;
  }>;
  shipments: Array<{
    publicId: string;
    shipmentNumber: string;
    status: string;
    carrierName: string | null;
    serviceLevel: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
    estimatedDeliveryAt: string | null;
    packages: Array<{
      publicId: string;
      packageNumber: number;
      weightGrams: number | null;
      lengthMillimeters: number | null;
      widthMillimeters: number | null;
      heightMillimeters: number | null;
    }>;
    events: Array<{
      publicId: string;
      status: string;
      message: string | null;
      location: string | null;
      occurredAt: string;
    }>;
  }>;
};
