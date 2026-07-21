import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set([
      "orders.manage",
      "payments.manage",
      "fulfillment.manage",
    ]),
  })),
}));

import {
  createAdminShipment,
  updateAdminShipmentStatus,
} from "@/server/admin/fulfillment/mutations";
import {
  recordAdminManualPaymentRefund,
  reviewAdminManualPayment,
} from "@/server/admin/orders/mutations";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("manual external refund database lifecycle", () => {
  const suffix = randomUUID();
  const orderIds: bigint[] = [];
  const orderPublicIds: string[] = [];
  const paymentPublicIds: string[] = [];
  const shipmentPublicIds: string[] = [];
  let actorUserId = "";
  let customerUserId = "";
  let productId = BigInt(0);
  let variantId = BigInt(0);
  let locationId = BigInt(0);
  let levelId = BigInt(0);
  let carrierId = BigInt(0);
  let carrierPublicId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const actor = await db.user.create({
      data: {
        name: "Refund integration admin",
        email: `refund-admin-${suffix}@example.invalid`,
      },
      select: { id: true },
    });
    const customer = await db.user.create({
      data: {
        name: "Refund integration customer",
        email: `refund-customer-${suffix}@example.invalid`,
      },
      select: { id: true, email: true },
    });
    actorUserId = actor.id;
    customerUserId = customer.id;
    authorization.actorUserId = actor.id;

    const product = await db.product.create({
      data: {
        slug: `refund-integration-${suffix}`,
        title: "Refund integration product",
        status: "ACTIVE",
        dataQualityStatus: "VERIFIED",
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    productId = product.id;
    const variant = await db.productVariant.create({
      data: {
        productId: product.id,
        title: "Default",
        priceMode: "FIXED",
        status: "ACTIVE",
        trackInventory: true,
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    variantId = variant.id;
    const location = await db.inventoryLocation.create({
      data: {
        code: `REF-${suffix.slice(0, 8).toUpperCase()}`,
        name: "Refund integration stock",
        countryCode: "US",
      },
      select: { id: true },
    });
    locationId = location.id;
    const level = await db.inventoryLevel.create({
      data: {
        variantId: variant.id,
        locationId: location.id,
        onHandQuantity: 10,
        reservedQuantity: 0,
      },
      select: { id: true },
    });
    levelId = level.id;
    const carrier = await db.carrier.create({
      data: {
        code: `REF-${suffix.slice(0, 12).toUpperCase()}`,
        name: "Refund integration carrier",
        isActive: true,
      },
      select: { id: true, publicId: true },
    });
    carrierId = carrier.id;
    carrierPublicId = carrier.publicId;

    for (const method of ["WIRE_TRANSFER", "ZELLE"] as const) {
      const order = await db.order.create({
        data: {
          orderNumber: `RF-${method}-${randomUUID().slice(0, 12)}`,
          userId: customer.id,
          customerEmail: customer.email,
          currency: "USD",
          status: "PENDING_PAYMENT",
          paymentStatus: "PENDING",
          fulfillmentStatus: "UNFULFILLED",
          subtotalMinor: BigInt(1_000),
          totalMinor: BigInt(1_000),
          placedAt: new Date(),
          items: {
            create: {
              productId: product.id,
              variantId: variant.id,
              productName: "Refund integration product",
              productSlug: `refund-integration-${suffix}`,
              variantName: "Default",
              quantity: 1,
              unitPriceMinor: BigInt(1_000),
              lineTotalMinor: BigInt(1_000),
              currency: "USD",
            },
          },
        },
        select: {
          id: true,
          publicId: true,
          items: { select: { id: true }, take: 1 },
        },
      });
      const item = order.items[0];
      if (!item) throw new Error("Refund integration item was not created.");
      const payment = await db.payment.create({
        data: {
          orderId: order.id,
          method,
          status: "PENDING",
          currency: "USD",
          amountMinor: BigInt(1_000),
        },
        select: { publicId: true },
      });
      await db.$transaction(async (tx) => {
        await tx.inventoryLevel.update({
          where: { id: level.id },
          data: { reservedQuantity: { increment: 1 } },
        });
        await tx.inventoryReservation.create({
          data: {
            inventoryLevelId: level.id,
            orderItemId: item.id,
            status: "ACTIVE",
            quantity: 1,
            expiresAt: new Date(Date.now() + 60_000),
          },
        });
      });
      orderIds.push(order.id);
      orderPublicIds.push(order.publicId);
      paymentPublicIds.push(payment.publicId);
    }
  });

  afterAll(async () => {
    if (!actorUserId) return;
    const db = getDb();
    await db.auditLog.deleteMany({ where: { actorUserId } });
    await db.outboxEvent.deleteMany({
      where: {
        aggregateId: {
          in: [...paymentPublicIds, ...shipmentPublicIds],
        },
      },
    });
    await db.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.inventoryMovement.deleteMany({
      where: { referenceId: { in: orderPublicIds } },
    });
    await db.inventoryReservation.deleteMany({
      where: { orderItem: { is: { orderId: { in: orderIds } } } },
    });
    await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
    if (levelId) await db.inventoryLevel.delete({ where: { id: levelId } });
    if (locationId) {
      await db.inventoryLocation.delete({ where: { id: locationId } });
    }
    if (variantId) {
      await db.inventoryCostEntry.deleteMany({ where: { variantId } });
      await db.inventoryCostState.deleteMany({ where: { variantId } });
      await db.productVariant.delete({ where: { id: variantId } });
    }
    if (productId) await db.product.delete({ where: { id: productId } });
    if (carrierId) await db.carrier.delete({ where: { id: carrierId } });
    await db.user.deleteMany({
      where: { id: { in: [actorUserId, customerUserId] } },
    });
  });

  it("blocks draft allocations, restores pre-dispatch stock once, and preserves dispatched stock and tracking", async () => {
    for (const paymentPublicId of paymentPublicIds) {
      const confirmed = await reviewAdminManualPayment({
        paymentPublicId,
        decision: "CONFIRM",
      });
      expect(confirmed).toMatchObject({ ok: true, decision: "CONFIRM" });
    }

    const preDispatchShipment = await createAdminShipment({
      orderPublicId: orderPublicIds[0] as string,
      carrierPublicId,
      serviceLevel: "Ground",
      trackingNumber: "PRE-DISPATCH-REFUND",
      estimatedDeliveryAt: null,
      lineQuantities: [1],
    });
    expect(preDispatchShipment.ok).toBe(true);
    if (!preDispatchShipment.ok) {
      throw new Error("Pre-dispatch shipment was not created.");
    }
    shipmentPublicIds.push(preDispatchShipment.publicId);

    const blocked = await recordAdminManualPaymentRefund({
      paymentPublicId: paymentPublicIds[0] as string,
      refundReference: "WIRE-REFUND-BLOCKED",
      note: null,
      confirmation: "CONFIRM_EXTERNAL_REFUND_COMPLETED",
    });
    expect(blocked).toEqual({
      ok: false,
      reason: "cancel_pre_dispatch_shipments_first",
    });
    expect(
      await getDb().payment.findUniqueOrThrow({
        where: { publicId: paymentPublicIds[0] },
        select: { status: true },
      }),
    ).toEqual({ status: "CONFIRMED" });

    expect(
      await updateAdminShipmentStatus({
        shipmentPublicId: preDispatchShipment.publicId,
        status: "CANCELED",
      }),
    ).toMatchObject({ ok: true, status: "CANCELED" });

    const unresolvedAttempt = await getDb().payment.create({
      data: {
        orderId: orderIds[0] as bigint,
        method: "OTHER_MANUAL",
        status: "PENDING",
        currency: "USD",
        amountMinor: BigInt(1_000),
      },
      select: { id: true },
    });
    expect(
      await recordAdminManualPaymentRefund({
        paymentPublicId: paymentPublicIds[0] as string,
        refundReference: "WIRE-REFUND-UNRESOLVED-ATTEMPT",
        note: null,
        confirmation: "CONFIRM_EXTERNAL_REFUND_COMPLETED",
      }),
    ).toEqual({
      ok: false,
      reason: "other_payment_attempts_require_review",
    });
    await getDb().payment.update({
      where: { id: unresolvedAttempt.id },
      data: { status: "CANCELED", canceledAt: new Date() },
    });

    const dispatchedShipment = await createAdminShipment({
      orderPublicId: orderPublicIds[1] as string,
      carrierPublicId,
      serviceLevel: "Ground",
      trackingNumber: "DISPATCHED-REFUND",
      estimatedDeliveryAt: null,
      lineQuantities: [1],
    });
    expect(dispatchedShipment.ok).toBe(true);
    if (!dispatchedShipment.ok) {
      throw new Error("Dispatched shipment was not created.");
    }
    shipmentPublicIds.push(dispatchedShipment.publicId);
    expect(
      await updateAdminShipmentStatus({
        shipmentPublicId: dispatchedShipment.publicId,
        status: "IN_TRANSIT",
      }),
    ).toMatchObject({ ok: true, status: "IN_TRANSIT" });

    const preDispatchInput = {
      paymentPublicId: paymentPublicIds[0] as string,
      refundReference: "WIRE-REFUND-2026-0001",
      note: "Verified in the bank portal.",
      confirmation: "CONFIRM_EXTERNAL_REFUND_COMPLETED" as const,
    };
    const concurrentPreDispatch = await Promise.all([
      recordAdminManualPaymentRefund(preDispatchInput),
      recordAdminManualPaymentRefund(preDispatchInput),
    ]);
    expect(concurrentPreDispatch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ok: true, duplicate: false }),
        expect.objectContaining({ ok: true, duplicate: true }),
      ]),
    );

    const dispatchedInput = {
      paymentPublicId: paymentPublicIds[1] as string,
      refundReference: "ZELLE-REFUND-2026-0002",
      note: null,
      confirmation: "CONFIRM_EXTERNAL_REFUND_COMPLETED" as const,
    };
    const firstDispatched = await recordAdminManualPaymentRefund(
      dispatchedInput,
    );
    const duplicateDispatched = await recordAdminManualPaymentRefund(
      dispatchedInput,
    );
    expect(firstDispatched).toMatchObject({
      ok: true,
      duplicate: false,
      hasPhysicalDispatch: true,
      inventoryRestoredQuantity: 0,
    });
    expect(duplicateDispatched).toMatchObject({ ok: true, duplicate: true });

    const db = getDb();
    const [orders, payments, shipments, level, returnMovements] =
      await Promise.all([
        db.order.findMany({
          where: { id: { in: orderIds } },
          orderBy: { id: "asc" },
          select: {
            status: true,
            paymentStatus: true,
            fulfillmentStatus: true,
          },
        }),
        db.payment.findMany({
          where: { publicId: { in: paymentPublicIds } },
          orderBy: { id: "asc" },
          select: { status: true, metadata: true },
        }),
        db.shipment.findMany({
          where: { publicId: { in: shipmentPublicIds } },
          orderBy: { id: "asc" },
          select: { status: true, shippedAt: true, trackingNumber: true },
        }),
        db.inventoryLevel.findUniqueOrThrow({
          where: { id: levelId },
          select: { onHandQuantity: true, reservedQuantity: true },
        }),
        db.inventoryMovement.findMany({
          where: {
            referenceId: { in: orderPublicIds },
            type: "RETURN",
          },
          select: { quantityDelta: true, idempotencyKey: true },
        }),
      ]);

    expect(orders[0]).toEqual({
      status: "CANCELED",
      paymentStatus: "REFUNDED",
      fulfillmentStatus: "CANCELED",
    });
    expect(orders[1]).toEqual({
      status: "PROCESSING",
      paymentStatus: "REFUNDED",
      fulfillmentStatus: "FULFILLED",
    });
    expect(payments.map((payment) => payment.status)).toEqual([
      "REFUNDED",
      "REFUNDED",
    ]);
    expect(shipments[0]).toMatchObject({
      status: "CANCELED",
      trackingNumber: "PRE-DISPATCH-REFUND",
    });
    expect(shipments[1]).toMatchObject({
      status: "IN_TRANSIT",
      trackingNumber: "DISPATCHED-REFUND",
    });
    expect(shipments[1]?.shippedAt).not.toBeNull();
    expect(level).toEqual({ onHandQuantity: 9, reservedQuantity: 0 });
    expect(returnMovements).toHaveLength(1);
    expect(returnMovements[0]?.quantityDelta).toBe(1);
    expect(returnMovements[0]?.idempotencyKey).toContain(
      "order-refund-before-dispatch",
    );

    expect(
      await db.paymentEvent.count({
        where: {
          payment: { is: { orderId: { in: orderIds } } },
          eventType: "admin.manual_payment.external_refund_recorded",
        },
      }),
    ).toBe(2);
    expect(
      await db.auditLog.count({
        where: {
          actorUserId,
          action: "payments.manual.external_refund_record",
        },
      }),
    ).toBe(2);
    expect(
      await db.outboxEvent.count({
        where: {
          aggregateId: { in: paymentPublicIds },
          eventType: "payment.manual_external_refund_recorded",
        },
      }),
    ).toBe(2);
  });
});
