import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set(["fulfillment.read", "fulfillment.manage"]),
  })),
}));

import {
  addAdminTrackingEvent,
  createAdminPackage,
  createAdminShipment,
  deleteAdminPackage,
  updateAdminPackage,
  updateAdminShipmentDetails,
  updateAdminShipmentStatus,
} from "@/server/admin/fulfillment/mutations";
import { getAdminFulfillmentIndex } from "@/server/admin/fulfillment/queries";
import { getDb } from "@/server/db/client";
import { getOrderForUser } from "@/server/orders/queries";
import { processNowPaymentsEvent } from "@/server/payments/nowpayments/process-event";
import { nowPaymentsPaymentPayloadSchema } from "@/server/payments/nowpayments/schemas";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("fulfillment order lifecycle database integration", () => {
  const suffix = randomUUID();
  let actorUserId = "";
  let customerUserId = "";
  let customerEmail = "";
  let productId = BigInt(0);
  let variantId = BigInt(0);
  let inventoryLocationId = BigInt(0);
  let inventoryLevelId = BigInt(0);
  let orderId = BigInt(0);
  let orderPublicId = "";
  let carrierId = BigInt(0);
  let carrierPublicId = "";
  let shipmentPublicId = "";
  const refundOrderIds: bigint[] = [];
  const refundOrderPublicIds: string[] = [];
  const refundPaymentPublicIds: string[] = [];
  const refundShipmentPublicIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const actor = await db.user.create({
      data: {
        name: "Fulfillment integration admin",
        email: `fulfillment-admin-${suffix}@example.invalid`,
      },
      select: { id: true },
    });
    const customer = await db.user.create({
      data: {
        name: "Fulfillment integration customer",
        email: `fulfillment-customer-${suffix}@example.invalid`,
      },
      select: { id: true, email: true },
    });
    actorUserId = actor.id;
    customerUserId = customer.id;
    customerEmail = customer.email;
    authorization.actorUserId = actor.id;

    const product = await db.product.create({
      data: {
        slug: `fulfillment-integration-${suffix}`,
        title: "Fulfillment integration product",
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
        code: `ITFUL-${suffix.slice(0, 8).toUpperCase()}`,
        name: "Fulfillment integration inventory",
        countryCode: "US",
      },
      select: { id: true },
    });
    inventoryLocationId = location.id;
    const level = await db.inventoryLevel.create({
      data: {
        variantId: variant.id,
        locationId: location.id,
        onHandQuantity: 10,
      },
      select: { id: true },
    });
    inventoryLevelId = level.id;
    const order = await db.order.create({
      data: {
        orderNumber: `IT-FUL-${randomUUID().slice(0, 12)}`,
        userId: customer.id,
        customerEmail: customer.email,
        currency: "USD",
        status: "CONFIRMED",
        paymentStatus: "PAID",
        fulfillmentStatus: "UNFULFILLED",
        subtotalMinor: BigInt(2_000),
        totalMinor: BigInt(2_000),
        placedAt: new Date(),
        confirmedAt: new Date(),
        items: {
          create: {
            productId: product.id,
            variantId: variant.id,
            productName: "Fulfillment integration product",
            productSlug: `fulfillment-integration-${suffix}`,
            variantName: "Default",
            quantity: 2,
            unitPriceMinor: BigInt(1_000),
            lineTotalMinor: BigInt(2_000),
            currency: "USD",
          },
        },
      },
      select: { id: true, publicId: true },
    });
    orderId = order.id;
    orderPublicId = order.publicId;
    const carrier = await db.carrier.create({
      data: {
        code: `ITFUL-${suffix.slice(0, 8).toUpperCase()}`,
        name: "Integration carrier",
        trackingUrlTemplate: "https://carrier.example/track/{trackingNumber}",
      },
      select: { id: true, publicId: true },
    });
    carrierId = carrier.id;
    carrierPublicId = carrier.publicId;
  });

  afterAll(async () => {
    if (!actorUserId) return;
    const db = getDb();
    await db.auditLog.deleteMany({ where: { actorUserId } });
    const shipmentPublicIds = [
      shipmentPublicId,
      ...refundShipmentPublicIds,
    ].filter(Boolean);
    const eventAggregateIds = [
      ...shipmentPublicIds,
      ...refundPaymentPublicIds,
    ];
    if (eventAggregateIds.length) {
      await db.outboxEvent.deleteMany({
        where: { aggregateId: { in: eventAggregateIds } },
      });
    }
    if (shipmentPublicIds.length) {
      await db.shipment.deleteMany({
        where: { publicId: { in: shipmentPublicIds } },
      });
    }
    if (refundOrderIds.length) {
      await db.inventoryMovement.deleteMany({
        where: { referenceId: { in: refundOrderPublicIds } },
      });
      await db.inventoryReservation.deleteMany({
        where: {
          orderItem: { is: { orderId: { in: refundOrderIds } } },
        },
      });
      await db.payment.deleteMany({
        where: { orderId: { in: refundOrderIds } },
      });
    }
    const allOrderIds = [orderId, ...refundOrderIds].filter(
      (id) => id !== BigInt(0),
    );
    if (allOrderIds.length) {
      await db.order.deleteMany({ where: { id: { in: allOrderIds } } });
    }
    if (carrierId) await db.carrier.delete({ where: { id: carrierId } });
    if (inventoryLevelId) {
      await db.inventoryLevel.delete({ where: { id: inventoryLevelId } });
    }
    if (inventoryLocationId) {
      await db.inventoryLocation.delete({ where: { id: inventoryLocationId } });
    }
    if (variantId) {
      await db.productVariant.delete({ where: { id: variantId } });
    }
    if (productId) await db.product.delete({ where: { id: productId } });
    await db.user.deleteMany({
      where: { id: { in: [actorUserId, customerUserId] } },
    });
  });

  it("moves a confirmed order to processing and completes it only after delivery", async () => {
    const created = await createAdminShipment({
      orderPublicId,
      carrierPublicId,
      serviceLevel: "Ground",
      trackingNumber: "IT-TRACK-123",
      estimatedDeliveryAt: null,
      lineQuantities: [2],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("Shipment was not created.");
    shipmentPublicId = created.publicId;

    const db = getDb();
    const processing = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        status: true,
        fulfillmentStatus: true,
        completedAt: true,
        items: { select: { fulfilledQuantity: true } },
      },
    });
    expect(processing).toMatchObject({
      status: "PROCESSING",
      fulfillmentStatus: "FULFILLED",
      completedAt: null,
      items: [{ fulfilledQuantity: 2 }],
    });

    const estimatedDeliveryAt = new Date("2026-07-20T17:00:00-04:00");
    await expect(
      updateAdminShipmentDetails({
        shipmentPublicId,
        serviceLevel: "Priority Ground",
        trackingNumber: "IT-TRACK-123",
        estimatedDeliveryAt,
      }),
    ).resolves.toMatchObject({ ok: true, duplicate: false });
    const parcel = await createAdminPackage({
      shipmentPublicId,
      weightGrams: 250,
      lengthMillimeters: 100,
      widthMillimeters: 80,
      heightMillimeters: 50,
    });
    expect(parcel).toMatchObject({ ok: true, packageNumber: 1 });
    if (!parcel.ok) throw new Error("Package was not created.");
    await expect(
      updateAdminPackage({
        packagePublicId: parcel.publicId,
        weightGrams: 275,
        lengthMillimeters: 100,
        widthMillimeters: 80,
        heightMillimeters: 50,
      }),
    ).resolves.toMatchObject({ ok: true, duplicate: false });

    await expect(getOrderForUser(customerUserId, orderPublicId)).resolves.toMatchObject({
      shipments: [{
        estimatedDeliveryAt: estimatedDeliveryAt.toISOString(),
        packages: [{ packageNumber: 1, weightGrams: 275 }],
      }],
    });

    await expect(
      updateAdminShipmentStatus({ shipmentPublicId, status: "IN_TRANSIT" }),
    ).resolves.toMatchObject({ ok: true, status: "IN_TRANSIT" });
    await expect(
      deleteAdminPackage({ packagePublicId: parcel.publicId }),
    ).resolves.toEqual({ ok: false, reason: "shipment_locked" });
    await expect(
      updateAdminShipmentStatus({ shipmentPublicId, status: "DELIVERED" }),
    ).resolves.toMatchObject({ ok: true, status: "DELIVERED" });

    const completed = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, fulfillmentStatus: true, completedAt: true },
    });
    expect(completed).toMatchObject({
      status: "COMPLETED",
      fulfillmentStatus: "FULFILLED",
    });
    expect(completed.completedAt).not.toBeNull();
    await expect(
      db.auditLog.count({ where: { actorUserId } }),
    ).resolves.toBe(6);
    await expect(
      db.outboxEvent.count({ where: { aggregateId: shipmentPublicId } }),
    ).resolves.toBe(6);
  });

  async function createPendingNowPaymentsOrder(quantity: number) {
    const db = getDb();
    const orderNumber = `IT-NOW-${randomUUID().slice(0, 12)}`;
    const created = await db.order.create({
      data: {
        orderNumber,
        userId: customerUserId,
        customerEmail,
        currency: "USD",
        status: "PENDING_PAYMENT",
        paymentStatus: "PENDING",
        fulfillmentStatus: "UNFULFILLED",
        subtotalMinor: BigInt(quantity * 1_000),
        totalMinor: BigInt(quantity * 1_000),
        placedAt: new Date(),
        items: {
          create: {
            productId,
            variantId,
            productName: "Fulfillment integration product",
            productSlug: `fulfillment-integration-${suffix}`,
            variantName: "Default",
            quantity,
            unitPriceMinor: BigInt(1_000),
            lineTotalMinor: BigInt(quantity * 1_000),
            currency: "USD",
          },
        },
      },
      select: {
        id: true,
        publicId: true,
        orderNumber: true,
        items: { select: { id: true }, take: 1 },
      },
    });
    const item = created.items[0];
    if (!item) throw new Error("Refund integration order item is missing.");

    await db.$transaction(async (tx) => {
      await tx.inventoryLevel.update({
        where: { id: inventoryLevelId },
        data: { reservedQuantity: { increment: quantity } },
      });
      await tx.inventoryReservation.create({
        data: {
          inventoryLevelId,
          orderItemId: item.id,
          status: "ACTIVE",
          quantity,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
    });

    const providerPaymentId = `it-payment-${randomUUID()}`;
    const providerInvoiceId = `it-invoice-${randomUUID()}`;
    const payment = await db.payment.create({
      data: {
        orderId: created.id,
        method: "NOWPAYMENTS",
        status: "PENDING",
        currency: "USD",
        amountMinor: BigInt(quantity * 1_000),
        providerPaymentId,
        providerInvoiceId,
      },
      select: { publicId: true },
    });
    refundOrderIds.push(created.id);
    refundOrderPublicIds.push(created.publicId);
    refundPaymentPublicIds.push(payment.publicId);
    return {
      id: created.id,
      publicId: created.publicId,
      orderNumber: created.orderNumber,
      providerPaymentId,
      providerInvoiceId,
      priceAmount: `${quantity * 10}.00`,
    };
  }

  async function processProviderStatus(
    order: Awaited<ReturnType<typeof createPendingNowPaymentsOrder>>,
    status: "finished" | "refunded",
    sequence: number,
  ) {
    const timestamp = new Date(
      Date.UTC(2026, 6, 13, 12, 0, sequence),
    ).toISOString();
    const rawPayload = {
      payment_id: order.providerPaymentId,
      parent_payment_id: null,
      invoice_id: order.providerInvoiceId,
      payment_status: status,
      price_amount: order.priceAmount,
      price_currency: "usd",
      pay_amount: "1",
      actually_paid: "1",
      actually_paid_at_fiat: order.priceAmount,
      pay_currency: "mock",
      pay_address: null,
      payin_extra_id: null,
      order_id: order.orderNumber,
      purchase_id: null,
      outcome_amount: null,
      outcome_currency: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    return processNowPaymentsEvent({
      source: "ipn",
      payload: nowPaymentsPaymentPayloadSchema.parse(rawPayload),
      rawPayload,
    });
  }

  it("blocks and restocks a refunded order before physical dispatch", async () => {
    const order = await createPendingNowPaymentsOrder(2);
    await expect(processProviderStatus(order, "finished", 1)).resolves.toMatchObject({
      status: "CONFIRMED",
      orderPaymentStatus: "PAID",
    });

    const draft = await createAdminShipment({
      orderPublicId: order.publicId,
      carrierPublicId,
      serviceLevel: "Ground",
      trackingNumber: `PRE-${randomUUID().slice(0, 12)}`,
      estimatedDeliveryAt: null,
      lineQuantities: [1],
    });
    expect(draft).toMatchObject({ ok: true });
    if (!draft.ok) throw new Error("Pre-refund draft shipment was not created.");
    refundShipmentPublicIds.push(draft.publicId);

    const db = getDb();
    await expect(
      db.inventoryLevel.findUniqueOrThrow({
        where: { id: inventoryLevelId },
        select: { onHandQuantity: true, reservedQuantity: true },
      }),
    ).resolves.toEqual({ onHandQuantity: 8, reservedQuantity: 0 });

    await expect(processProviderStatus(order, "refunded", 2)).resolves.toMatchObject({
      status: "REFUNDED",
      orderPaymentStatus: "REFUNDED",
      orderStatus: "CANCELED",
      fulfillmentStatus: "CANCELED",
      fulfillmentBlockedReason: "PAYMENT_REFUNDED_BEFORE_DISPATCH",
      canceledPreDispatchShipmentCount: 1,
      restoredInventoryQuantity: 2,
    });
    await expect(
      db.order.findUniqueOrThrow({
        where: { id: order.id },
        select: {
          status: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          cancellationReason: true,
        },
      }),
    ).resolves.toMatchObject({
      status: "CANCELED",
      paymentStatus: "REFUNDED",
      fulfillmentStatus: "CANCELED",
      cancellationReason:
        "Payment was refunded before physical dispatch; fulfillment is blocked.",
    });
    await expect(
      db.shipment.findUniqueOrThrow({
        where: { publicId: draft.publicId },
        select: {
          status: true,
          canceledAt: true,
          _count: { select: { items: true } },
        },
      }),
    ).resolves.toMatchObject({
      status: "CANCELED",
      _count: { items: 0 },
    });
    await expect(
      db.orderItem.findFirstOrThrow({
        where: { orderId: order.id },
        select: { fulfilledQuantity: true },
      }),
    ).resolves.toEqual({ fulfilledQuantity: 0 });
    await expect(
      db.inventoryLevel.findUniqueOrThrow({
        where: { id: inventoryLevelId },
        select: { onHandQuantity: true, reservedQuantity: true },
      }),
    ).resolves.toEqual({ onHandQuantity: 10, reservedQuantity: 0 });
    await expect(
      db.inventoryMovement.count({
        where: {
          referenceId: order.publicId,
          type: "RETURN",
        },
      }),
    ).resolves.toBe(1);

    await expect(
      createAdminShipment({
        orderPublicId: order.publicId,
        carrierPublicId,
        serviceLevel: "Ground",
        trackingNumber: `POST-${randomUUID().slice(0, 12)}`,
        estimatedDeliveryAt: null,
        lineQuantities: [1],
      }),
    ).resolves.toEqual({ ok: false, reason: "payment_not_paid" });
    await expect(
      updateAdminShipmentStatus({
        shipmentPublicId: draft.publicId,
        status: "IN_TRANSIT",
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid_transition" });
    await expect(
      addAdminTrackingEvent({
        shipmentPublicId: draft.publicId,
        status: "PICKED_UP",
        message: null,
        location: null,
        occurredAt: new Date("2026-07-13T12:00:03Z"),
      }),
    ).resolves.toEqual({ ok: false, reason: "payment_not_paid" });

    const index = await getAdminFulfillmentIndex();
    expect(index.pendingOrders).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ publicId: order.publicId })]),
    );

    await expect(processProviderStatus(order, "refunded", 4)).resolves.toMatchObject({
      orderPaymentStatus: "REFUNDED",
      restoredInventoryQuantity: 0,
    });
    await expect(
      db.inventoryLevel.findUniqueOrThrow({
        where: { id: inventoryLevelId },
        select: { onHandQuantity: true },
      }),
    ).resolves.toEqual({ onHandQuantity: 10 });

  }, 20_000);

  it("keeps an in-transit refunded shipment trackable without restocking", async () => {
    const order = await createPendingNowPaymentsOrder(1);
    await processProviderStatus(order, "finished", 5);
    const created = await createAdminShipment({
      orderPublicId: order.publicId,
      carrierPublicId,
      serviceLevel: "Ground",
      trackingNumber: `TRANSIT-${randomUUID().slice(0, 12)}`,
      estimatedDeliveryAt: null,
      lineQuantities: [1],
    });
    if (!created.ok) throw new Error("In-transit test shipment was not created.");
    refundShipmentPublicIds.push(created.publicId);
    await updateAdminShipmentStatus({
      shipmentPublicId: created.publicId,
      status: "IN_TRANSIT",
    });

    await expect(processProviderStatus(order, "refunded", 6)).resolves.toMatchObject({
      orderPaymentStatus: "REFUNDED",
      orderStatus: "PROCESSING",
      fulfillmentBlockedReason: "PAYMENT_NOT_PAID",
      restoredInventoryQuantity: 0,
    });
    const db = getDb();
    await expect(
      db.shipment.findUniqueOrThrow({
        where: { publicId: created.publicId },
        select: { status: true, shippedAt: true },
      }),
    ).resolves.toMatchObject({ status: "IN_TRANSIT" });
    await expect(
      db.inventoryLevel.findUniqueOrThrow({
        where: { id: inventoryLevelId },
        select: { onHandQuantity: true },
      }),
    ).resolves.toEqual({ onHandQuantity: 9 });
    await expect(
      updateAdminShipmentStatus({
        shipmentPublicId: created.publicId,
        status: "DELIVERED",
      }),
    ).resolves.toMatchObject({ ok: true, status: "DELIVERED" });
  }, 20_000);
});
