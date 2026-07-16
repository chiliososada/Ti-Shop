import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set([
      "finance.read",
      "finance.returns.manage",
      "finance.procurement.manage",
    ]),
  })),
  authorizeApiPermission: vi.fn(async () => ({
    ok: true,
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set(["finance.returns.manage"]),
  })),
}));

import { Prisma } from "@/generated/prisma/client";
import {
  approveAfterSalesEvent,
  attachCompensationToOrder,
  completeAfterSalesEvent,
  upsertAfterSalesEvent,
  upsertAfterSalesItem,
} from "@/server/admin/finance/after-sales/mutations";
import { getDb } from "@/server/db/client";
import { applyCostReceipt } from "@/server/finance/inventory-costing";
import {
  consumeOrderInventoryReservations,
  releaseOrderInventoryReservations,
  reserveOrderItemInventory,
  restoreOrderInventoryAfterPreDispatchRefund,
} from "@/server/orders/inventory";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

const b = BigInt;

integration("after-sales economics (returns, refunds, compensation)", () => {
  const suffix = randomUUID();
  let customerId = "";
  let variantId = b(0);
  let productId = b(0);
  let locationId = b(0);
  let locationPublicId = "";
  let orderSeq = 0;

  async function seedValuedStock(quantity: number, totalUsdMinor: bigint) {
    await getDb().$transaction(async (tx) => {
      await applyCostReceipt(tx, {
        variantId,
        quantity,
        totalCostUsdMinor: totalUsdMinor,
        entryType: "PROCUREMENT_RECEIPT",
        referenceType: "test_seed",
        referenceId: randomUUID(),
        idempotencyKey: `seed:${randomUUID()}`,
        actorUserId: authorization.actorUserId,
      });
      await tx.inventoryLevel.upsert({
        where: { variantId_locationId: { variantId, locationId } },
        create: { variantId, locationId, onHandQuantity: quantity },
        update: { onHandQuantity: { increment: quantity } },
        select: { id: true },
      });
    });
  }

  /** Creates a paid order with locked cost snapshots via the real pipeline. */
  async function createPaidOrder(quantity: number, unitPriceMinor: bigint) {
    orderSeq += 1;
    const db = getDb();
    const now = new Date();
    const order = await db.order.create({
      data: {
        orderNumber: `AS-IT-${suffix.slice(0, 6)}-${orderSeq}`,
        userId: customerId,
        customerEmail: `as-it-${suffix}@example.invalid`,
        status: "PENDING_PAYMENT",
        paymentStatus: "PENDING",
        subtotalMinor: unitPriceMinor * b(quantity),
        shippingMinor: b(1_500),
        taxMinor: b(0),
        totalMinor: unitPriceMinor * b(quantity) + b(1_500),
        placedAt: now,
        items: {
          create: {
            productId,
            variantId,
            productName: "AS IT product",
            quantity,
            unitPriceMinor,
            lineTotalMinor: unitPriceMinor * b(quantity),
          },
        },
      },
      select: { id: true, publicId: true, items: { select: { id: true } } },
    });
    await db.$transaction(
      async (tx) => {
        await reserveOrderItemInventory(tx, {
          variantId,
          orderItemId: order.items[0].id,
          quantity,
          now,
          expiresAt: new Date(now.getTime() + 3_600_000),
        });
        await consumeOrderInventoryReservations(tx, order.id, now);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
    );
    await db.order.update({
      where: { id: order.id },
      data: { status: "CONFIRMED", paymentStatus: "PAID", confirmedAt: now },
      select: { id: true },
    });
    return { orderId: order.id, orderPublicId: order.publicId, orderItemId: order.items[0].id };
  }

  async function createEvent(
    orderPublicId: string,
    overrides?: Partial<Parameters<typeof upsertAfterSalesEvent>[0]>,
  ) {
    const created = await upsertAfterSalesEvent({
      orderPublicId,
      responsibility: "MERCHANT",
      reason: "integration scenario",
      refundAmount: b(0),
      shippingRefund: b(0),
      returnShippingCost: b(0),
      compensationShippingCost: b(0),
      evidenceNotes: "",
      ...overrides,
    });
    if (!created.ok) throw new Error(created.message);
    return created.publicId;
  }

  async function adjustments(orderId: bigint) {
    return getDb().financialAdjustment.findMany({
      where: { orderId },
      orderBy: { id: "asc" },
      select: { type: true, signedUsdMinor: true, isEstimated: true },
    });
  }

  async function costState() {
    return getDb().inventoryCostState.findUniqueOrThrow({
      where: { variantId },
      select: { quantity: true, totalCostUsdMinor: true },
    });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const actor = await db.user.create({
      data: {
        name: "After-sales integration admin",
        email: `as-admin-${suffix}@example.invalid`,
        adminProfile: { create: { isActive: true } },
      },
      select: { id: true },
    });
    authorization.actorUserId = actor.id;
    const customer = await db.user.create({
      data: { name: "AS customer", email: `as-customer-${suffix}@example.invalid` },
      select: { id: true },
    });
    customerId = customer.id;

    const product = await db.product.create({
      data: {
        slug: `as-it-${suffix.slice(0, 8)}`,
        title: "AS IT product",
        variants: {
          create: {
            title: "Default",
            sku: `AS-IT-${suffix.slice(0, 8).toUpperCase()}`,
            trackInventory: true,
          },
        },
      },
      select: { id: true, variants: { select: { id: true } } },
    });
    productId = product.id;
    variantId = product.variants[0].id;

    const location = await db.inventoryLocation.create({
      data: { code: `AS-IT-${suffix.slice(0, 8)}`, name: "AS IT warehouse" },
      select: { id: true, publicId: true },
    });
    locationId = location.id;
    locationPublicId = location.publicId;

    // 20 units valued at $10.00 each.
    await seedValuedStock(20, b(20_000));
  });

  afterAll(async () => {
    const db = getDb();
    await db.financialAdjustment.deleteMany({ where: { order: { userId: customerId } } });
    await db.afterSalesItem.deleteMany({ where: { event: { order: { userId: customerId } } } });
    await db.afterSalesEvent.deleteMany({ where: { order: { userId: customerId } } });
    await db.inventoryCostEntry.deleteMany({ where: { variantId } });
    await db.inventoryCostState.deleteMany({ where: { variantId } });
    await db.inventoryMovement.deleteMany({ where: { inventoryLevel: { variantId } } });
    await db.inventoryReservation.deleteMany({ where: { inventoryLevel: { variantId } } });
    // Deleting the orders cascades their items; removing items first would
    // violate the order-totals integrity trigger.
    await db.order.deleteMany({ where: { userId: customerId } });
    await db.inventoryLevel.deleteMany({ where: { variantId } });
    await db.productVariant.delete({ where: { id: variantId } });
    await db.product.delete({ where: { id: productId } });
    await db.auditLog.deleteMany({ where: { actorUserId: authorization.actorUserId } });
    await db.outboxEvent.deleteMany({ where: { aggregateType: "finance" } });
    await db.user.deleteMany({ where: { id: { in: [authorization.actorUserId, customerId] } } });
  });

  it("locks cost snapshots when a paid order consumes inventory", async () => {
    const { orderItemId } = await createPaidOrder(2, b(5_000));
    const item = await getDb().orderItem.findUniqueOrThrow({
      where: { id: orderItemId },
      select: { unitCostUsdMinor: true, totalCogsUsdMinor: true, costMethod: true },
    });
    expect(item.unitCostUsdMinor).toBe(b(1_000));
    expect(item.totalCogsUsdMinor).toBe(b(2_000));
    expect(item.costMethod).toBe("MOVING_AVERAGE");
    const state = await costState();
    expect(state).toEqual({ quantity: 18, totalCostUsdMinor: b(18_000) });
  });

  it("full refund with a resalable return restores stock value and reverses COGS", async () => {
    const { orderId, orderPublicId, orderItemId } = await createPaidOrder(2, b(5_000));
    const before = await costState();

    const eventId = await createEvent(orderPublicId, {
      refundAmount: b(10_000),
      shippingRefund: b(1_500),
      returnShippingCost: b(800),
    });
    const added = await upsertAfterSalesItem({
      eventPublicId: eventId,
      kind: "RETURN",
      orderItemId: orderItemId.toString(),
      quantity: 2,
      disposition: "RESALABLE",
    });
    expect(added.ok).toBe(true);
    expect((await approveAfterSalesEvent(eventId)).ok).toBe(true);
    const completed = await completeAfterSalesEvent({
      eventPublicId: eventId,
      locationPublicId,
    });
    expect(completed.ok).toBe(true);

    const rows = await adjustments(orderId);
    expect(rows.map((row) => [row.type, row.signedUsdMinor])).toEqual([
      ["REFUND", b(-10_000)],
      ["SHIPPING_REFUND", b(-1_500)],
      ["RETURN_SHIPPING", b(-800)],
      ["COST_CORRECTION", b(2_000)],
    ]);

    const after = await costState();
    expect(after.quantity).toBe(before.quantity + 2);
    expect(after.totalCostUsdMinor).toBe(before.totalCostUsdMinor + b(2_000));

    const movement = await getDb().inventoryMovement.findFirst({
      where: { type: "RETURN_RESTOCK", referenceId: eventId },
      select: { quantityDelta: true },
    });
    expect(movement?.quantityDelta).toBe(2);

    // Completing again is a no-op (no duplicated adjustments or stock).
    const again = await completeAfterSalesEvent({ eventPublicId: eventId, locationPublicId });
    expect(again.ok).toBe(true);
    expect((await adjustments(orderId)).length).toBe(4);
    expect((await costState()).quantity).toBe(after.quantity);
  });

  it("damaged returns reclassify the loss without restocking", async () => {
    const { orderId, orderPublicId, orderItemId } = await createPaidOrder(1, b(5_000));
    const before = await costState();

    const eventId = await createEvent(orderPublicId, { refundAmount: b(5_000) });
    await upsertAfterSalesItem({
      eventPublicId: eventId,
      kind: "RETURN",
      orderItemId: orderItemId.toString(),
      quantity: 1,
      disposition: "DAMAGED",
    });
    await approveAfterSalesEvent(eventId);
    const completed = await completeAfterSalesEvent({ eventPublicId: eventId, locationPublicId });
    expect(completed.ok).toBe(true);

    const rows = await adjustments(orderId);
    expect(rows.map((row) => [row.type, row.signedUsdMinor])).toEqual([
      ["REFUND", b(-5_000)],
      ["COST_CORRECTION", b(1_000)],
      ["DAMAGED_RETURN", b(-1_000)],
    ]);
    // No restock: valuation unchanged.
    expect(await costState()).toEqual(before);
  });

  it("refund without return keeps COGS untouched", async () => {
    const { orderId, orderPublicId, orderItemId } = await createPaidOrder(1, b(5_000));
    const before = await costState();
    const eventId = await createEvent(orderPublicId, { refundAmount: b(5_000) });
    await upsertAfterSalesItem({
      eventPublicId: eventId,
      kind: "RETURN",
      orderItemId: orderItemId.toString(),
      quantity: 1,
      disposition: "LOST",
    });
    await approveAfterSalesEvent(eventId);
    expect((await completeAfterSalesEvent({ eventPublicId: eventId, locationPublicId })).ok).toBe(true);
    const rows = await adjustments(orderId);
    expect(rows.map((row) => [row.type, row.signedUsdMinor])).toEqual([
      ["REFUND", b(-5_000)],
    ]);
    expect(await costState()).toEqual(before);
  });

  it("rejects refunds beyond what the customer paid", async () => {
    const { orderPublicId } = await createPaidOrder(1, b(5_000)); // paid $65 incl. shipping
    const eventId = await createEvent(orderPublicId, { refundAmount: b(10_000) });
    await approveAfterSalesEvent(eventId);
    const completed = await completeAfterSalesEvent({ eventPublicId: eventId, locationPublicId });
    expect(!completed.ok && completed.reason).toBe("refund_exceeds");
  });

  it("caps cumulative returned units across events (no double restock/COGS reversal)", async () => {
    const { orderId, orderPublicId, orderItemId } = await createPaidOrder(2, b(5_000));
    const before = await costState();

    const firstEvent = await createEvent(orderPublicId);
    expect(
      (
        await upsertAfterSalesItem({
          eventPublicId: firstEvent,
          kind: "RETURN",
          orderItemId: orderItemId.toString(),
          quantity: 2,
          disposition: "RESALABLE",
        })
      ).ok,
    ).toBe(true);
    await approveAfterSalesEvent(firstEvent);
    expect(
      (await completeAfterSalesEvent({ eventPublicId: firstEvent, locationPublicId })).ok,
    ).toBe(true);

    // A second zero-refund event cannot return the same units again — neither
    // at item creation nor (defense in depth) at completion.
    const secondEvent = await createEvent(orderPublicId);
    const secondItem = await upsertAfterSalesItem({
      eventPublicId: secondEvent,
      kind: "RETURN",
      orderItemId: orderItemId.toString(),
      quantity: 1,
      disposition: "RESALABLE",
    });
    expect(!secondItem.ok && secondItem.reason).toBe("quantity_exceeds");

    // Stock and COGS reversal happened exactly once.
    const after = await costState();
    expect(after.quantity).toBe(before.quantity + 2);
    expect(after.totalCostUsdMinor).toBe(before.totalCostUsdMinor + b(2_000));
    const corrections = (await adjustments(orderId)).filter(
      (row) => row.type === "COST_CORRECTION",
    );
    expect(corrections).toHaveLength(1);
  });

  it("dedicated compensation ships goods out at the moving average", async () => {
    const { orderId, orderPublicId } = await createPaidOrder(1, b(5_000));
    const before = await costState();
    const eventId = await createEvent(orderPublicId, {
      compensationShippingCost: b(600),
    });
    await upsertAfterSalesItem({
      eventPublicId: eventId,
      kind: "COMPENSATION",
      quantity: 1,
      variantPublicId: (
        await getDb().productVariant.findUniqueOrThrow({
          where: { id: variantId },
          select: { publicId: true },
        })
      ).publicId,
      compensationDelivery: "DEDICATED_SHIPMENT",
    });
    await approveAfterSalesEvent(eventId);
    expect((await completeAfterSalesEvent({ eventPublicId: eventId, locationPublicId })).ok).toBe(true);

    const rows = await adjustments(orderId);
    expect(rows.map((row) => [row.type, row.signedUsdMinor])).toEqual([
      ["COMPENSATION_SHIPPING", b(-600)],
      ["COMPENSATION_PRODUCT", b(-1_000)],
    ]);
    const after = await costState();
    expect(after.quantity).toBe(before.quantity - 1);
    expect(after.totalCostUsdMinor).toBe(before.totalCostUsdMinor - b(1_000));
    const movement = await getDb().inventoryMovement.findFirst({
      where: { type: "GOODWILL_GIFT", referenceId: eventId },
      select: { quantityDelta: true },
    });
    expect(movement?.quantityDelta).toBe(-1);
  });

  it("next-order gifts sell at zero, cost the original order exactly once", async () => {
    const original = await createPaidOrder(1, b(5_000));
    const eventId = await createEvent(original.orderPublicId, {});
    const variantPublicId = (
      await getDb().productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { publicId: true },
      })
    ).publicId;
    await upsertAfterSalesItem({
      eventPublicId: eventId,
      kind: "COMPENSATION",
      quantity: 1,
      variantPublicId,
      compensationDelivery: "NEXT_ORDER",
    });
    await approveAfterSalesEvent(eventId);
    expect((await completeAfterSalesEvent({ eventPublicId: eventId, locationPublicId })).ok).toBe(true);
    // Completion does NOT book the next-order gift cost yet.
    expect(
      (await adjustments(original.orderId)).filter((row) => row.type === "COMPENSATION_PRODUCT"),
    ).toHaveLength(0);

    // Customer's next order (unpaid).
    const db = getDb();
    const now = new Date();
    orderSeq += 1;
    const nextOrder = await db.order.create({
      data: {
        orderNumber: `AS-IT-${suffix.slice(0, 6)}-${orderSeq}`,
        userId: customerId,
        customerEmail: `as-it-${suffix}@example.invalid`,
        status: "PENDING_PAYMENT",
        paymentStatus: "PENDING",
        subtotalMinor: b(5_000),
        shippingMinor: b(1_500),
        totalMinor: b(6_500),
        placedAt: now,
        items: {
          create: {
            productId,
            variantId,
            productName: "AS IT product",
            quantity: 1,
            unitPriceMinor: b(5_000),
            lineTotalMinor: b(5_000),
          },
        },
      },
      select: { id: true, publicId: true, items: { select: { id: true } } },
    });
    await db.$transaction(async (tx) => {
      await reserveOrderItemInventory(tx, {
        variantId,
        orderItemId: nextOrder.items[0].id,
        quantity: 1,
        now,
        expiresAt: new Date(now.getTime() + 3_600_000),
      });
    });

    const item = await getDb().afterSalesItem.findFirstOrThrow({
      where: { event: { publicId: eventId } },
      select: { publicId: true },
    });
    const attached = await attachCompensationToOrder({
      eventPublicId: eventId,
      itemPublicId: item.publicId,
      targetOrderPublicId: nextOrder.publicId,
    });
    expect(attached.ok).toBe(true);

    // Re-attach is rejected (no double gifts).
    const reattach = await attachCompensationToOrder({
      eventPublicId: eventId,
      itemPublicId: item.publicId,
      targetOrderPublicId: nextOrder.publicId,
    });
    expect(!reattach.ok && reattach.reason).toBe("already_applied");

    const giftLine = await db.orderItem.findFirstOrThrow({
      where: { orderId: nextOrder.id, compensationEventId: { not: null } },
      select: { id: true, unitPriceMinor: true, lineTotalMinor: true },
    });
    expect(giftLine.unitPriceMinor).toBe(b(0));
    expect(giftLine.lineTotalMinor).toBe(b(0));

    // Payment confirmation consumes both lines.
    const stateBefore = await costState();
    await db.$transaction(
      async (tx) => {
        await consumeOrderInventoryReservations(tx, nextOrder.id, new Date());
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
    );

    // Paid line: snapshot on the new order. Gift line: NO COGS on new order.
    const lines = await db.orderItem.findMany({
      where: { orderId: nextOrder.id },
      orderBy: { id: "asc" },
      select: { compensationEventId: true, totalCogsUsdMinor: true },
    });
    const paidLine = lines.find((line) => line.compensationEventId === null);
    const gift = lines.find((line) => line.compensationEventId !== null);
    expect(paidLine?.totalCogsUsdMinor).toBe(b(1_000));
    expect(gift?.totalCogsUsdMinor).toBeNull();

    // Gift cost booked once, on the ORIGINAL order.
    const originalRows = (await adjustments(original.orderId)).filter(
      (row) => row.type === "COMPENSATION_PRODUCT",
    );
    expect(originalRows).toEqual([
      { type: "COMPENSATION_PRODUCT", signedUsdMinor: b(-1_000), isEstimated: false },
    ]);
    const nextRows = await adjustments(nextOrder.id);
    expect(nextRows.filter((row) => row.type === "COMPENSATION_PRODUCT")).toHaveLength(0);

    // Stock left for both units (paid + gift).
    const stateAfter = await costState();
    expect(stateAfter.quantity).toBe(stateBefore.quantity - 2);
    expect(stateAfter.totalCostUsdMinor).toBe(stateBefore.totalCostUsdMinor - b(2_000));

    // The after-sales item carries the gift's cost snapshot.
    const compensationItem = await getDb().afterSalesItem.findFirstOrThrow({
      where: { event: { publicId: eventId } },
      select: { totalCostUsdMinor: true, unitCostUsdMinor: true },
    });
    expect(compensationItem.totalCostUsdMinor).toBe(b(1_000));
    expect(compensationItem.unitCostUsdMinor).toBe(b(1_000));
  });

  it("pre-dispatch refunds restore the valuation, not just physical stock", async () => {
    const { orderId } = await createPaidOrder(2, b(5_000));
    const consumed = await costState();

    const db = getDb();
    await db.$transaction(
      async (tx) => {
        await restoreOrderInventoryAfterPreDispatchRefund(tx, orderId, new Date());
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
    );

    const restored = await costState();
    expect(restored.quantity).toBe(consumed.quantity + 2);
    expect(restored.totalCostUsdMinor).toBe(consumed.totalCostUsdMinor + b(2_000));

    // Provider retries are safe: a second restore changes nothing.
    await db.$transaction(
      async (tx) => {
        await restoreOrderInventoryAfterPreDispatchRefund(tx, orderId, new Date());
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
    );
    expect(await costState()).toEqual(restored);
  });

  it("releases a NEXT_ORDER gift when its carrier order dies before payment", async () => {
    const original = await createPaidOrder(1, b(5_000));
    const eventId = await createEvent(original.orderPublicId, {});
    const variantPublicId = (
      await getDb().productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { publicId: true },
      })
    ).publicId;
    await upsertAfterSalesItem({
      eventPublicId: eventId,
      kind: "COMPENSATION",
      quantity: 1,
      variantPublicId,
      compensationDelivery: "NEXT_ORDER",
    });
    await approveAfterSalesEvent(eventId);
    expect((await completeAfterSalesEvent({ eventPublicId: eventId, locationPublicId })).ok).toBe(true);

    const db = getDb();
    const now = new Date();
    orderSeq += 1;
    const doomedOrder = await db.order.create({
      data: {
        orderNumber: `AS-IT-${suffix.slice(0, 6)}-${orderSeq}`,
        userId: customerId,
        customerEmail: `as-it-${suffix}@example.invalid`,
        status: "PENDING_PAYMENT",
        paymentStatus: "PENDING",
        subtotalMinor: b(5_000),
        shippingMinor: b(1_500),
        totalMinor: b(6_500),
        placedAt: now,
        items: {
          create: {
            productId,
            variantId,
            productName: "AS IT product",
            quantity: 1,
            unitPriceMinor: b(5_000),
            lineTotalMinor: b(5_000),
          },
        },
      },
      select: { id: true, publicId: true, items: { select: { id: true } } },
    });
    await db.$transaction(async (tx) => {
      await reserveOrderItemInventory(tx, {
        variantId,
        orderItemId: doomedOrder.items[0].id,
        quantity: 1,
        now,
        expiresAt: new Date(now.getTime() + 3_600_000),
      });
    });
    const item = await db.afterSalesItem.findFirstOrThrow({
      where: { event: { publicId: eventId } },
      select: { publicId: true },
    });
    expect(
      (
        await attachCompensationToOrder({
          eventPublicId: eventId,
          itemPublicId: item.publicId,
          targetOrderPublicId: doomedOrder.publicId,
        })
      ).ok,
    ).toBe(true);

    // The carrier order dies (payment failed / closed by review).
    await db.$transaction(
      async (tx) => {
        await releaseOrderInventoryReservations(tx, doomedOrder.id, new Date());
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
    );

    // The gift is free again and can join the customer's next real order.
    const released = await db.afterSalesItem.findFirstOrThrow({
      where: { publicId: item.publicId },
      select: { appliedToOrderId: true, totalCostUsdMinor: true },
    });
    expect(released.appliedToOrderId).toBeNull();
    expect(released.totalCostUsdMinor).toBeNull();

    orderSeq += 1;
    const secondOrder = await db.order.create({
      data: {
        orderNumber: `AS-IT-${suffix.slice(0, 6)}-${orderSeq}`,
        userId: customerId,
        customerEmail: `as-it-${suffix}@example.invalid`,
        status: "PENDING_PAYMENT",
        paymentStatus: "PENDING",
        subtotalMinor: b(5_000),
        shippingMinor: b(1_500),
        totalMinor: b(6_500),
        placedAt: now,
        items: {
          create: {
            productId,
            variantId,
            productName: "AS IT product",
            quantity: 1,
            unitPriceMinor: b(5_000),
            lineTotalMinor: b(5_000),
          },
        },
      },
      select: { id: true, publicId: true },
    });
    expect(
      (
        await attachCompensationToOrder({
          eventPublicId: eventId,
          itemPublicId: item.publicId,
          targetOrderPublicId: secondOrder.publicId,
        })
      ).ok,
    ).toBe(true);

    // Release the second attachment's reservation so the suite cleanup does
    // not trip the reserved-quantity integrity trigger.
    await db.$transaction(
      async (tx) => {
        await releaseOrderInventoryReservations(tx, secondOrder.id, new Date());
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
    );
  });
});
