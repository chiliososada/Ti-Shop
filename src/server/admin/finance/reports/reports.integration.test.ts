import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set(["finance.read"]),
  })),
  authorizeApiPermission: vi.fn(async () => ({
    ok: true,
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set(["finance.read"]),
  })),
}));

import { getFinanceOrderIndex } from "@/server/admin/finance/reports/queries";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

const b = BigInt;

integration("finance order index estimated/finalized filter", () => {
  const suffix = randomUUID();
  const email = `rp-it-${suffix}@example.invalid`;
  let customerId = "";
  let orderSeq = 0;

  async function createOrder(options: {
    cogs: bigint | null;
    shipmentMissingCost?: boolean;
    estimatedAdjustment?: boolean;
  }) {
    // Orders without an active shipment are estimated (not_yet_shipped), so
    // every fixture ships; the missing-cost variant ships without a recorded
    // carrier cost.
    const shipmentCostMinor = options.shipmentMissingCost ? null : BigInt(500);
    orderSeq += 1;
    const confirmedAt = new Date("2032-01-10T00:00:00Z");
    const order = await getDb().order.create({
      data: {
        orderNumber: `RP-IT-${suffix.slice(0, 6)}-${orderSeq}`,
        userId: customerId,
        customerEmail: email,
        status: "CONFIRMED",
        paymentStatus: "PAID",
        subtotalMinor: b(10_000),
        totalMinor: b(10_000),
        placedAt: confirmedAt,
        confirmedAt,
        items: {
          create: {
            productName: "RP IT line",
            quantity: 1,
            unitPriceMinor: b(10_000),
            lineTotalMinor: b(10_000),
            ...(options.cogs === null
              ? {}
              : {
                  unitCostUsdMinor: options.cogs,
                  totalCogsUsdMinor: options.cogs,
                  costMethod: "MOVING_AVERAGE",
                  costSnapshotAt: confirmedAt,
                }),
          },
        },
        shipments: {
          create: {
            shipmentNumber: `RP-IT-${suffix.slice(0, 6)}-${orderSeq}`,
            status: "IN_TRANSIT",
            shippedAt: confirmedAt,
            shippingCostMinor: shipmentCostMinor,
          },
        },
        ...(options.estimatedAdjustment
          ? {
              financialAdjustments: {
                create: {
                  type: "MANUAL_DIRECT_COST",
                  originalAmountMinor: b(100),
                  originalCurrency: "USD",
                  signedUsdMinor: b(-100),
                  effectiveAt: confirmedAt,
                  reason: "estimated direct cost",
                  isEstimated: true,
                },
              },
            }
          : {}),
      },
      select: { publicId: true },
    });
    return order.publicId;
  }

  let missingCogsId = "";
  let finalizedId = "";
  let estimatedAdjustmentId = "";
  let missingShippingId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const actor = await db.user.create({
      data: {
        name: "Reports integration admin",
        email: `rp-admin-${suffix}@example.invalid`,
        adminProfile: { create: { isActive: true } },
      },
      select: { id: true },
    });
    authorization.actorUserId = actor.id;
    const customer = await db.user.create({
      data: { name: "RP customer", email },
      select: { id: true },
    });
    customerId = customer.id;

    missingCogsId = await createOrder({ cogs: null });
    finalizedId = await createOrder({ cogs: b(1_000) });
    estimatedAdjustmentId = await createOrder({ cogs: b(1_000), estimatedAdjustment: true });
    missingShippingId = await createOrder({ cogs: b(1_000), shipmentMissingCost: true });
  });

  afterAll(async () => {
    const db = getDb();
    await db.financialAdjustment.deleteMany({ where: { order: { userId: customerId } } });
    await db.shipment.deleteMany({ where: { order: { userId: customerId } } });
    await db.order.deleteMany({ where: { userId: customerId } });
    await db.user.deleteMany({
      where: { id: { in: [authorization.actorUserId, customerId] } },
    });
  });

  it("paginates the estimated filter in the database and matches the profit computation", async () => {
    const estimated = await getFinanceOrderIndex({ q: email, state: "estimated" });
    const estimatedIds = estimated.rows.map((row) => row.publicId).sort();
    expect(estimatedIds).toEqual(
      [missingCogsId, estimatedAdjustmentId, missingShippingId].sort(),
    );
    // The SQL filter, the pagination total, and the derived flag agree.
    expect(estimated.pagination.total).toBe(3);
    expect(estimated.rows.every((row) => row.isEstimated)).toBe(true);

    const finalized = await getFinanceOrderIndex({ q: email, state: "finalized" });
    expect(finalized.rows.map((row) => row.publicId)).toEqual([finalizedId]);
    expect(finalized.pagination.total).toBe(1);
    expect(finalized.rows.every((row) => !row.isEstimated)).toBe(true);
  });
});
