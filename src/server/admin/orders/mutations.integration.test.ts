import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set(["orders.manage", "payments.manage"]),
  })),
}));

import { reviewAdminManualPayment } from "@/server/admin/orders/mutations";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("manual payment review database lifecycle", () => {
  const suffix = randomUUID();
  let actorUserId = "";
  let customerUserId = "";
  let productId = BigInt(0);
  let variantId = BigInt(0);
  let locationId = BigInt(0);
  let levelId = BigInt(0);
  const orderIds: bigint[] = [];
  const orderPublicIds: string[] = [];
  const paymentPublicIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const actor = await db.user.create({
      data: {
        name: "Payment integration admin",
        email: `payment-admin-${suffix}@example.invalid`,
      },
      select: { id: true },
    });
    const customer = await db.user.create({
      data: {
        name: "Payment integration customer",
        email: `payment-customer-${suffix}@example.invalid`,
      },
      select: { id: true, email: true },
    });
    actorUserId = actor.id;
    customerUserId = customer.id;
    authorization.actorUserId = actor.id;

    const product = await db.product.create({
      data: {
        slug: `payment-integration-${suffix}`,
        title: "Payment integration product",
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
        code: `PAY-${suffix.slice(0, 8).toUpperCase()}`,
        name: "Payment integration stock",
        countryCode: "US",
      },
      select: { id: true },
    });
    locationId = location.id;
    const level = await db.inventoryLevel.create({
      data: {
        variantId: variant.id,
        locationId: location.id,
        onHandQuantity: 5,
        reservedQuantity: 0,
      },
      select: { id: true },
    });
    levelId = level.id;

    for (const method of ["WIRE_TRANSFER", "ZELLE"] as const) {
      const order = await db.order.create({
        data: {
          orderNumber: `IT-${method}-${randomUUID().slice(0, 12)}`,
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
              productName: "Payment integration product",
              productSlug: `payment-integration-${suffix}`,
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
      if (!item) throw new Error("Integration order item was not created.");
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
      where: { aggregateId: { in: paymentPublicIds } },
    });
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
      await db.productVariant.delete({ where: { id: variantId } });
    }
    if (productId) await db.product.delete({ where: { id: productId } });
    await db.user.deleteMany({
      where: { id: { in: [actorUserId, customerUserId] } },
    });
  });

  it("consumes inventory on confirmation and releases it on terminal rejection", async () => {
    const confirmed = await reviewAdminManualPayment({
      paymentPublicId: paymentPublicIds[0] as string,
      decision: "CONFIRM",
    });
    const rejected = await reviewAdminManualPayment({
      paymentPublicId: paymentPublicIds[1] as string,
      decision: "REJECT",
    });

    expect(confirmed).toMatchObject({ ok: true, decision: "CONFIRM" });
    expect(rejected).toMatchObject({ ok: true, decision: "REJECT" });

    const db = getDb();
    const [orders, payments, reservations, level, auditCount, outboxCount] =
      await Promise.all([
        db.order.findMany({
          where: { id: { in: orderIds } },
          orderBy: { id: "asc" },
          select: {
            status: true,
            paymentStatus: true,
            confirmedAt: true,
            canceledAt: true,
          },
        }),
        db.payment.findMany({
          where: { publicId: { in: paymentPublicIds } },
          orderBy: { id: "asc" },
          select: { status: true, confirmedAt: true, failedAt: true },
        }),
        db.inventoryReservation.findMany({
          where: { orderItem: { is: { orderId: { in: orderIds } } } },
          orderBy: { id: "asc" },
          select: { status: true, consumedAt: true, releasedAt: true },
        }),
        db.inventoryLevel.findUniqueOrThrow({
          where: { id: levelId },
          select: { onHandQuantity: true, reservedQuantity: true },
        }),
        db.auditLog.count({ where: { actorUserId } }),
        db.outboxEvent.count({
          where: { aggregateId: { in: paymentPublicIds } },
        }),
      ]);

    expect(orders[0]).toMatchObject({
      status: "CONFIRMED",
      paymentStatus: "PAID",
    });
    expect(orders[0]?.confirmedAt).not.toBeNull();
    expect(orders[1]).toMatchObject({
      status: "CANCELED",
      paymentStatus: "FAILED",
    });
    expect(orders[1]?.canceledAt).not.toBeNull();
    expect(payments[0]?.status).toBe("CONFIRMED");
    expect(payments[0]?.confirmedAt).not.toBeNull();
    expect(payments[1]?.status).toBe("FAILED");
    expect(payments[1]?.failedAt).not.toBeNull();
    expect(reservations[0]?.status).toBe("CONSUMED");
    expect(reservations[0]?.consumedAt).not.toBeNull();
    expect(reservations[1]?.status).toBe("RELEASED");
    expect(reservations[1]?.releasedAt).not.toBeNull();
    expect(level).toEqual({ onHandQuantity: 4, reservedQuantity: 0 });
    expect(auditCount).toBe(2);
    expect(outboxCount).toBe(2);
  });
});
