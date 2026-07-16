import "server-only";

import { cache } from "react";
import { z } from "zod";

import {
  isManualPaymentMethod,
  PAYMENT_METHOD_LABELS,
  type CheckoutPaymentMethod,
  type CustomerOrderDetailDto,
  type CustomerOrderSummaryDto,
  type EnabledPaymentMethodDto,
} from "@/domain/order";
import { buildPagination, normalizePageOption } from "@/lib/pagination";
import { buildMerchantTrackingUrl } from "@/lib/tracking";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { parseConfiguredCheckoutCharges } from "@/server/orders/charges";
import { isSafePublicPaymentInstructions } from "@/server/admin/payments/validators";
import { isCheckoutPaymentMethodAvailable } from "@/server/payments/checkout-availability";
import { canExposeManualPaymentInstructions } from "@/server/payments/manual-instructions-policy";
import { isPaymentMethodOperational } from "@/server/payments/method-config";
import { isNowPaymentsRuntimeOperational } from "@/server/payments/nowpayments/runtime-config";
import { buildOwnedOrderWhere } from "@/server/orders/query-contracts";

const orderPublicIdSchema = z.string().uuid();

function isCheckoutPaymentMethod(value: string): value is CheckoutPaymentMethod {
  return Object.hasOwn(PAYMENT_METHOD_LABELS, value);
}

export async function getEnabledPaymentMethods(): Promise<
  EnabledPaymentMethodDto[]
> {
  const nowPaymentsOperational = isNowPaymentsRuntimeOperational();
  const rows = await getDb().paymentMethodConfig.findMany({
    where: { isEnabled: true },
    orderBy: [{ method: "asc" }],
    select: {
      method: true,
      displayName: true,
      isEnabled: true,
      settingKey: true,
      setting: { select: { value: true } },
    },
  });

  return rows
    .filter(
      (row) =>
        isCheckoutPaymentMethod(row.method) &&
        isCheckoutPaymentMethodAvailable(
          row.method,
          row,
          nowPaymentsOperational,
        ),
    )
    .map((row) => ({
      method: row.method,
      displayName:
        row.displayName.trim() || PAYMENT_METHOD_LABELS[row.method],
    }));
}

export async function getConfiguredCheckoutCharges() {
  const setting = await getDb().siteSetting.findUnique({
    where: { key: "commerce.checkout_charges" },
    select: { value: true },
  });
  return parseConfiguredCheckoutCharges(setting?.value);
}

export async function listOrdersForUser(
  userId: string,
  options: { page?: number } = {},
): Promise<{
  orders: CustomerOrderSummaryDto[];
  pagination: ReturnType<typeof buildPagination>;
}> {
  const db = getDb();
  const where = buildOwnedOrderWhere(userId);
  const total = await db.order.count({ where });
  const pagination = buildPagination(
    total,
    normalizePageOption(options.page),
    20,
  );
  const rows = await db.order.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: pagination.skip,
    take: pagination.pageSize,
    select: {
      publicId: true,
      orderNumber: true,
      currency: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      totalMinor: true,
      createdAt: true,
      items: { select: { quantity: true } },
    },
  });

  return {
    orders: rows.map((row) => ({
      publicId: row.publicId,
      orderNumber: row.orderNumber,
      currency: row.currency,
      status: row.status,
      paymentStatus: row.paymentStatus,
      fulfillmentStatus: row.fulfillmentStatus,
      totalMinor: row.totalMinor.toString(),
      itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
      createdAt: row.createdAt.toISOString(),
    })),
    pagination,
  };
}

export const listCurrentUserOrders = cache(async (page = 1) => {
  const session = await requireUser("/account/orders");
  return listOrdersForUser(session.user.id, { page });
});

export async function getOrderForUser(
  userId: string,
  candidatePublicId: string,
): Promise<CustomerOrderDetailDto | null> {
  const parsedPublicId = orderPublicIdSchema.safeParse(candidatePublicId);
  if (!parsedPublicId.success) return null;

  const db = getDb();
  const row = await db.order.findFirst({
    where: buildOwnedOrderWhere(userId, parsedPublicId.data),
    select: {
      publicId: true,
      orderNumber: true,
      customerEmail: true,
      currency: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      subtotalMinor: true,
      discountMinor: true,
      shippingMinor: true,
      taxMinor: true,
      totalMinor: true,
      createdAt: true,
      items: {
        orderBy: [{ id: "asc" }],
        select: {
          productName: true,
          productSlug: true,
          variantName: true,
          sku: true,
          quantity: true,
          fulfilledQuantity: true,
          unitPriceMinor: true,
          lineTotalMinor: true,
          currency: true,
        },
      },
      addresses: {
        orderBy: [{ kind: "desc" }],
        select: {
          kind: true,
          recipientName: true,
          company: true,
          line1: true,
          line2: true,
          city: true,
          region: true,
          postalCode: true,
          countryCode: true,
          phone: true,
        },
      },
      payments: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          publicId: true,
          method: true,
          status: true,
          amountMinor: true,
          currency: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      shipments: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          publicId: true,
          shipmentNumber: true,
          status: true,
          serviceLevel: true,
          trackingNumber: true,
          estimatedDeliveryAt: true,
          shippedAt: true,
          deliveredAt: true,
          carrier: {
            select: { name: true, trackingUrlTemplate: true },
          },
          packages: {
            orderBy: [{ packageNumber: "asc" }, { id: "asc" }],
            take: 100,
            select: {
              publicId: true,
              packageNumber: true,
              weightGrams: true,
              lengthMillimeters: true,
              widthMillimeters: true,
              heightMillimeters: true,
            },
          },
          trackingEvents: {
            orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
            select: {
              publicId: true,
              status: true,
              message: true,
              location: true,
              occurredAt: true,
            },
          },
        },
      },
    },
  });

  if (!row) return null;

  const manualMethods = row.payments
    .filter((payment) =>
      canExposeManualPaymentInstructions({
        orderStatus: row.status,
        orderPaymentStatus: row.paymentStatus,
        paymentStatus: payment.status,
      }),
    )
    .map((payment) => payment.method)
    .filter(
      (method): method is CheckoutPaymentMethod =>
        isCheckoutPaymentMethod(method) && isManualPaymentMethod(method),
    );
  const enabledConfigs = manualMethods.length
    ? await db.paymentMethodConfig.findMany({
        where: {
          isEnabled: true,
          method: { in: manualMethods },
        },
        select: {
          method: true,
          publicInstructions: true,
          isEnabled: true,
          settingKey: true,
          setting: { select: { value: true } },
        },
      })
    : [];
  const instructionsByMethod = new Map(
    enabledConfigs
      .filter(isPaymentMethodOperational)
      .map((config) => [
        config.method,
        isSafePublicPaymentInstructions(
          config.method,
          config.publicInstructions,
        )
          ? config.publicInstructions?.trim() || null
          : null,
      ]),
  );

  return {
    publicId: row.publicId,
    orderNumber: row.orderNumber,
    customerEmail: row.customerEmail,
    currency: row.currency,
    status: row.status,
    paymentStatus: row.paymentStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    subtotalMinor: row.subtotalMinor.toString(),
    discountMinor: row.discountMinor.toString(),
    shippingMinor: row.shippingMinor.toString(),
    taxMinor: row.taxMinor.toString(),
    totalMinor: row.totalMinor.toString(),
    itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
    createdAt: row.createdAt.toISOString(),
    items: row.items.map((item) => ({
      ...item,
      unitPriceMinor: item.unitPriceMinor.toString(),
      lineTotalMinor: item.lineTotalMinor.toString(),
    })),
    addresses: row.addresses,
    payments: row.payments
      .filter((payment) => isCheckoutPaymentMethod(payment.method))
      .map((payment) => ({
        publicId: payment.publicId,
        method: payment.method,
        status: payment.status,
        amountMinor: payment.amountMinor.toString(),
        currency: payment.currency,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString(),
        publicInstructions:
          isManualPaymentMethod(payment.method) &&
          canExposeManualPaymentInstructions({
            orderStatus: row.status,
            orderPaymentStatus: row.paymentStatus,
            paymentStatus: payment.status,
          })
          ? (instructionsByMethod.get(payment.method) ?? null)
          : null,
      })),
    shipments: row.shipments.map((shipment) => ({
      publicId: shipment.publicId,
      shipmentNumber: shipment.shipmentNumber,
      status: shipment.status,
      carrierName: shipment.carrier?.name ?? null,
      serviceLevel: shipment.serviceLevel,
      trackingNumber: shipment.trackingNumber,
      trackingUrl: buildMerchantTrackingUrl(
        shipment.carrier?.trackingUrlTemplate ?? null,
        shipment.trackingNumber,
      ),
      shippedAt: shipment.shippedAt?.toISOString() ?? null,
      deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
      estimatedDeliveryAt:
        shipment.estimatedDeliveryAt?.toISOString() ?? null,
      packages: shipment.packages,
      events: shipment.trackingEvents.map((event) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
      })),
    })),
  };
}

export const getCurrentUserOrder = cache(
  async (publicId: string): Promise<CustomerOrderDetailDto | null> => {
    const safePublicId = orderPublicIdSchema.safeParse(publicId);
    const returnTo = safePublicId.success
      ? `/account/orders/${safePublicId.data}`
      : "/account/orders";
    const session = await requireUser(returnTo);
    if (!safePublicId.success) return null;
    return getOrderForUser(session.user.id, safePublicId.data);
  },
);
