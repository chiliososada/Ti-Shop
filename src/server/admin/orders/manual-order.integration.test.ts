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
      "customers.read",
    ]),
  })),
}));

import { Prisma } from "@/generated/prisma/client";
import { createAdminManualOrder } from "@/server/admin/orders/manual-order-mutations";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("admin WhatsApp manual-order database lifecycle", () => {
  const suffix = randomUUID();
  let actorUserId = "";
  let customerUserId = "";
  let addressId = BigInt(0);
  let productId = BigInt(0);
  let variantId = BigInt(0);
  let variantPublicId = "";
  let locationId = BigInt(0);
  let levelId = BigInt(0);
  let roleId = BigInt(0);
  let customersReadPermissionId = BigInt(0);
  let originalCharges: Prisma.JsonValue | undefined;
  const originalMethods = new Map<
    "WIRE_TRANSFER" | "ZELLE",
    { existed: boolean; isEnabled: boolean; settingKey: string | null }
  >();

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const [actor, customer] = await Promise.all([
      db.user.create({
        data: {
          name: "Manual order integration admin",
          email: `manual-order-admin-${suffix}@example.invalid`,
          emailVerified: true,
        },
        select: { id: true },
      }),
      db.user.create({
        data: {
          name: "Manual order integration customer",
          email: `manual-order-customer-${suffix}@example.invalid`,
          emailVerified: true,
        },
        select: { id: true },
      }),
    ]);
    actorUserId = actor.id;
    customerUserId = customer.id;
    authorization.actorUserId = actor.id;

    const requiredPermissions = await db.permission.findMany({
      where: {
        slug: {
          in: ["orders.manage", "payments.manage", "customers.read"],
        },
      },
      select: { id: true, slug: true },
    });
    if (requiredPermissions.length !== 3) {
      throw new Error("Manual-order test permissions are not seeded.");
    }
    const customersReadPermission = requiredPermissions.find(
      ({ slug }) => slug === "customers.read",
    );
    if (!customersReadPermission) {
      throw new Error("customers.read test permission is not seeded.");
    }
    customersReadPermissionId = customersReadPermission.id;
    const role = await db.role.create({
      data: {
        slug: `manual-order-${suffix}`,
        name: "Manual order integration role",
        isSystem: false,
        permissions: {
          create: requiredPermissions.map(({ id }) => ({ permissionId: id })),
        },
      },
      select: { id: true },
    });
    roleId = role.id;
    await Promise.all([
      db.adminProfile.create({
        data: { userId: actor.id, isActive: true },
      }),
      db.userRole.create({
        data: {
          userId: actor.id,
          roleId: role.id,
          assignedByUserId: actor.id,
        },
      }),
    ]);

    const [, savedAddress] = await Promise.all([
      db.customerProfile.update({
        where: { userId: customer.id },
        data: {
          firstName: "Manual",
          lastName: "Customer",
          countryCode: "US",
          preferredCurrency: "USD",
        },
      }),
      db.address.create({
        data: {
          userId: customer.id,
          label: "Integration receiving",
          recipientName: "Manual Customer",
          line1: "100 Science Way",
          city: "Wilmington",
          region: "DE",
          postalCode: "19801",
          countryCode: "US",
          phone: "+1 302 555 0100",
          isDefaultShipping: true,
        },
        select: { id: true },
      }),
    ]);
    addressId = savedAddress.id;

    const product = await db.product.create({
      data: {
        slug: `manual-order-${suffix}`,
        title: "Manual order integration product",
        status: "ACTIVE",
        dataQualityStatus: "VERIFIED",
        publishedAt: new Date(),
        variants: {
          create: {
            title: "Research pack",
            sku: `MO-${suffix.slice(0, 8).toUpperCase()}`,
            priceMode: "FIXED",
            status: "ACTIVE",
            optionValues: { minimumOrderQuantity: 2 },
            trackInventory: true,
            publishedAt: new Date(),
            prices: {
              create: {
                currency: "USD",
                kind: "REGULAR",
                amountMinor: BigInt(1_001),
                countryCode: "US",
                isActive: true,
              },
            },
          },
        },
      },
      select: {
        id: true,
        variants: { select: { id: true, publicId: true }, take: 1 },
      },
    });
    const variant = product.variants[0];
    if (!variant) throw new Error("Manual-order test variant was not created.");
    productId = product.id;
    variantId = variant.id;
    variantPublicId = variant.publicId;

    const location = await db.inventoryLocation.create({
      data: {
        code: `MO-${suffix.slice(0, 8).toUpperCase()}`,
        name: "Manual-order integration inventory",
        countryCode: "US",
        isActive: true,
      },
      select: { id: true },
    });
    locationId = location.id;
    const level = await db.inventoryLevel.create({
      data: {
        variantId,
        locationId,
        onHandQuantity: 10,
        reservedQuantity: 0,
      },
      select: { id: true },
    });
    levelId = level.id;

    const charges = await db.siteSetting.findUnique({
      where: { key: "commerce.checkout_charges" },
      select: { value: true },
    });
    originalCharges = charges?.value;
    await db.siteSetting.upsert({
      where: { key: "commerce.checkout_charges" },
      create: {
        key: "commerce.checkout_charges",
        value: {
          configured: true,
          shippingFlatMinor: "99",
          taxRateBps: 500,
        },
      },
      update: {
        value: {
          configured: true,
          shippingFlatMinor: "99",
          taxRateBps: 500,
        },
      },
    });

    for (const method of ["WIRE_TRANSFER", "ZELLE"] as const) {
      const existing = await db.paymentMethodConfig.findUnique({
        where: { method },
        select: { isEnabled: true, settingKey: true },
      });
      originalMethods.set(method, {
        existed: existing !== null,
        isEnabled: existing?.isEnabled ?? false,
        settingKey: existing?.settingKey ?? null,
      });
      await db.paymentMethodConfig.upsert({
        where: { method },
        create: {
          method,
          displayName: method === "ZELLE" ? "Zelle" : "Wire transfer",
          isEnabled: true,
        },
        update: { isEnabled: true, settingKey: null },
      });
    }
  });

  afterAll(async () => {
    if (!actorUserId) return;
    const db = getDb();
    const orders = await db.order.findMany({
      where: { userId: customerUserId },
      select: { id: true, publicId: true },
    });
    const orderIds = orders.map((order) => order.id);
    const orderPublicIds = orders.map((order) => order.publicId);
    await db.auditLog.deleteMany({ where: { actorUserId } });
    await db.outboxEvent.deleteMany({
      where: {
        aggregateType: "order",
        aggregateId: { in: orderPublicIds },
      },
    });
    if (orderIds.length) {
      await db.$transaction(async (tx) => {
        await tx.inventoryReservation.deleteMany({
          where: { orderItem: { is: { orderId: { in: orderIds } } } },
        });
        if (levelId) {
          await tx.inventoryLevel.update({
            where: { id: levelId },
            data: { reservedQuantity: 0 },
          });
        }
      });
      await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await db.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (levelId) await db.inventoryLevel.delete({ where: { id: levelId } });
    if (locationId) {
      await db.inventoryLocation.delete({ where: { id: locationId } });
    }
    if (variantId) {
      await db.productVariant.delete({ where: { id: variantId } });
    }
    if (productId) await db.product.delete({ where: { id: productId } });

    for (const method of ["WIRE_TRANSFER", "ZELLE"] as const) {
      const original = originalMethods.get(method);
      if (!original) continue;
      if (original.existed) {
        await db.paymentMethodConfig.update({
          where: { method },
          data: {
            isEnabled: original.isEnabled,
            settingKey: original.settingKey,
          },
        });
      } else {
        await db.paymentMethodConfig.delete({ where: { method } });
      }
    }
    if (originalCharges === undefined) {
      await db.siteSetting.delete({
        where: { key: "commerce.checkout_charges" },
      });
    } else {
      await db.siteSetting.update({
        where: { key: "commerce.checkout_charges" },
        data: { value: originalCharges as Prisma.InputJsonValue },
      });
    }
    await db.user.deleteMany({
      where: { id: { in: [actorUserId, customerUserId] } },
    });
    if (roleId) await db.role.delete({ where: { id: roleId } });
  });

  it("creates one idempotent pending Wire order using server prices and a saved address", async () => {
    const input = {
      idempotencyKey: randomUUID(),
      customerUserId,
      paymentMethod: "WIRE_TRANSFER" as const,
      items: [{ variantPublicId, quantity: 2 }],
      address: { mode: "SAVED" as const, addressId: addressId.toString() },
    };

    const created = await createAdminManualOrder(input);
    const replayed = await createAdminManualOrder(input);

    expect(created).toMatchObject({
      created: true,
      order: {
        status: "PENDING_PAYMENT",
        paymentStatus: "PENDING",
        totalMinor: "2201",
        currency: "USD",
      },
      payment: { method: "WIRE_TRANSFER", status: "PENDING" },
    });
    expect(replayed).toMatchObject({
      created: false,
      order: { publicId: created.order.publicId, totalMinor: "2201" },
      payment: { publicId: created.payment.publicId },
    });

    const db = getDb();
    const [order, level, auditCount, outboxCount, orderCount] =
      await Promise.all([
        db.order.findUniqueOrThrow({
          where: { publicId: created.order.publicId },
          select: {
            subtotalMinor: true,
            shippingMinor: true,
            taxMinor: true,
            totalMinor: true,
            status: true,
            paymentStatus: true,
            addresses: {
              orderBy: { kind: "asc" },
              select: {
                recipientName: true,
                line1: true,
                city: true,
                region: true,
                postalCode: true,
                countryCode: true,
              },
            },
            items: {
              select: {
                quantity: true,
                unitPriceMinor: true,
                taxMinor: true,
                lineTotalMinor: true,
                inventoryReservations: {
                  select: { status: true, quantity: true },
                },
              },
            },
            payments: {
              select: {
                status: true,
                amountMinor: true,
                metadata: true,
                events: {
                  select: {
                    eventType: true,
                    statusAfter: true,
                    amountMinor: true,
                  },
                },
              },
            },
          },
        }),
        db.inventoryLevel.findUniqueOrThrow({
          where: { id: levelId },
          select: { onHandQuantity: true, reservedQuantity: true },
        }),
        db.auditLog.count({
          where: {
            actorUserId,
            action: "orders.manual.create",
            resourceId: created.order.publicId,
          },
        }),
        db.outboxEvent.count({
          where: {
            aggregateType: "order",
            aggregateId: created.order.publicId,
            eventType: "order.manual_created",
          },
        }),
        db.order.count({ where: { userId: customerUserId } }),
      ]);

    expect(order).toMatchObject({
      subtotalMinor: BigInt(2_002),
      shippingMinor: BigInt(99),
      taxMinor: BigInt(100),
      totalMinor: BigInt(2_201),
      status: "PENDING_PAYMENT",
      paymentStatus: "PENDING",
      addresses: [
        {
          recipientName: "Manual Customer",
          line1: "100 Science Way",
          city: "Wilmington",
          region: "DE",
          postalCode: "19801",
          countryCode: "US",
        },
        {
          recipientName: "Manual Customer",
          line1: "100 Science Way",
          city: "Wilmington",
          region: "DE",
          postalCode: "19801",
          countryCode: "US",
        },
      ],
      items: [
        {
          quantity: 2,
          unitPriceMinor: BigInt(1_001),
          taxMinor: BigInt(100),
          lineTotalMinor: BigInt(2_102),
          inventoryReservations: [{ status: "ACTIVE", quantity: 2 }],
        },
      ],
      payments: [
        {
          status: "PENDING",
          amountMinor: BigInt(2_201),
          events: [
            {
              eventType: "admin.manual_order.payment_created",
              statusAfter: "PENDING",
              amountMinor: BigInt(2_201),
            },
          ],
        },
      ],
    });
    expect(order.payments[0]?.metadata).toMatchObject({
      orderCreationSource: "ADMIN_WHATSAPP_MANUAL",
      adminManualOrder: {
        actorUserId,
        arrangementChannel: "WHATSAPP",
        addressMode: "SAVED",
        paymentAlreadyReceived: false,
      },
    });
    expect(level).toEqual({ onHandQuantity: 10, reservedQuantity: 2 });
    expect(auditCount).toBe(1);
    expect(outboxCount).toBe(1);
    expect(orderCount).toBe(1);
  });

  it("accepts a strict one-time address but still creates only a pending Zelle payment", async () => {
    const created = await createAdminManualOrder({
      idempotencyKey: randomUUID(),
      customerUserId,
      paymentMethod: "ZELLE",
      items: [{ variantPublicId, quantity: 2 }],
      address: {
        mode: "CUSTOM",
        value: {
          recipientName: "Alternate Receiving",
          line1: "200 Market Street",
          city: "Philadelphia",
          region: "PA",
          postalCode: "19106",
          countryCode: "US",
        },
      },
    });

    const order = await getDb().order.findUniqueOrThrow({
      where: { publicId: created.order.publicId },
      select: {
        status: true,
        paymentStatus: true,
        addresses: { select: { recipientName: true, region: true } },
        payments: {
          select: {
            method: true,
            status: true,
            confirmedAt: true,
            providerPaymentId: true,
          },
        },
      },
    });
    expect(order).toMatchObject({
      status: "PENDING_PAYMENT",
      paymentStatus: "PENDING",
      addresses: [
        { recipientName: "Alternate Receiving", region: "PA" },
        { recipientName: "Alternate Receiving", region: "PA" },
      ],
      payments: [
        {
          method: "ZELLE",
          status: "PENDING",
          confirmedAt: null,
          providerPaymentId: null,
        },
      ],
    });
  });

  it("rechecks active, verified, non-administrator customer eligibility inside the transaction", async () => {
    const db = getDb();
    const attempt = () =>
      createAdminManualOrder({
        idempotencyKey: randomUUID(),
        customerUserId,
        paymentMethod: "WIRE_TRANSFER",
        items: [{ variantPublicId, quantity: 2 }],
        address: { mode: "SAVED" as const, addressId: addressId.toString() },
      });

    await db.user.update({
      where: { id: customerUserId },
      data: {
        disabledAt: new Date(),
        disabledReason: "Integration eligibility guard",
        disabledByUserId: actorUserId,
      },
    });
    await expect(attempt()).rejects.toMatchObject({
      code: "CUSTOMER_INELIGIBLE",
    });
    await db.user.update({
      where: { id: customerUserId },
      data: {
        disabledAt: null,
        disabledReason: null,
        disabledByUserId: null,
      },
    });

    await db.user.update({
      where: { id: customerUserId },
      data: { emailVerified: false },
    });
    await expect(attempt()).rejects.toMatchObject({
      code: "CUSTOMER_INELIGIBLE",
    });
    await db.user.update({
      where: { id: customerUserId },
      data: { emailVerified: true },
    });

    await db.adminProfile.create({
      data: { userId: customerUserId, isActive: false },
    });
    await expect(attempt()).rejects.toMatchObject({
      code: "CUSTOMER_INELIGIBLE",
    });
    await db.adminProfile.delete({ where: { userId: customerUserId } });

    await db.userRole.create({
      data: { userId: customerUserId, roleId, assignedByUserId: actorUserId },
    });
    await expect(attempt()).rejects.toMatchObject({
      code: "CUSTOMER_INELIGIBLE",
    });
    await db.userRole.delete({
      where: { userId_roleId: { userId: customerUserId, roleId } },
    });

    await expect(db.order.count({ where: { userId: customerUserId } })).resolves.toBe(
      2,
    );
  });

  it("rechecks active administrator state and every required permission inside the transaction", async () => {
    const db = getDb();
    const attempt = () =>
      createAdminManualOrder({
        idempotencyKey: randomUUID(),
        customerUserId,
        paymentMethod: "WIRE_TRANSFER",
        items: [{ variantPublicId, quantity: 2 }],
        address: { mode: "SAVED" as const, addressId: addressId.toString() },
      });

    await db.adminProfile.update({
      where: { userId: actorUserId },
      data: { isActive: false },
    });
    await expect(attempt()).rejects.toMatchObject({
      code: "ADMIN_AUTHORIZATION_CHANGED",
    });
    await db.adminProfile.update({
      where: { userId: actorUserId },
      data: { isActive: true },
    });

    await db.rolePermission.delete({
      where: {
        roleId_permissionId: {
          roleId,
          permissionId: customersReadPermissionId,
        },
      },
    });
    await expect(attempt()).rejects.toMatchObject({
      code: "ADMIN_AUTHORIZATION_CHANGED",
    });
    await db.rolePermission.create({
      data: { roleId, permissionId: customersReadPermissionId },
    });

    await expect(db.order.count({ where: { userId: customerUserId } })).resolves.toBe(
      2,
    );
  });
});
