import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import {
  buildPagination,
  normalizePageSearchParameter,
  normalizeSearchText,
  type SearchParameter,
} from "@/lib/pagination";
import {
  isExternallyRefundableManualPayment,
  isReviewableManualPayment,
  PAYMENT_REVIEW_ORDER_WHERE,
} from "@/server/admin/orders/payment-review-policy";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";

const publicIdSchema = z.uuid();
const ORDER_PAGE_SIZE = 30;
const ORDER_STATUSES = [
  "DRAFT",
  "PENDING_PAYMENT",
  "CONFIRMED",
  "PROCESSING",
  "COMPLETED",
  "CANCELED",
] as const;
const PAYMENT_STATUSES = [
  "UNPAID",
  "PENDING",
  "PARTIALLY_PAID",
  "PAID",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "FAILED",
  "VOIDED",
] as const;
const FULFILLMENT_STATUSES = [
  "UNFULFILLED",
  "PARTIAL",
  "FULFILLED",
  "RETURNED",
  "CANCELED",
] as const;

type Choice<T extends readonly string[]> = T[number] | "";

const REVIEW_FILTERS = ["required"] as const;

export type AdminOrderIndexFilters = {
  q: string;
  orderStatus: Choice<typeof ORDER_STATUSES>;
  paymentStatus: Choice<typeof PAYMENT_STATUSES>;
  fulfillmentStatus: Choice<typeof FULFILLMENT_STATUSES>;
  review: Choice<typeof REVIEW_FILTERS>;
  page: number;
};

function normalizeChoice<T extends readonly string[]>(
  value: SearchParameter,
  choices: T,
): Choice<T> {
  return typeof value === "string" && choices.includes(value) ? value : "";
}

export function normalizeAdminOrderIndexFilters(
  searchParams: Record<string, SearchParameter>,
): AdminOrderIndexFilters {
  return {
    q: normalizeSearchText(searchParams.q),
    orderStatus: normalizeChoice(searchParams.orderStatus, ORDER_STATUSES),
    paymentStatus: normalizeChoice(
      searchParams.paymentStatus,
      PAYMENT_STATUSES,
    ),
    fulfillmentStatus: normalizeChoice(
      searchParams.fulfillmentStatus,
      FULFILLMENT_STATUSES,
    ),
    review: normalizeChoice(searchParams.review, REVIEW_FILTERS),
    page: normalizePageSearchParameter(searchParams.page),
  };
}

function adminOrderWhere(filters: AdminOrderIndexFilters): Prisma.OrderWhereInput {
  return {
    ...(filters.q
      ? {
          OR: [
            { orderNumber: { contains: filters.q, mode: "insensitive" } },
            { customerEmail: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(filters.orderStatus ? { status: filters.orderStatus } : {}),
    ...(filters.paymentStatus
      ? { paymentStatus: filters.paymentStatus }
      : {}),
    ...(filters.fulfillmentStatus
      ? { fulfillmentStatus: filters.fulfillmentStatus }
      : {}),
    // Nested under payments.some, so it composes with the top-level OR that
    // the text search builds.
    ...(filters.review === "required" ? PAYMENT_REVIEW_ORDER_WHERE : {}),
  };
}

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

function metadataString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : null;
}

function externalRefundMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>).externalRefund;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const refund = candidate as Record<string, unknown>;
  if (
    typeof refund.reference !== "string" ||
    typeof refund.recordedAt !== "string"
  ) {
    return null;
  }
  return {
    reference: refund.reference,
    note: typeof refund.note === "string" ? refund.note : null,
    recordedAt: refund.recordedAt,
    hasPhysicalDispatch:
      typeof refund.hasPhysicalDispatch === "boolean"
        ? refund.hasPhysicalDispatch
        : null,
  };
}

async function requireOrderPaymentRead(returnTo: string) {
  const authorization = await requirePermission("orders.read", returnTo);
  await requirePermission("payments.read", returnTo);
  return authorization;
}

export async function getAdminOrderIndex(
  searchParams: Record<string, SearchParameter> = {},
) {
  const authorization = await requireOrderPaymentRead("/admin/orders");
  const filters = normalizeAdminOrderIndexFilters(searchParams);
  const db = getDb();
  const where = adminOrderWhere(filters);
  const total = await db.order.count({ where });
  const pagination = buildPagination(total, filters.page, ORDER_PAGE_SIZE);
  const rows = await db.order.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: pagination.skip,
    take: pagination.pageSize,
    select: {
      publicId: true,
      orderNumber: true,
      customerEmail: true,
      currency: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      totalMinor: true,
      createdAt: true,
      updatedAt: true,
      items: { select: { quantity: true } },
      payments: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { method: true, status: true },
      },
      _count: { select: { shipments: true } },
    },
  });

  return {
    orders: rows.map((row) => ({
      publicId: row.publicId,
      orderNumber: row.orderNumber,
      customerEmail: row.customerEmail,
      currency: row.currency,
      status: row.status,
      paymentStatus: row.paymentStatus,
      fulfillmentStatus: row.fulfillmentStatus,
      totalMinor: row.totalMinor.toString(),
      itemCount: row.items.reduce((total, item) => total + item.quantity, 0),
      shipmentCount: row._count.shipments,
      paymentAttempts: row.payments.map((payment) => ({
        method: payment.method,
        status: payment.status,
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    filters: { ...filters, page: pagination.page },
    pagination,
    canCreateManualOrder:
      authorization.permissions.has("orders.manage") &&
      authorization.permissions.has("payments.manage") &&
      authorization.permissions.has("customers.read"),
  };
}

export async function getAdminOrder(candidatePublicId: string) {
  const parsedPublicId = publicIdSchema.safeParse(candidatePublicId);
  const returnTo = parsedPublicId.success
    ? `/admin/orders/${parsedPublicId.data}`
    : "/admin/orders";
  const authorization = await requireOrderPaymentRead(returnTo);
  if (!parsedPublicId.success) return null;

  const row = await getDb().order.findUnique({
    where: { publicId: parsedPublicId.data },
    select: {
      publicId: true,
      orderNumber: true,
      customerEmail: true,
      customerPhone: true,
      customerNote: true,
      currency: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      subtotalMinor: true,
      discountMinor: true,
      shippingMinor: true,
      taxMinor: true,
      totalMinor: true,
      placedAt: true,
      confirmedAt: true,
      completedAt: true,
      canceledAt: true,
      cancellationReason: true,
      createdAt: true,
      updatedAt: true,
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
      items: {
        orderBy: [{ id: "asc" }],
        select: {
          id: true,
          productName: true,
          productSlug: true,
          variantName: true,
          sku: true,
          quantity: true,
          fulfilledQuantity: true,
          unitPriceMinor: true,
          discountMinor: true,
          taxMinor: true,
          lineTotalMinor: true,
          currency: true,
        },
      },
      payments: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          publicId: true,
          method: true,
          status: true,
          currency: true,
          amountMinor: true,
          cryptoCurrency: true,
          cryptoAmount: true,
          actuallyPaid: true,
          outcomeAmount: true,
          outcomeCurrency: true,
          providerStatus: true,
          providerPaymentId: true,
          providerInvoiceId: true,
          metadata: true,
          expiresAt: true,
          confirmedAt: true,
          failedAt: true,
          canceledAt: true,
          createdAt: true,
          updatedAt: true,
          events: {
            orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
            take: 100,
            select: {
              publicId: true,
              eventType: true,
              statusBefore: true,
              statusAfter: true,
              amountMinor: true,
              cryptoAmount: true,
              occurredAt: true,
              createdAt: true,
            },
          },
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
          currency: true,
          shippingCostMinor: true,
          shippedAt: true,
          deliveredAt: true,
          canceledAt: true,
          createdAt: true,
          updatedAt: true,
          carrier: { select: { name: true } },
          items: {
            orderBy: [{ orderItemId: "asc" }],
            select: {
              quantity: true,
              orderItem: {
                select: {
                  productName: true,
                  variantName: true,
                  sku: true,
                },
              },
            },
          },
          trackingEvents: {
            orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
            take: 100,
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
  const canManageProviderReview =
    authorization.permissions.has("payments.manage") &&
    authorization.permissions.has("orders.manage");

  return {
    publicId: row.publicId,
    orderNumber: row.orderNumber,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    customerNote: row.customerNote,
    currency: row.currency,
    status: row.status,
    paymentStatus: row.paymentStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    subtotalMinor: row.subtotalMinor.toString(),
    discountMinor: row.discountMinor.toString(),
    shippingMinor: row.shippingMinor.toString(),
    taxMinor: row.taxMinor.toString(),
    totalMinor: row.totalMinor.toString(),
    placedAt: iso(row.placedAt),
    confirmedAt: iso(row.confirmedAt),
    completedAt: iso(row.completedAt),
    canceledAt: iso(row.canceledAt),
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    addresses: row.addresses,
    items: row.items.map(({ id, ...item }) => ({
      ...item,
      key: id.toString(),
      unitPriceMinor: item.unitPriceMinor.toString(),
      discountMinor: item.discountMinor.toString(),
      taxMinor: item.taxMinor.toString(),
      lineTotalMinor: item.lineTotalMinor.toString(),
    })),
    payments: row.payments.map((payment) => ({
      publicId: payment.publicId,
      method: payment.method,
      status: payment.status,
      currency: payment.currency,
      amountMinor: payment.amountMinor.toString(),
      cryptoCurrency: payment.cryptoCurrency,
      cryptoAmount: payment.cryptoAmount?.toString() ?? null,
      actuallyPaid: payment.actuallyPaid?.toString() ?? null,
      outcomeAmount: payment.outcomeAmount?.toString() ?? null,
      outcomeCurrency: payment.outcomeCurrency,
      providerStatus: payment.providerStatus,
      providerPaymentId: payment.providerPaymentId,
      providerInvoiceId: payment.providerInvoiceId,
      reconciliationIssue: metadataString(
        payment.metadata,
        "reconciliationIssue",
      ),
      expiresAt: iso(payment.expiresAt),
      confirmedAt: iso(payment.confirmedAt),
      failedAt: iso(payment.failedAt),
      canceledAt: iso(payment.canceledAt),
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
      canReview:
        canManageProviderReview &&
        isReviewableManualPayment(payment.method, payment.status),
      canRecordExternalRefund:
        canManageProviderReview &&
        row.paymentStatus === "PAID" &&
        isExternallyRefundableManualPayment(payment.method, payment.status),
      externalRefund: externalRefundMetadata(payment.metadata),
      canResolveUnlinkedNowPayments:
        canManageProviderReview &&
        payment.method === "NOWPAYMENTS" &&
        payment.status === "REVIEW_REQUIRED" &&
        payment.providerInvoiceId !== null &&
        payment.providerPaymentId === null,
      events: payment.events.map((event) => ({
        publicId: event.publicId,
        eventType: event.eventType,
        statusBefore: event.statusBefore,
        statusAfter: event.statusAfter,
        amountMinor: event.amountMinor?.toString() ?? null,
        cryptoAmount: event.cryptoAmount?.toString() ?? null,
        occurredAt: event.occurredAt.toISOString(),
        createdAt: event.createdAt.toISOString(),
      })),
    })),
    shipments: row.shipments.map((shipment) => ({
      publicId: shipment.publicId,
      shipmentNumber: shipment.shipmentNumber,
      status: shipment.status,
      carrierName: shipment.carrier?.name ?? null,
      serviceLevel: shipment.serviceLevel,
      trackingNumber: shipment.trackingNumber,
      currency: shipment.currency,
      shippingCostMinor: shipment.shippingCostMinor?.toString() ?? null,
      shippedAt: iso(shipment.shippedAt),
      deliveredAt: iso(shipment.deliveredAt),
      canceledAt: iso(shipment.canceledAt),
      createdAt: shipment.createdAt.toISOString(),
      updatedAt: shipment.updatedAt.toISOString(),
      items: shipment.items.map((item) => ({
        quantity: item.quantity,
        productName: item.orderItem.productName,
        variantName: item.orderItem.variantName,
        sku: item.orderItem.sku,
      })),
      events: shipment.trackingEvents.map((event) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
      })),
    })),
  };
}
