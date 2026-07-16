import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set(["payments.manage", "orders.manage"]),
  })),
}));

import { cancelAdminUnlinkedNowPaymentsPayment } from "@/server/admin/orders/nowpayments-review";
import { getDb } from "@/server/db/client";
import { expireInventoryReservationsBatch } from "@/server/orders/inventory";
import type { NowPaymentsClient } from "@/server/payments/nowpayments/client";
import { processNowPaymentsEvent } from "@/server/payments/nowpayments/process-event";
import { reconcileNowPaymentsPayments } from "@/server/payments/nowpayments/reconcile";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("NOWPayments unlinked invoice reconciliation", () => {
  const suffix = randomUUID();
  const now = new Date();
  const staleAt = new Date(now.getTime() - 2 * 60 * 60 * 1_000);
  let actorUserId = "";
  let customerUserId = "";
  let productId = BigInt(0);
  let variantId = BigInt(0);
  let locationId = BigInt(0);
  let levelId = BigInt(0);
  let orderId = BigInt(0);
  let orderPublicId = "";
  let paymentId = BigInt(0);
  let paymentPublicId = "";
  let reservationId = BigInt(0);
  const providerInvoiceId = `invoice-unlinked-${suffix}`;
  const orderNumber = `UNLINK-${suffix.slice(0, 20).toUpperCase()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const actor = await db.user.create({
      data: {
        name: "Unlinked invoice integration admin",
        email: `unlinked-invoice-admin-${suffix}@example.invalid`,
        emailVerified: true,
      },
      select: { id: true },
    });
    actorUserId = actor.id;
    authorization.actorUserId = actor.id;
    const customer = await db.user.create({
      data: {
        name: "Unlinked invoice integration customer",
        email: `unlinked-invoice-${suffix}@example.invalid`,
      },
      select: { id: true, email: true },
    });
    customerUserId = customer.id;
    const product = await db.product.create({
      data: {
        slug: `unlinked-invoice-${suffix}`,
        title: "Unlinked invoice integration product",
        status: "ACTIVE",
        dataQualityStatus: "VERIFIED",
        publishedAt: staleAt,
      },
      select: { id: true },
    });
    productId = product.id;
    const variant = await db.productVariant.create({
      data: {
        productId,
        title: "Default",
        priceMode: "FIXED",
        status: "ACTIVE",
        trackInventory: true,
        publishedAt: staleAt,
      },
      select: { id: true },
    });
    variantId = variant.id;
    const location = await db.inventoryLocation.create({
      data: {
        code: `UNLINK-${suffix.slice(0, 8).toUpperCase()}`,
        name: "Unlinked invoice integration stock",
        countryCode: "US",
      },
      select: { id: true },
    });
    locationId = location.id;
    const level = await db.inventoryLevel.create({
      data: {
        variantId,
        locationId,
        onHandQuantity: 2,
        reservedQuantity: 0,
      },
      select: { id: true },
    });
    levelId = level.id;
    const order = await db.order.create({
      data: {
        orderNumber,
        userId: customer.id,
        customerEmail: customer.email,
        currency: "USD",
        status: "PENDING_PAYMENT",
        paymentStatus: "PENDING",
        fulfillmentStatus: "UNFULFILLED",
        subtotalMinor: BigInt(1_000),
        totalMinor: BigInt(1_000),
        placedAt: staleAt,
        createdAt: staleAt,
        items: {
          create: {
            productId,
            variantId,
            productName: "Unlinked invoice integration product",
            productSlug: `unlinked-invoice-${suffix}`,
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
    orderId = order.id;
    orderPublicId = order.publicId;
    const orderItem = order.items[0];
    if (!orderItem) throw new Error("Unlinked invoice order item is missing.");
    const payment = await db.payment.create({
      data: {
        orderId,
        method: "NOWPAYMENTS",
        status: "PENDING",
        currency: "USD",
        amountMinor: BigInt(1_000),
        providerInvoiceId,
        providerPaymentId: null,
        checkoutUrl: `https://nowpayments.io/payment/?iid=${providerInvoiceId}`,
        metadata: { providerMode: "mock" },
        createdAt: staleAt,
        updatedAt: staleAt,
      },
      select: { id: true, publicId: true },
    });
    paymentId = payment.id;
    paymentPublicId = payment.publicId;
    const reservation = await db.$transaction(async (tx) => {
      await tx.inventoryLevel.update({
        where: { id: levelId },
        data: { reservedQuantity: { increment: 1 } },
      });
      return tx.inventoryReservation.create({
        data: {
          inventoryLevelId: levelId,
          orderItemId: orderItem.id,
          status: "ACTIVE",
          quantity: 1,
          expiresAt: staleAt,
        },
        select: { id: true },
      });
    });
    reservationId = reservation.id;
  });

  afterAll(async () => {
    if (!customerUserId) return;
    const db = getDb();
    if (actorUserId) {
      await db.auditLog.deleteMany({ where: { actorUserId } });
    }
    if (paymentId) {
      await db.outboxEvent.deleteMany({
        where: { aggregateId: paymentPublicId },
      });
      await db.paymentEvent.deleteMany({ where: { paymentId } });
    }
    if (reservationId) {
      await db.$transaction(async (tx) => {
        const reservation = await tx.inventoryReservation.findUnique({
          where: { id: reservationId },
          select: { status: true, quantity: true, inventoryLevelId: true },
        });
        if (!reservation) return;
        if (reservation.status === "ACTIVE") {
          await tx.inventoryLevel.update({
            where: { id: reservation.inventoryLevelId },
            data: { reservedQuantity: { decrement: reservation.quantity } },
          });
        }
        await tx.inventoryReservation.delete({ where: { id: reservationId } });
      });
    }
    if (paymentId) await db.payment.delete({ where: { id: paymentId } });
    if (orderId) await db.order.delete({ where: { id: orderId } });
    if (levelId) await db.inventoryLevel.delete({ where: { id: levelId } });
    if (locationId) {
      await db.inventoryLocation.delete({ where: { id: locationId } });
    }
    if (variantId) {
      await db.productVariant.delete({ where: { id: variantId } });
    }
    if (productId) await db.product.delete({ where: { id: productId } });
    await db.user.deleteMany({
      where: { id: { in: [customerUserId, actorUserId] } },
    });
  });

  it("raises a monitored review hold and blocks silent inventory expiration", async () => {
    const getPayment = vi.fn(async () => {
      throw new Error("Unlinked invoices must not be queried with an absent payment ID.");
    });
    const client = {
      createInvoice: vi.fn(),
      getPayment,
    } as unknown as NowPaymentsClient;

    const firstReport = await reconcileNowPaymentsPayments(
      {
        batchSize: 100,
        olderThanMinutes: 5,
        unlinkedInvoiceOlderThanMinutes: 5,
        now,
      },
      {
        client,
        config: {
          mode: "mock",
          apiBaseUrl: null,
          apiKey: null,
          ipnSecret: "integration-secret-value",
          timeoutMs: 10_000,
        },
      },
    );

    expect(firstReport.unresolved).toContainEqual({
      paymentPublicId,
      orderPublicId,
      providerInvoiceId,
      newReviewHold: true,
    });
    expect(firstReport.unresolvedInvoices).toBeGreaterThanOrEqual(1);
    expect(firstReport.newReviewHolds).toBeGreaterThanOrEqual(1);
    const expiration = await expireInventoryReservationsBatch({
      limit: 100,
      now,
    });
    expect(expiration.reservations).toBe(0);

    const db = getDb();
    const [payment, order, reservation, level, paymentEvents, outboxEvents] =
      await Promise.all([
        db.payment.findUniqueOrThrow({
          where: { id: paymentId },
          select: { status: true, providerPaymentId: true, metadata: true },
        }),
        db.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { status: true, paymentStatus: true, canceledAt: true },
        }),
        db.inventoryReservation.findUniqueOrThrow({
          where: { id: reservationId },
          select: { status: true },
        }),
        db.inventoryLevel.findUniqueOrThrow({
          where: { id: levelId },
          select: { reservedQuantity: true },
        }),
        db.paymentEvent.count({
          where: {
            paymentId,
            eventType: "nowpayments.reconcile.provider_payment_id_missing",
          },
        }),
        db.outboxEvent.count({
          where: {
            aggregateId: paymentPublicId,
            eventType: "payment.provider_payment_id_missing",
          },
        }),
      ]);

    expect(payment).toMatchObject({
      status: "REVIEW_REQUIRED",
      providerPaymentId: null,
      metadata: { reconciliationIssue: "PROVIDER_PAYMENT_ID_MISSING" },
    });
    expect(order).toEqual({
      status: "PENDING_PAYMENT",
      paymentStatus: "PENDING",
      canceledAt: null,
    });
    expect(reservation.status).toBe("ACTIVE");
    expect(level.reservedQuantity).toBe(1);
    expect(paymentEvents).toBe(1);
    expect(outboxEvents).toBe(1);

    const providerPayload = {
      payment_id: `provider-payment-${suffix}`,
      parent_payment_id: null,
      invoice_id: providerInvoiceId,
      payment_status: "waiting",
      price_amount: "10.00",
      price_currency: "usd",
      pay_amount: "0.001",
      actually_paid: "0",
      actually_paid_at_fiat: "0",
      pay_currency: "btc",
      pay_address: null,
      payin_extra_id: null,
      order_id: orderNumber,
      purchase_id: null,
      outcome_amount: null,
      outcome_currency: null,
    };
    await expect(
      processNowPaymentsEvent({
        source: "reconcile",
        payload: providerPayload,
        rawPayload: providerPayload,
        adminReconciliationAudit: {
          actorUserId: "00000000-0000-4000-8000-000000000001",
          action: "payments.nowpayments.provider_payment_link",
          expectedPaymentPublicId: paymentPublicId,
          expectedProviderMode: "mock",
        },
      }),
    ).rejects.toThrow();
    const rolledBackLink = await db.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { status: true, providerPaymentId: true },
    });
    expect(rolledBackLink).toEqual({
      status: "REVIEW_REQUIRED",
      providerPaymentId: null,
    });

    const canceled = await cancelAdminUnlinkedNowPaymentsPayment({
      paymentPublicId,
      providerInvoiceId,
      confirmation: "CONFIRM_NO_PROVIDER_PAYMENT",
    });
    expect(canceled).toMatchObject({ ok: true, orderClosed: true });

    const [resolvedPayment, closedOrder, releasedReservation, releasedLevel] =
      await Promise.all([
        db.payment.findUniqueOrThrow({
          where: { id: paymentId },
          select: { status: true, providerStatus: true, canceledAt: true },
        }),
        db.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { status: true, paymentStatus: true, canceledAt: true },
        }),
        db.inventoryReservation.findUniqueOrThrow({
          where: { id: reservationId },
          select: { status: true, releasedAt: true },
        }),
        db.inventoryLevel.findUniqueOrThrow({
          where: { id: levelId },
          select: { reservedQuantity: true },
        }),
      ]);
    expect(resolvedPayment).toMatchObject({
      status: "CANCELED",
      providerStatus: "manually_verified_unpaid",
    });
    expect(resolvedPayment.canceledAt).not.toBeNull();
    expect(closedOrder).toMatchObject({
      status: "CANCELED",
      paymentStatus: "VOIDED",
    });
    expect(closedOrder.canceledAt).not.toBeNull();
    expect(releasedReservation.status).toBe("RELEASED");
    expect(releasedReservation.releasedAt).not.toBeNull();
    expect(releasedLevel.reservedQuantity).toBe(0);
  });
});
