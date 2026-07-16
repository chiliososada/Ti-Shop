import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import {
  buildPagination,
  normalizePageSearchParameter,
  normalizeSearchText,
  type SearchParameter,
} from "@/lib/pagination";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";

const publicIdSchema = z.uuid();
const FULFILLMENT_PAGE_SIZE = 25;
const SHIPMENT_STATUSES = [
  "DRAFT",
  "LABEL_CREATED",
  "IN_TRANSIT",
  "DELIVERED",
  "EXCEPTION",
  "RETURNED",
  "CANCELED",
] as const;

export type AdminFulfillmentIndexFilters = {
  pendingPage: number;
  shipmentPage: number;
  shipmentQ: string;
  shipmentStatus: (typeof SHIPMENT_STATUSES)[number] | "";
};

export function normalizeAdminFulfillmentIndexFilters(
  searchParams: Record<string, SearchParameter>,
): AdminFulfillmentIndexFilters {
  const shipmentStatus = searchParams.shipmentStatus;
  return {
    pendingPage: normalizePageSearchParameter(searchParams.pendingPage),
    shipmentPage: normalizePageSearchParameter(searchParams.shipmentPage),
    shipmentQ: normalizeSearchText(searchParams.shipmentQ),
    shipmentStatus:
      typeof shipmentStatus === "string" &&
      (SHIPMENT_STATUSES as readonly string[]).includes(shipmentStatus)
        ? (shipmentStatus as (typeof SHIPMENT_STATUSES)[number])
        : "",
  };
}

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

export async function getAdminFulfillmentIndex(
  searchParams: Record<string, SearchParameter> = {},
) {
  const authorization = await requirePermission(
    "fulfillment.read",
    "/admin/fulfillment",
  );
  const filters = normalizeAdminFulfillmentIndexFilters(searchParams);
  const db = getDb();
  const shipmentWhere: Prisma.ShipmentWhereInput = {
    ...(filters.shipmentStatus ? { status: filters.shipmentStatus } : {}),
    ...(filters.shipmentQ
      ? {
          OR: [
            {
              shipmentNumber: {
                contains: filters.shipmentQ,
                mode: "insensitive",
              },
            },
            {
              trackingNumber: {
                contains: filters.shipmentQ,
                mode: "insensitive",
              },
            },
            {
              order: {
                is: {
                  OR: [
                    {
                      orderNumber: {
                        contains: filters.shipmentQ,
                        mode: "insensitive",
                      },
                    },
                    {
                      customerEmail: {
                        contains: filters.shipmentQ,
                        mode: "insensitive",
                      },
                    },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };
  const pendingOrderWhere: Prisma.OrderWhereInput = {
    status: { in: ["CONFIRMED", "PROCESSING"] },
    paymentStatus: "PAID",
    fulfillmentStatus: { in: ["UNFULFILLED", "PARTIAL"] },
  };
  const [shipmentTotal, pendingOrderTotal] = await Promise.all([
    db.shipment.count({ where: shipmentWhere }),
    db.order.count({ where: pendingOrderWhere }),
  ]);
  const shipmentPagination = buildPagination(
    shipmentTotal,
    filters.shipmentPage,
    FULFILLMENT_PAGE_SIZE,
  );
  const pendingOrderPagination = buildPagination(
    pendingOrderTotal,
    filters.pendingPage,
    FULFILLMENT_PAGE_SIZE,
  );
  const [carriers, shipments, pendingOrders] = await Promise.all([
    db.carrier.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }, { id: "asc" }],
      select: {
        publicId: true,
        code: true,
        name: true,
        trackingUrlTemplate: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { shipments: true } },
      },
    }),
    db.shipment.findMany({
      where: shipmentWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: shipmentPagination.skip,
      take: shipmentPagination.pageSize,
      select: {
        publicId: true,
        shipmentNumber: true,
        status: true,
        serviceLevel: true,
        trackingNumber: true,
        estimatedDeliveryAt: true,
        shippedAt: true,
        deliveredAt: true,
        canceledAt: true,
        createdAt: true,
        updatedAt: true,
        carrier: {
          select: { publicId: true, code: true, name: true },
        },
        order: {
          select: {
            publicId: true,
            orderNumber: true,
            customerEmail: true,
            paymentStatus: true,
            fulfillmentStatus: true,
          },
        },
        items: { select: { quantity: true } },
        _count: { select: { trackingEvents: true, packages: true } },
      },
    }),
    db.order.findMany({
      where: pendingOrderWhere,
      orderBy: [{ confirmedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      skip: pendingOrderPagination.skip,
      take: pendingOrderPagination.pageSize,
      select: {
        publicId: true,
        orderNumber: true,
        customerEmail: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        confirmedAt: true,
        createdAt: true,
        items: {
          orderBy: [{ id: "asc" }],
          select: { quantity: true, fulfilledQuantity: true },
        },
        _count: { select: { shipments: true } },
      },
    }),
  ]);

  return {
    canManage: authorization.permissions.has("fulfillment.manage"),
    filters: {
      ...filters,
      pendingPage: pendingOrderPagination.page,
      shipmentPage: shipmentPagination.page,
    },
    pendingOrderPagination,
    shipmentPagination,
    carriers: carriers.map((carrier) => ({
      publicId: carrier.publicId,
      code: carrier.code,
      name: carrier.name,
      trackingUrlTemplate: carrier.trackingUrlTemplate,
      isActive: carrier.isActive,
      shipmentCount: carrier._count.shipments,
      createdAt: carrier.createdAt.toISOString(),
      updatedAt: carrier.updatedAt.toISOString(),
    })),
    shipments: shipments.map((shipment) => ({
      publicId: shipment.publicId,
      shipmentNumber: shipment.shipmentNumber,
      status: shipment.status,
      serviceLevel: shipment.serviceLevel,
      trackingNumber: shipment.trackingNumber,
      estimatedDeliveryAt: iso(shipment.estimatedDeliveryAt),
      shippedAt: iso(shipment.shippedAt),
      deliveredAt: iso(shipment.deliveredAt),
      canceledAt: iso(shipment.canceledAt),
      createdAt: shipment.createdAt.toISOString(),
      updatedAt: shipment.updatedAt.toISOString(),
      carrier: shipment.carrier,
      order: shipment.order,
      itemQuantity: shipment.items.reduce(
        (total, item) => total + item.quantity,
        0,
      ),
      trackingEventCount: shipment._count.trackingEvents,
      packageCount: shipment._count.packages,
    })),
    pendingOrders: pendingOrders.map((order) => {
        const orderedQuantity = order.items.reduce(
          (total, item) => total + item.quantity,
          0,
        );
        const fulfilledQuantity = order.items.reduce(
          (total, item) => total + item.fulfilledQuantity,
          0,
        );
        return {
          publicId: order.publicId,
          orderNumber: order.orderNumber,
          customerEmail: order.customerEmail,
          status: order.status,
          paymentStatus: order.paymentStatus,
          fulfillmentStatus: order.fulfillmentStatus,
          orderedQuantity,
          fulfilledQuantity,
          remainingQuantity: Math.max(0, orderedQuantity - fulfilledQuantity),
          shipmentCount: order._count.shipments,
          confirmedAt: iso(order.confirmedAt),
          createdAt: order.createdAt.toISOString(),
        };
      }),
  };
}

export async function getAdminFulfillmentOrder(candidatePublicId: string) {
  const parsedPublicId = publicIdSchema.safeParse(candidatePublicId);
  const returnTo = parsedPublicId.success
    ? `/admin/fulfillment/orders/${parsedPublicId.data}`
    : "/admin/fulfillment";
  const authorization = await requirePermission("fulfillment.read", returnTo);
  if (!parsedPublicId.success) return null;

  const [row, carriers] = await Promise.all([
    getDb().order.findUnique({
      where: { publicId: parsedPublicId.data },
      select: {
        publicId: true,
        orderNumber: true,
        customerEmail: true,
        customerPhone: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        confirmedAt: true,
        createdAt: true,
        addresses: {
          where: { kind: "SHIPPING" },
          take: 1,
          select: {
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
            productName: true,
            variantName: true,
            sku: true,
            quantity: true,
            fulfilledQuantity: true,
            shipmentItems: { select: { quantity: true } },
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
            canceledAt: true,
            createdAt: true,
            updatedAt: true,
            carrier: {
              select: { publicId: true, code: true, name: true },
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
                createdAt: true,
                updatedAt: true,
              },
            },
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
              take: 200,
              select: {
                publicId: true,
                status: true,
                message: true,
                location: true,
                occurredAt: true,
                createdAt: true,
              },
            },
          },
        },
      },
    }),
    getDb().carrier.findMany({
      where: { isActive: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 200,
      select: { publicId: true, code: true, name: true },
    }),
  ]);
  if (!row) return null;

  const items = row.items.map((item, index) => {
    const allocatedQuantity = item.shipmentItems.reduce(
      (total, shipmentItem) => total + shipmentItem.quantity,
      0,
    );
    return {
      lineNumber: index + 1,
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      quantity: item.quantity,
      fulfilledQuantity: item.fulfilledQuantity,
      allocatedQuantity,
      remainingQuantity: Math.max(
        0,
        Math.min(
          item.quantity - item.fulfilledQuantity,
          item.quantity - allocatedQuantity,
        ),
      ),
    };
  });

  return {
    publicId: row.publicId,
    orderNumber: row.orderNumber,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    status: row.status,
    paymentStatus: row.paymentStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    confirmedAt: iso(row.confirmedAt),
    createdAt: row.createdAt.toISOString(),
    shippingAddress: row.addresses[0] ?? null,
    items,
    carriers,
    canManage: authorization.permissions.has("fulfillment.manage"),
    canCreateShipment:
      authorization.permissions.has("fulfillment.manage") &&
      row.paymentStatus === "PAID" &&
      (row.status === "CONFIRMED" || row.status === "PROCESSING") &&
      items.some((item) => item.remainingQuantity > 0) &&
      carriers.length > 0,
    shipments: row.shipments.map((shipment) => ({
      publicId: shipment.publicId,
      shipmentNumber: shipment.shipmentNumber,
      status: shipment.status,
      serviceLevel: shipment.serviceLevel,
      trackingNumber: shipment.trackingNumber,
      estimatedDeliveryAt: iso(shipment.estimatedDeliveryAt),
      shippedAt: iso(shipment.shippedAt),
      deliveredAt: iso(shipment.deliveredAt),
      canceledAt: iso(shipment.canceledAt),
      createdAt: shipment.createdAt.toISOString(),
      updatedAt: shipment.updatedAt.toISOString(),
      carrier: shipment.carrier,
      packages: shipment.packages.map((parcel) => ({
        ...parcel,
        createdAt: parcel.createdAt.toISOString(),
        updatedAt: parcel.updatedAt.toISOString(),
      })),
      items: shipment.items.map((item) => ({
        quantity: item.quantity,
        productName: item.orderItem.productName,
        variantName: item.orderItem.variantName,
        sku: item.orderItem.sku,
      })),
      trackingEvents: shipment.trackingEvents.map((event) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
        createdAt: event.createdAt.toISOString(),
      })),
    })),
  };
}
