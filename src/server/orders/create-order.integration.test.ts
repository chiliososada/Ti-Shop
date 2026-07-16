import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { createCustomerOrder } from "@/server/orders/create-order";
import {
  checkoutInputSchema,
  normalizeCheckoutInput,
} from "@/server/orders/input";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("customer checkout database totals", () => {
  const suffix = randomUUID();
  let customerUserId = "";
  const productIds: bigint[] = [];
  const variantPublicIds: string[] = [];
  let originalCharges: Prisma.JsonValue | undefined;
  let originalWireEnabled: boolean | undefined;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const customer = await db.user.create({
      data: {
        name: "Checkout totals integration customer",
        email: `checkout-totals-${suffix}@example.invalid`,
      },
      select: { id: true },
    });
    customerUserId = customer.id;

    const chargesSetting = await db.siteSetting.findUniqueOrThrow({
      where: { key: "commerce.checkout_charges" },
      select: { value: true },
    });
    const wireConfig = await db.paymentMethodConfig.findUniqueOrThrow({
      where: { method: "WIRE_TRANSFER" },
      select: { isEnabled: true },
    });
    originalCharges = chargesSetting.value;
    originalWireEnabled = wireConfig.isEnabled;

    for (const [index, amountMinor] of [BigInt(1_001), BigInt(2_002)].entries()) {
      const product = await db.product.create({
        data: {
          slug: `checkout-totals-${index}-${suffix}`,
          title: `Checkout totals integration product ${index + 1}`,
          status: "ACTIVE",
          dataQualityStatus: "VERIFIED",
          publishedAt: new Date(),
          variants: {
            create: {
              title: "Default",
              priceMode: "FIXED",
              status: "ACTIVE",
              trackInventory: false,
              publishedAt: new Date(),
              prices: {
                create: {
                  currency: "USD",
                  kind: "REGULAR",
                  amountMinor,
                  countryCode: "US",
                  isActive: true,
                },
              },
            },
          },
        },
        select: {
          id: true,
          variants: { select: { publicId: true }, take: 1 },
        },
      });
      const variant = product.variants[0];
      if (!variant) throw new Error("Checkout integration variant was not created.");
      productIds.push(product.id);
      variantPublicIds.push(variant.publicId);
    }

    await db.siteSetting.update({
      where: { key: "commerce.checkout_charges" },
      data: {
        value: {
          configured: true,
          shippingFlatMinor: "500",
          taxRateBps: 825,
        },
      },
    });
    await db.paymentMethodConfig.update({
      where: { method: "WIRE_TRANSFER" },
      data: { isEnabled: true },
    });
  });

  afterAll(async () => {
    if (!customerUserId) return;
    const db = getDb();
    const orders = await db.order.findMany({
      where: { userId: customerUserId },
      select: { id: true },
    });
    const orderIds = orders.map(({ id }) => id);
    if (orderIds.length > 0) {
      await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await db.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (productIds.length > 0) {
      await db.productVariant.deleteMany({
        where: { productId: { in: productIds } },
      });
      await db.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (originalCharges !== undefined) {
      await db.siteSetting.update({
        where: { key: "commerce.checkout_charges" },
        data: { value: originalCharges as Prisma.InputJsonValue },
      });
    }
    if (originalWireEnabled !== undefined) {
      await db.paymentMethodConfig.update({
        where: { method: "WIRE_TRANSFER" },
        data: { isEnabled: originalWireEnabled },
      });
    }
    await db.user.delete({ where: { id: customerUserId } });
  });

  it("commits rounded tax snapshots that satisfy the deferred totals constraint", async () => {
    const input = normalizeCheckoutInput(
      checkoutInputSchema.parse({
        idempotencyKey: randomUUID(),
        items: [
          { variantPublicId: variantPublicIds[0], quantity: 1 },
          { variantPublicId: variantPublicIds[1], quantity: 2 },
        ],
        shippingAddress: {
          recipientName: "Integration Customer",
          line1: "100 Main Street",
          city: "Wilmington",
          region: "DE",
          postalCode: "19801",
          countryCode: "US",
        },
        paymentMethod: "WIRE_TRANSFER",
      }),
    );

    const created = await createCustomerOrder(customerUserId, input);
    const replayed = await createCustomerOrder(customerUserId, input);

    expect(created).toMatchObject({
      created: true,
      order: { totalMinor: "5918", currency: "USD" },
      payment: { method: "WIRE_TRANSFER", status: "PENDING" },
    });
    expect(replayed).toMatchObject({
      created: false,
      order: { publicId: created.order.publicId, totalMinor: "5918" },
    });

    const db = getDb();
    const [order, customerOrderCount] = await Promise.all([
      db.order.findUniqueOrThrow({
        where: { publicId: created.order.publicId },
        select: {
          subtotalMinor: true,
          shippingMinor: true,
          taxMinor: true,
          totalMinor: true,
          items: {
            orderBy: { unitPriceMinor: "asc" },
            select: {
              quantity: true,
              unitPriceMinor: true,
              taxMinor: true,
              lineTotalMinor: true,
            },
          },
          payments: { select: { amountMinor: true }, take: 1 },
        },
      }),
      db.order.count({ where: { userId: customerUserId } }),
    ]);

    expect(order).toMatchObject({
      subtotalMinor: BigInt(5_005),
      shippingMinor: BigInt(500),
      taxMinor: BigInt(413),
      totalMinor: BigInt(5_918),
      items: [
        {
          quantity: 1,
          unitPriceMinor: BigInt(1_001),
          taxMinor: BigInt(83),
          lineTotalMinor: BigInt(1_084),
        },
        {
          quantity: 2,
          unitPriceMinor: BigInt(2_002),
          taxMinor: BigInt(330),
          lineTotalMinor: BigInt(4_334),
        },
      ],
      payments: [{ amountMinor: BigInt(5_918) }],
    });
    expect(customerOrderCount).toBe(1);
  });
});
