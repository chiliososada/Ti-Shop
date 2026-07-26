import "server-only";

import { randomUUID } from "node:crypto";

import {
  FulfillmentStatus,
  Prisma,
} from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import {
  canAdvanceTrackingForPayment,
  canTransitionShipment,
  canTransitionShipmentForPayment,
  orderStatusForFulfillment,
  shipmentStatusForTrackingEvent,
  shipmentTimestampPatch,
} from "@/server/admin/fulfillment/lifecycle";
import {
  enqueueOrderShippedEmail,
  shouldSendShipmentDispatchEmail,
} from "@/server/email/enqueue";
import type {
  CreateCarrierInput,
  CreatePackageInput,
  CreateShipmentInput,
  DeletePackageInput,
  TrackingEventInput,
  UpdateCarrierInput,
  UpdatePackageInput,
  UpdateShipmentDetailsInput,
  UpdateShipmentStatusInput,
} from "@/server/admin/fulfillment/validators";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { withSerializableRetry } from "@/server/orders/retry";

const TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 10_000,
} as const;

const carrierAuditSelect = {
  publicId: true,
  code: true,
  name: true,
  trackingUrlTemplate: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const shipmentAuditSelect = {
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
} as const;

const packageAuditSelect = {
  publicId: true,
  packageNumber: true,
  weightGrams: true,
  lengthMillimeters: true,
  widthMillimeters: true,
  heightMillimeters: true,
  createdAt: true,
  updatedAt: true,
} as const;

function shipmentAuditSnapshot(record: {
  publicId: string;
  shipmentNumber: string;
  status: string;
  serviceLevel: string | null;
  trackingNumber: string | null;
  estimatedDeliveryAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    publicId: record.publicId,
    shipmentNumber: record.shipmentNumber,
    status: record.status,
    serviceLevel: record.serviceLevel,
    trackingNumber: record.trackingNumber,
    estimatedDeliveryAt: record.estimatedDeliveryAt,
    shippedAt: record.shippedAt,
    deliveredAt: record.deliveredAt,
    canceledAt: record.canceledAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

const trackingEventAuditSelect = {
  publicId: true,
  status: true,
  message: true,
  location: true,
  occurredAt: true,
  createdAt: true,
} as const;

class FulfillmentWriteConflictError extends Error {
  constructor() {
    super("Fulfillment data changed during the transaction.");
    this.name = "FulfillmentWriteConflictError";
  }
}

function makeShipmentNumber(now = new Date()) {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  return `SHP-${day}-${suffix}`;
}

async function recalculateOrderFulfillment(
  tx: Prisma.TransactionClient,
  orderId: bigint,
) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      status: true,
      completedAt: true,
      fulfillmentStatus: true,
      items: { select: { quantity: true, fulfilledQuantity: true } },
      shipments: { select: { status: true, deliveredAt: true } },
    },
  });
  const orderedQuantity = order.items.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  const fulfilledQuantity = order.items.reduce(
    (total, item) => total + item.fulfilledQuantity,
    0,
  );
  const activeShipments = order.shipments.filter(
    (shipment) => shipment.status !== "CANCELED",
  );
  const completionTime = activeShipments.reduce<Date | null>(
    (latest, shipment) =>
      shipment.deliveredAt &&
      (!latest || shipment.deliveredAt.getTime() > latest.getTime())
        ? shipment.deliveredAt
        : latest,
    null,
  );

  let fulfillmentStatus: FulfillmentStatus;
  if (order.status === "CANCELED") {
    fulfillmentStatus = FulfillmentStatus.CANCELED;
  } else if (fulfilledQuantity === 0) {
    fulfillmentStatus = FulfillmentStatus.UNFULFILLED;
  } else if (
    orderedQuantity > 0 &&
    fulfilledQuantity === orderedQuantity &&
    activeShipments.length > 0 &&
    activeShipments.every((shipment) => shipment.status === "RETURNED")
  ) {
    fulfillmentStatus = FulfillmentStatus.RETURNED;
  } else if (fulfilledQuantity < orderedQuantity) {
    fulfillmentStatus = FulfillmentStatus.PARTIAL;
  } else {
    fulfillmentStatus = FulfillmentStatus.FULFILLED;
  }

  if (fulfillmentStatus === order.fulfillmentStatus) {
    const orderStatus = orderStatusForFulfillment(
      order.status,
      fulfillmentStatus,
      order.shipments.map((shipment) => shipment.status),
    );
    if (orderStatus === order.status) {
      return {
        before: order.fulfillmentStatus,
        after: order.fulfillmentStatus,
        orderStatusBefore: order.status,
        orderStatusAfter: order.status,
        orderedQuantity,
        fulfilledQuantity,
      };
    }
    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: {
        status: orderStatus,
        ...(orderStatus === "COMPLETED"
          ? { completedAt: order.completedAt ?? completionTime ?? new Date() }
          : {}),
      },
      select: { status: true },
    });
    return {
      before: order.fulfillmentStatus,
      after: order.fulfillmentStatus,
      orderStatusBefore: order.status,
      orderStatusAfter: updatedOrder.status,
      orderedQuantity,
      fulfilledQuantity,
    };
  }
  const orderStatus = orderStatusForFulfillment(
    order.status,
    fulfillmentStatus,
    order.shipments.map((shipment) => shipment.status),
  );
  const updated = await tx.order.update({
    where: { id: orderId },
    data: {
      fulfillmentStatus,
      status: orderStatus,
      ...(orderStatus === "COMPLETED"
        ? { completedAt: order.completedAt ?? completionTime ?? new Date() }
        : {}),
    },
    select: { fulfillmentStatus: true, status: true },
  });
  return {
    before: order.fulfillmentStatus,
    after: updated.fulfillmentStatus,
    orderStatusBefore: order.status,
    orderStatusAfter: updated.status,
    orderedQuantity,
    fulfilledQuantity,
  };
}

export async function createAdminCarrier(input: CreateCarrierInput) {
  const authorization = await requirePermission(
    "fulfillment.manage",
    "/admin/fulfillment",
  );

  return getDb().$transaction(async (tx) => {
    const duplicate = await tx.carrier.findUnique({
      where: { code: input.code },
      select: { id: true },
    });
    if (duplicate) return { ok: false as const, reason: "duplicate" as const };

    const after = await tx.carrier.create({
      data: {
        code: input.code,
        name: input.name,
        trackingUrlTemplate: input.trackingUrlTemplate,
        isActive: input.isActive,
      },
      select: carrierAuditSelect,
    });

    await writeAdminAuditLog(tx, {
      actorUserId: authorization.session.user.id,
      action: "fulfillment.carrier.create",
      resourceType: "carrier",
      resourceId: after.publicId,
      before: null,
      after,
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: "carrier",
        aggregateId: after.publicId,
        eventType: "carrier.created",
        payload: {
          carrierPublicId: after.publicId,
          code: after.code,
          name: after.name,
          isActive: after.isActive,
        },
      },
      select: { id: true },
    });
    return { ok: true as const, publicId: after.publicId, code: after.code };
  }, TRANSACTION_OPTIONS);
}

export async function updateAdminCarrier(input: UpdateCarrierInput) {
  const authorization = await requirePermission(
    "fulfillment.manage",
    "/admin/fulfillment",
  );

  return getDb().$transaction(async (tx) => {
    const existing = await tx.carrier.findUnique({
      where: { publicId: input.carrierPublicId },
      select: { id: true, ...carrierAuditSelect },
    });
    if (!existing) return { ok: false as const, reason: "not_found" as const };

    const after = await tx.carrier.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        trackingUrlTemplate: input.trackingUrlTemplate,
        isActive: input.isActive,
      },
      select: carrierAuditSelect,
    });

    await writeAdminAuditLog(tx, {
      actorUserId: authorization.session.user.id,
      action: "fulfillment.carrier.update",
      resourceType: "carrier",
      resourceId: existing.publicId,
      before: {
        publicId: existing.publicId,
        code: existing.code,
        name: existing.name,
        trackingUrlTemplate: existing.trackingUrlTemplate,
        isActive: existing.isActive,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      },
      after,
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: "carrier",
        aggregateId: existing.publicId,
        eventType: "carrier.updated",
        payload: {
          carrierPublicId: existing.publicId,
          code: existing.code,
          name: after.name,
          isActive: after.isActive,
        },
      },
      select: { id: true },
    });
    return { ok: true as const, publicId: existing.publicId, code: existing.code };
  }, TRANSACTION_OPTIONS);
}

export async function createAdminShipment(input: CreateShipmentInput) {
  const returnTo = `/admin/fulfillment/orders/${input.orderPublicId}`;
  const authorization = await requirePermission("fulfillment.manage", returnTo);

  return getDb().$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { publicId: input.orderPublicId },
      select: {
        id: true,
        publicId: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        items: {
          orderBy: [{ id: "asc" }],
          select: {
            id: true,
            productName: true,
            variantName: true,
            sku: true,
            quantity: true,
            fulfilledQuantity: true,
            shipmentItems: { select: { quantity: true } },
          },
        },
      },
    });
    if (!order) return { ok: false as const, reason: "not_found" as const };
    if (order.paymentStatus !== "PAID") {
      return { ok: false as const, reason: "payment_not_paid" as const };
    }
    if (order.status !== "CONFIRMED" && order.status !== "PROCESSING") {
      return {
        ok: false as const,
        reason: "order_not_fulfillable" as const,
      };
    }
    if (order.items.length !== input.lineQuantities.length) {
      return { ok: false as const, reason: "lines_changed" as const };
    }

    const carrier = await tx.carrier.findFirst({
      where: { publicId: input.carrierPublicId, isActive: true },
      select: { id: true, publicId: true, code: true, name: true },
    });
    if (!carrier) {
      return { ok: false as const, reason: "carrier_unavailable" as const };
    }

    const selectedLines: Array<{
      orderItemId: bigint;
      lineNumber: number;
      productName: string;
      variantName: string | null;
      sku: string | null;
      quantity: number;
      priorFulfilledQuantity: number;
    }> = [];
    for (const [index, item] of order.items.entries()) {
      const requested = input.lineQuantities[index] ?? -1;
      const allocatedQuantity = item.shipmentItems.reduce(
        (total, shipmentItem) => total + shipmentItem.quantity,
        0,
      );
      const remainingQuantity = Math.max(
        0,
        Math.min(
          item.quantity - item.fulfilledQuantity,
          item.quantity - allocatedQuantity,
        ),
      );
      if (requested < 0 || requested > remainingQuantity) {
        return { ok: false as const, reason: "invalid_quantity" as const };
      }
      if (requested > 0) {
        selectedLines.push({
          orderItemId: item.id,
          lineNumber: index + 1,
          productName: item.productName,
          variantName: item.variantName,
          sku: item.sku,
          quantity: requested,
          priorFulfilledQuantity: item.fulfilledQuantity,
        });
      }
    }
    if (!selectedLines.length) {
      return { ok: false as const, reason: "invalid_quantity" as const };
    }

    const created = await tx.shipment.create({
      data: {
        shipmentNumber: makeShipmentNumber(),
        orderId: order.id,
        carrierId: carrier.id,
        status: "DRAFT",
        serviceLevel: input.serviceLevel,
        trackingNumber: input.trackingNumber,
        estimatedDeliveryAt: input.estimatedDeliveryAt,
        items: {
          create: selectedLines.map((line) => ({
            orderItemId: line.orderItemId,
            quantity: line.quantity,
          })),
        },
      },
      select: shipmentAuditSelect,
    });

    for (const line of selectedLines) {
      const updated = await tx.orderItem.updateMany({
        where: {
          id: line.orderItemId,
          fulfilledQuantity: line.priorFulfilledQuantity,
        },
        data: { fulfilledQuantity: { increment: line.quantity } },
      });
      if (updated.count !== 1) throw new FulfillmentWriteConflictError();
    }

    const fulfillment = await recalculateOrderFulfillment(tx, order.id);
    const lineSnapshot = selectedLines.map((line) => ({
      lineNumber: line.lineNumber,
      productName: line.productName,
      variantName: line.variantName,
      sku: line.sku,
      quantity: line.quantity,
    }));
    await writeAdminAuditLog(tx, {
      actorUserId: authorization.session.user.id,
      action: "fulfillment.shipment.create",
      resourceType: "shipment",
      resourceId: created.publicId,
      before: {
        orderPublicId: order.publicId,
        orderNumber: order.orderNumber,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: fulfillment.before,
        orderStatus: fulfillment.orderStatusBefore,
      },
      after: {
        shipment: created,
        carrier: {
          publicId: carrier.publicId,
          code: carrier.code,
          name: carrier.name,
        },
        orderPublicId: order.publicId,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: fulfillment.after,
        orderStatus: fulfillment.orderStatusAfter,
        lines: lineSnapshot,
      },
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: "shipment",
        aggregateId: created.publicId,
        eventType: "shipment.created",
        payload: {
          shipmentPublicId: created.publicId,
          shipmentNumber: created.shipmentNumber,
          orderPublicId: order.publicId,
          paymentStatus: order.paymentStatus,
          carrierPublicId: carrier.publicId,
          status: created.status,
          fulfillmentStatus: fulfillment.after,
          orderStatus: fulfillment.orderStatusAfter,
          lines: selectedLines.map((line) => ({
            lineNumber: line.lineNumber,
            quantity: line.quantity,
          })),
        },
      },
      select: { id: true },
    });

    return {
      ok: true as const,
      publicId: created.publicId,
      shipmentNumber: created.shipmentNumber,
      orderPublicId: order.publicId,
    };
  }, TRANSACTION_OPTIONS);
}

export async function updateAdminShipmentDetails(
  input: UpdateShipmentDetailsInput,
) {
  const authorization = await requirePermission(
    "fulfillment.manage",
    "/admin/fulfillment",
  );

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const existing = await tx.shipment.findUnique({
        where: { publicId: input.shipmentPublicId },
        select: {
          id: true,
          carrierId: true,
          ...shipmentAuditSelect,
          order: { select: { publicId: true } },
        },
      });
      if (!existing) return { ok: false as const, reason: "not_found" as const };

      if (input.trackingNumber && existing.carrierId) {
        const conflict = await tx.shipment.findFirst({
          where: {
            id: { not: existing.id },
            carrierId: existing.carrierId,
            trackingNumber: input.trackingNumber,
          },
          select: { id: true },
        });
        if (conflict) {
          return { ok: false as const, reason: "duplicate_tracking" as const };
        }
      }

      if (
        existing.serviceLevel === input.serviceLevel &&
        existing.trackingNumber === input.trackingNumber &&
        existing.estimatedDeliveryAt?.getTime() ===
          input.estimatedDeliveryAt?.getTime()
      ) {
        return {
          ok: true as const,
          duplicate: true,
          orderPublicId: existing.order.publicId,
          shipmentNumber: existing.shipmentNumber,
        };
      }

      const after = await tx.shipment.update({
        where: { id: existing.id },
        data: {
          serviceLevel: input.serviceLevel,
          trackingNumber: input.trackingNumber,
          estimatedDeliveryAt: input.estimatedDeliveryAt,
        },
        select: shipmentAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "fulfillment.shipment.details.update",
        resourceType: "shipment",
        resourceId: existing.publicId,
        before: shipmentAuditSnapshot(existing),
        after,
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "shipment",
          aggregateId: existing.publicId,
          eventType: "shipment.details_updated",
          payload: {
            shipmentPublicId: existing.publicId,
            orderPublicId: existing.order.publicId,
            hasTrackingNumber: after.trackingNumber !== null,
            hasEstimatedDelivery: after.estimatedDeliveryAt !== null,
          },
        },
        select: { id: true },
      });
      return {
        ok: true as const,
        duplicate: false,
        orderPublicId: existing.order.publicId,
        shipmentNumber: existing.shipmentNumber,
      };
    }, TRANSACTION_OPTIONS),
  );
}

type LockedShipment = {
  id: bigint;
  publicId: string;
  shipmentNumber: string;
  status: string;
  orderPublicId: string;
};

type LockedPackage = LockedShipment & {
  packageId: bigint;
  packagePublicId: string;
};

function packageIsEditable(status: string) {
  return status === "draft" || status === "label_created";
}

async function lockShipmentForPackage(
  tx: Prisma.TransactionClient,
  shipmentPublicId: string,
) {
  const rows = await tx.$queryRaw<LockedShipment[]>`
    SELECT
      shipment."id",
      shipment."public_id" AS "publicId",
      shipment."shipment_number" AS "shipmentNumber",
      shipment."status"::text AS "status",
      customer_order."public_id" AS "orderPublicId"
    FROM "app"."shipments" AS shipment
    INNER JOIN "app"."orders" AS customer_order
      ON customer_order."id" = shipment."order_id"
    WHERE shipment."public_id" = ${shipmentPublicId}::uuid
    FOR UPDATE OF shipment
  `;
  return rows[0] ?? null;
}

async function lockPackage(
  tx: Prisma.TransactionClient,
  packagePublicId: string,
) {
  const rows = await tx.$queryRaw<LockedPackage[]>`
    SELECT
      shipment."id",
      shipment."public_id" AS "publicId",
      shipment."shipment_number" AS "shipmentNumber",
      shipment."status"::text AS "status",
      customer_order."public_id" AS "orderPublicId",
      parcel."id" AS "packageId",
      parcel."public_id" AS "packagePublicId"
    FROM "app"."packages" AS parcel
    INNER JOIN "app"."shipments" AS shipment
      ON shipment."id" = parcel."shipment_id"
    INNER JOIN "app"."orders" AS customer_order
      ON customer_order."id" = shipment."order_id"
    WHERE parcel."public_id" = ${packagePublicId}::uuid
    FOR UPDATE OF shipment, parcel
  `;
  return rows[0] ?? null;
}

function packageValues(
  input: CreatePackageInput | UpdatePackageInput,
) {
  return {
    weightGrams: input.weightGrams,
    lengthMillimeters: input.lengthMillimeters,
    widthMillimeters: input.widthMillimeters,
    heightMillimeters: input.heightMillimeters,
  };
}

export async function createAdminPackage(input: CreatePackageInput) {
  const authorization = await requirePermission(
    "fulfillment.manage",
    "/admin/fulfillment",
  );

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const shipment = await lockShipmentForPackage(
        tx,
        input.shipmentPublicId,
      );
      if (!shipment) return { ok: false as const, reason: "not_found" as const };
      if (!packageIsEditable(shipment.status)) {
        return { ok: false as const, reason: "shipment_locked" as const };
      }
      const aggregate = await tx.package.aggregate({
        where: { shipmentId: shipment.id },
        _count: { _all: true },
        _max: { packageNumber: true },
      });
      if (aggregate._count._all >= 100) {
        return { ok: false as const, reason: "limit" as const };
      }
      const packageNumber = (aggregate._max.packageNumber ?? 0) + 1;
      const created = await tx.package.create({
        data: {
          shipmentId: shipment.id,
          packageNumber,
          ...packageValues(input),
        },
        select: packageAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "fulfillment.package.create",
        resourceType: "package",
        resourceId: created.publicId,
        before: null,
        after: { shipmentPublicId: shipment.publicId, package: created },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "shipment",
          aggregateId: shipment.publicId,
          eventType: "shipment.package_created",
          payload: {
            shipmentPublicId: shipment.publicId,
            orderPublicId: shipment.orderPublicId,
            packagePublicId: created.publicId,
            packageNumber: created.packageNumber,
          },
        },
        select: { id: true },
      });
      return {
        ok: true as const,
        publicId: created.publicId,
        orderPublicId: shipment.orderPublicId,
        shipmentNumber: shipment.shipmentNumber,
        packageNumber: created.packageNumber,
      };
    }, TRANSACTION_OPTIONS),
  );
}

export async function updateAdminPackage(input: UpdatePackageInput) {
  const authorization = await requirePermission(
    "fulfillment.manage",
    "/admin/fulfillment",
  );

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const locked = await lockPackage(tx, input.packagePublicId);
      if (!locked) return { ok: false as const, reason: "not_found" as const };
      if (!packageIsEditable(locked.status)) {
        return { ok: false as const, reason: "shipment_locked" as const };
      }
      const existing = await tx.package.findUniqueOrThrow({
        where: { id: locked.packageId },
        select: packageAuditSelect,
      });
      const values = packageValues(input);
      if (
        existing.weightGrams === values.weightGrams &&
        existing.lengthMillimeters === values.lengthMillimeters &&
        existing.widthMillimeters === values.widthMillimeters &&
        existing.heightMillimeters === values.heightMillimeters
      ) {
        return {
          ok: true as const,
          duplicate: true,
          orderPublicId: locked.orderPublicId,
          shipmentNumber: locked.shipmentNumber,
          packageNumber: existing.packageNumber,
        };
      }
      const after = await tx.package.update({
        where: { id: locked.packageId },
        data: values,
        select: packageAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "fulfillment.package.update",
        resourceType: "package",
        resourceId: existing.publicId,
        before: { shipmentPublicId: locked.publicId, package: existing },
        after: { shipmentPublicId: locked.publicId, package: after },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "shipment",
          aggregateId: locked.publicId,
          eventType: "shipment.package_updated",
          payload: {
            shipmentPublicId: locked.publicId,
            orderPublicId: locked.orderPublicId,
            packagePublicId: existing.publicId,
            packageNumber: existing.packageNumber,
          },
        },
        select: { id: true },
      });
      return {
        ok: true as const,
        duplicate: false,
        orderPublicId: locked.orderPublicId,
        shipmentNumber: locked.shipmentNumber,
        packageNumber: existing.packageNumber,
      };
    }, TRANSACTION_OPTIONS),
  );
}

export async function deleteAdminPackage(input: DeletePackageInput) {
  const authorization = await requirePermission(
    "fulfillment.manage",
    "/admin/fulfillment",
  );

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const locked = await lockPackage(tx, input.packagePublicId);
      if (!locked) return { ok: false as const, reason: "not_found" as const };
      if (!packageIsEditable(locked.status)) {
        return { ok: false as const, reason: "shipment_locked" as const };
      }
      const existing = await tx.package.delete({
        where: { id: locked.packageId },
        select: packageAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "fulfillment.package.delete",
        resourceType: "package",
        resourceId: existing.publicId,
        before: { shipmentPublicId: locked.publicId, package: existing },
        after: null,
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "shipment",
          aggregateId: locked.publicId,
          eventType: "shipment.package_deleted",
          payload: {
            shipmentPublicId: locked.publicId,
            orderPublicId: locked.orderPublicId,
            packagePublicId: existing.publicId,
            packageNumber: existing.packageNumber,
          },
        },
        select: { id: true },
      });
      return {
        ok: true as const,
        orderPublicId: locked.orderPublicId,
        shipmentNumber: locked.shipmentNumber,
        packageNumber: existing.packageNumber,
      };
    }, TRANSACTION_OPTIONS),
  );
}

export async function updateAdminShipmentStatus(
  input: UpdateShipmentStatusInput,
) {
  const authorization = await requirePermission(
    "fulfillment.manage",
    "/admin/fulfillment",
  );

  return getDb().$transaction(async (tx) => {
    const existing = await tx.shipment.findUnique({
      where: { publicId: input.shipmentPublicId },
      select: {
        id: true,
        orderId: true,
        ...shipmentAuditSelect,
        order: {
          select: {
            publicId: true,
            orderNumber: true,
            paymentStatus: true,
            fulfillmentStatus: true,
          },
        },
        items: {
          orderBy: [{ orderItemId: "asc" }],
          select: {
            orderItemId: true,
            quantity: true,
            orderItem: {
              select: {
                productName: true,
                variantName: true,
                sku: true,
                fulfilledQuantity: true,
              },
            },
          },
        },
      },
    });
    if (!existing) return { ok: false as const, reason: "not_found" as const };
    if (!canTransitionShipment(existing.status, input.status)) {
      return { ok: false as const, reason: "invalid_transition" as const };
    }
    if (
      !canTransitionShipmentForPayment(
        existing.order.paymentStatus,
        existing.status,
        input.status,
      )
    ) {
      return { ok: false as const, reason: "payment_not_paid" as const };
    }

    const now = new Date();
    if (input.status === "CANCELED") {
      for (const item of existing.items) {
        const updated = await tx.orderItem.updateMany({
          where: {
            id: item.orderItemId,
            fulfilledQuantity: { gte: item.quantity },
          },
          data: { fulfilledQuantity: { decrement: item.quantity } },
        });
        if (updated.count !== 1) throw new FulfillmentWriteConflictError();
      }
      // The current database quantity guard counts every ShipmentItem. Removing
      // canceled allocations is required so a replacement shipment can be made.
      await tx.shipmentItem.deleteMany({ where: { shipmentId: existing.id } });
    }

    const after = await tx.shipment.update({
      where: { id: existing.id },
      data: shipmentTimestampPatch(existing, input.status, now),
      select: shipmentAuditSelect,
    });
    const fulfillment = await recalculateOrderFulfillment(tx, existing.orderId);
    const lineSnapshot = existing.items.map((item, index) => ({
      lineNumber: index + 1,
      productName: item.orderItem.productName,
      variantName: item.orderItem.variantName,
      sku: item.orderItem.sku,
      quantity: item.quantity,
    }));

    await writeAdminAuditLog(tx, {
      actorUserId: authorization.session.user.id,
      action: "fulfillment.shipment.status.update",
      resourceType: "shipment",
      resourceId: existing.publicId,
      before: {
        shipment: shipmentAuditSnapshot(existing),
        orderPublicId: existing.order.publicId,
        paymentStatus: existing.order.paymentStatus,
        fulfillmentStatus: fulfillment.before,
        orderStatus: fulfillment.orderStatusBefore,
        lines: lineSnapshot,
      },
      after: {
        shipment: after,
        orderPublicId: existing.order.publicId,
        paymentStatus: existing.order.paymentStatus,
        fulfillmentStatus: fulfillment.after,
        orderStatus: fulfillment.orderStatusAfter,
        canceledAllocationsReleased: input.status === "CANCELED",
      },
    });
    if (shouldSendShipmentDispatchEmail(existing.status, after.status)) {
      await enqueueOrderShippedEmail(tx, {
        orderPublicId: existing.order.publicId,
        shipmentPublicId: existing.publicId,
      });
    }
    await tx.outboxEvent.create({
      data: {
        aggregateType: "shipment",
        aggregateId: existing.publicId,
        eventType: "shipment.status_updated",
        payload: {
          shipmentPublicId: existing.publicId,
          orderPublicId: existing.order.publicId,
          paymentStatus: existing.order.paymentStatus,
          statusBefore: existing.status,
          statusAfter: after.status,
          fulfillmentStatus: fulfillment.after,
          orderStatus: fulfillment.orderStatusAfter,
          canceledAllocationsReleased: input.status === "CANCELED",
        },
      },
      select: { id: true },
    });

    return {
      ok: true as const,
      publicId: existing.publicId,
      shipmentNumber: existing.shipmentNumber,
      orderPublicId: existing.order.publicId,
      status: after.status,
    };
  }, TRANSACTION_OPTIONS);
}

export async function addAdminTrackingEvent(input: TrackingEventInput) {
  const authorization = await requirePermission(
    "fulfillment.manage",
    "/admin/fulfillment",
  );

  return getDb().$transaction(async (tx) => {
    const shipment = await tx.shipment.findUnique({
      where: { publicId: input.shipmentPublicId },
      select: {
        id: true,
        orderId: true,
        ...shipmentAuditSelect,
        order: {
          select: {
            publicId: true,
            orderNumber: true,
            paymentStatus: true,
            fulfillmentStatus: true,
          },
        },
      },
    });
    if (!shipment) return { ok: false as const, reason: "not_found" as const };

    const targetStatus = shipmentStatusForTrackingEvent(
      shipment.status,
      input.status,
    );
    if (
      input.status !== "INFO" &&
      !canAdvanceTrackingForPayment(
        shipment.order.paymentStatus,
        shipment.status,
      )
    ) {
      return { ok: false as const, reason: "payment_not_paid" as const };
    }

    const event = await tx.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        status: input.status,
        message: input.message,
        location: input.location,
        occurredAt: input.occurredAt,
      },
      select: trackingEventAuditSelect,
    });

    const afterShipment = targetStatus
      ? await tx.shipment.update({
          where: { id: shipment.id },
          data: shipmentTimestampPatch(
            shipment,
            targetStatus,
            input.occurredAt,
          ),
          select: shipmentAuditSelect,
        })
      : {
          publicId: shipment.publicId,
          shipmentNumber: shipment.shipmentNumber,
          status: shipment.status,
          serviceLevel: shipment.serviceLevel,
          trackingNumber: shipment.trackingNumber,
          estimatedDeliveryAt: shipment.estimatedDeliveryAt,
          shippedAt: shipment.shippedAt,
          deliveredAt: shipment.deliveredAt,
          canceledAt: shipment.canceledAt,
          createdAt: shipment.createdAt,
          updatedAt: shipment.updatedAt,
        };
    const fulfillment = await recalculateOrderFulfillment(tx, shipment.orderId);

    if (shouldSendShipmentDispatchEmail(shipment.status, afterShipment.status)) {
      await enqueueOrderShippedEmail(tx, {
        orderPublicId: shipment.order.publicId,
        shipmentPublicId: shipment.publicId,
      });
    }

    await writeAdminAuditLog(tx, {
      actorUserId: authorization.session.user.id,
      action: "fulfillment.tracking_event.create",
      resourceType: "tracking_event",
      resourceId: event.publicId,
      before: {
        shipment: shipmentAuditSnapshot(shipment),
        orderPublicId: shipment.order.publicId,
        paymentStatus: shipment.order.paymentStatus,
      },
      after: {
        event,
        shipment: afterShipment,
        orderPublicId: shipment.order.publicId,
        paymentStatus: shipment.order.paymentStatus,
        fulfillmentStatus: fulfillment.after,
        orderStatus: fulfillment.orderStatusAfter,
      },
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: "shipment",
        aggregateId: shipment.publicId,
        eventType: "shipment.tracking_event_added",
        payload: {
          trackingEventPublicId: event.publicId,
          shipmentPublicId: shipment.publicId,
          orderPublicId: shipment.order.publicId,
          paymentStatus: shipment.order.paymentStatus,
          eventStatus: event.status,
          shipmentStatusBefore: shipment.status,
          shipmentStatusAfter: afterShipment.status,
          orderStatus: fulfillment.orderStatusAfter,
          occurredAt: event.occurredAt.toISOString(),
        },
      },
      select: { id: true },
    });

    return {
      ok: true as const,
      publicId: event.publicId,
      shipmentNumber: shipment.shipmentNumber,
      orderPublicId: shipment.order.publicId,
      shipmentStatus: afterShipment.status,
    };
  }, TRANSACTION_OPTIONS);
}
