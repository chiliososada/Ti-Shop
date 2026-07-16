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
      "finance.procurement.manage",
      "finance.export",
    ]),
  })),
  authorizeApiPermission: vi.fn(async () => ({
    ok: true,
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set(["finance.procurement.manage"]),
  })),
}));

import {
  importProcurementLines,
  receiveProcurementOrder,
  setProcurementFxRate,
  upsertProcurementItem,
  upsertProcurementOrder,
  upsertSupplier,
} from "@/server/admin/finance/procurement/mutations";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

const b = BigInt;

integration("procurement receipts drive inventory valuation", () => {
  const suffix = randomUUID();
  let variantId = b(0);
  let variantPublicId = "";
  let productId = b(0);
  let locationPublicId = "";
  let locationId = b(0);
  let supplierPublicId = "";

  async function createPo(): Promise<string> {
    const created = await upsertProcurementOrder({
      supplierPublicId,
      status: "ORDERED",
      domesticShipping: b(0),
      internationalShipping: b(0),
      customs: b(0),
      procurementFee: b(0),
      packaging: b(0),
      otherCost: b(0),
      orderedAt: "",
      paidAt: "",
      notes: "",
    });
    if (!created.ok) throw new Error(created.message);
    return created.publicId;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const actor = await db.user.create({
      data: {
        name: "Finance integration admin",
        email: `finance-admin-${suffix}@example.invalid`,
        adminProfile: { create: { isActive: true } },
      },
      select: { id: true },
    });
    authorization.actorUserId = actor.id;

    const product = await db.product.create({
      data: {
        slug: `fin-it-${suffix.slice(0, 8)}`,
        title: "Finance IT product",
        variants: {
          create: {
            title: "Default",
            sku: `FIN-IT-${suffix.slice(0, 8).toUpperCase()}`,
            trackInventory: true,
          },
        },
      },
      select: { id: true, variants: { select: { id: true, publicId: true } } },
    });
    productId = product.id;
    variantId = product.variants[0].id;
    variantPublicId = product.variants[0].publicId;

    const location = await db.inventoryLocation.create({
      data: {
        code: `FIN-IT-${suffix.slice(0, 8)}`,
        name: "Finance IT warehouse",
      },
      select: { id: true, publicId: true },
    });
    locationId = location.id;
    locationPublicId = location.publicId;

    const supplier = await upsertSupplier({
      name: `Finance IT supplier ${suffix.slice(0, 8)}`,
      contactName: "",
      contactDetails: "",
      notes: "",
      isActive: "true",
    });
    if (!supplier.ok) throw new Error(supplier.message);
    supplierPublicId = supplier.publicId;
  });

  afterAll(async () => {
    const db = getDb();
    await db.inventoryCostEntry.deleteMany({ where: { variantId } });
    await db.inventoryCostState.deleteMany({ where: { variantId } });
    await db.inventoryMovement.deleteMany({
      where: { inventoryLevel: { variantId } },
    });
    await db.inventoryLevel.deleteMany({ where: { variantId } });
    await db.procurementOrderItem.deleteMany({ where: { variantId } });
    await db.procurementOrder.deleteMany({
      where: { supplier: { publicId: supplierPublicId } },
    });
    await db.supplier.deleteMany({ where: { publicId: supplierPublicId } });
    await db.inventoryLocation.delete({ where: { id: locationId } });
    await db.productVariant.delete({ where: { id: variantId } });
    await db.product.delete({ where: { id: productId } });
    await db.auditLog.deleteMany({ where: { actorUserId: authorization.actorUserId } });
    await db.outboxEvent.deleteMany({ where: { aggregateType: "finance" } });
    await db.user.delete({ where: { id: authorization.actorUserId } });
  });

  it("receives a CNY purchase with extra-cost allocation and locks USD costs", async () => {
    const poPublicId = await createPo();
    // 10 units at ¥58.00 => ¥580 goods; ¥145 total extras.
    const updated = await upsertProcurementOrder({
      publicId: poPublicId,
      supplierPublicId,
      status: "PAID",
      domesticShipping: b(4_500), // ¥45
      internationalShipping: b(10_000), // ¥100
      customs: b(0),
      procurementFee: b(0),
      packaging: b(0),
      otherCost: b(0),
      orderedAt: "",
      paidAt: "",
      notes: "",
    });
    expect(updated.ok).toBe(true);
    const line = await upsertProcurementItem({
      procurementPublicId: poPublicId,
      variantPublicId,
      quantity: 10,
      unitPriceCny: b(5_800),
    });
    expect(line.ok).toBe(true);

    const fx = await setProcurementFxRate({
      procurementPublicId: poPublicId,
      fxRate: "7.25",
      fxRateDate: "2026-07-10T00:00:00Z",
      fxRateSource: "MANUAL",
      fxRateNote: "integration",
    });
    expect(fx.ok).toBe(true);

    const received = await receiveProcurementOrder({
      procurementPublicId: poPublicId,
      locationPublicId,
      receivedAt: "",
    });
    expect(received.ok).toBe(true);

    const db = getDb();
    const po = await db.procurementOrder.findFirstOrThrow({
      where: { publicId: poPublicId },
      select: {
        status: true,
        totalMinor: true,
        totalUsdMinor: true,
        items: {
          select: {
            allocatedCostMinor: true,
            totalMinor: true,
            totalUsdMinor: true,
            unitCostUsdMinor: true,
            receivedQuantity: true,
          },
        },
      },
    });
    expect(po.status).toBe("RECEIVED");
    // ¥580 + ¥145 = ¥725 landed; at 7.25 => exactly $100.00.
    expect(po.totalMinor).toBe(b(72_500));
    expect(po.totalUsdMinor).toBe(b(10_000));
    expect(po.items[0].allocatedCostMinor).toBe(b(14_500));
    expect(po.items[0].totalUsdMinor).toBe(b(10_000));
    expect(po.items[0].unitCostUsdMinor).toBe(b(1_000)); // $10.00/unit
    expect(po.items[0].receivedQuantity).toBe(10);

    const state = await db.inventoryCostState.findUniqueOrThrow({
      where: { variantId },
      select: { quantity: true, totalCostUsdMinor: true },
    });
    expect(state).toEqual({ quantity: 10, totalCostUsdMinor: b(10_000) });

    const level = await db.inventoryLevel.findUniqueOrThrow({
      where: { variantId_locationId: { variantId, locationId } },
      select: { onHandQuantity: true },
    });
    expect(level.onHandQuantity).toBe(10);

    const movement = await db.inventoryMovement.findFirst({
      where: {
        inventoryLevel: { variantId },
        type: "RECEIPT",
        referenceId: poPublicId,
      },
      select: { quantityDelta: true, onHandAfter: true },
    });
    expect(movement).toEqual({ quantityDelta: 10, onHandAfter: 10 });

    // Idempotent re-receipt changes nothing.
    const again = await receiveProcurementOrder({
      procurementPublicId: poPublicId,
      locationPublicId,
      receivedAt: "",
    });
    expect(again.ok).toBe(true);
    const stateAfter = await db.inventoryCostState.findUniqueOrThrow({
      where: { variantId },
      select: { quantity: true, totalCostUsdMinor: true },
    });
    expect(stateAfter).toEqual({ quantity: 10, totalCostUsdMinor: b(10_000) });
  });

  it("blends a second purchase at a different price and rate (moving average)", async () => {
    const poPublicId = await createPo();
    const line = await upsertProcurementItem({
      procurementPublicId: poPublicId,
      variantPublicId,
      quantity: 5,
      unitPriceCny: b(11_600), // ¥116.00
    });
    expect(line.ok).toBe(true);
    const fx = await setProcurementFxRate({
      procurementPublicId: poPublicId,
      fxRate: "7.25",
      fxRateDate: "",
      fxRateSource: "MANUAL",
      fxRateNote: "",
    });
    expect(fx.ok).toBe(true);
    const received = await receiveProcurementOrder({
      procurementPublicId: poPublicId,
      locationPublicId,
      receivedAt: "",
    });
    expect(received.ok).toBe(true);

    // Second batch: ¥580 => $80.00 for 5 units. New state:
    // (100 + 80) / 15 = $12.00 average.
    const state = await getDb().inventoryCostState.findUniqueOrThrow({
      where: { variantId },
      select: { quantity: true, totalCostUsdMinor: true },
    });
    expect(state).toEqual({ quantity: 15, totalCostUsdMinor: b(18_000) });
  });

  it("handles concurrent receipts without losing stock or value", async () => {
    const [poA, poB] = await Promise.all([createPo(), createPo()]);
    for (const poPublicId of [poA, poB]) {
      const line = await upsertProcurementItem({
        procurementPublicId: poPublicId,
        variantPublicId,
        quantity: 2,
        unitPriceCny: b(7_250), // ¥72.50 => $10 at 7.25
      });
      expect(line.ok).toBe(true);
      const fx = await setProcurementFxRate({
        procurementPublicId: poPublicId,
        fxRate: "7.25",
        fxRateDate: "",
        fxRateSource: "MANUAL",
        fxRateNote: "",
      });
      expect(fx.ok).toBe(true);
    }

    const results = await Promise.all([
      receiveProcurementOrder({ procurementPublicId: poA, locationPublicId, receivedAt: "" }),
      receiveProcurementOrder({ procurementPublicId: poB, locationPublicId, receivedAt: "" }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);

    const state = await getDb().inventoryCostState.findUniqueOrThrow({
      where: { variantId },
      select: { quantity: true, totalCostUsdMinor: true },
    });
    // 15 + 2 + 2 units; 18000 + 2000 + 2000 cents.
    expect(state).toEqual({ quantity: 19, totalCostUsdMinor: b(22_000) });
  });

  it("re-values remaining stock on an FX correction with an audit ledger entry", async () => {
    const poPublicId = await createPo();
    await upsertProcurementItem({
      procurementPublicId: poPublicId,
      variantPublicId,
      quantity: 1,
      unitPriceCny: b(7_250),
    });
    await setProcurementFxRate({
      procurementPublicId: poPublicId,
      fxRate: "7.25",
      fxRateDate: "",
      fxRateSource: "MANUAL",
      fxRateNote: "",
    });
    await receiveProcurementOrder({
      procurementPublicId: poPublicId,
      locationPublicId,
      receivedAt: "",
    });
    const beforeState = await getDb().inventoryCostState.findUniqueOrThrow({
      where: { variantId },
      select: { quantity: true, totalCostUsdMinor: true },
    });

    // Correct the rate to 7.00: line ¥72.50 => $10.36 (was $10.00) => +36¢.
    const corrected = await setProcurementFxRate({
      procurementPublicId: poPublicId,
      fxRate: "7.00",
      fxRateDate: "",
      fxRateSource: "MANUAL",
      fxRateNote: "correction before settlement lock",
    });
    expect(corrected.ok).toBe(true);

    const afterState = await getDb().inventoryCostState.findUniqueOrThrow({
      where: { variantId },
      select: { quantity: true, totalCostUsdMinor: true },
    });
    expect(afterState.quantity).toBe(beforeState.quantity);
    expect(afterState.totalCostUsdMinor - beforeState.totalCostUsdMinor).toBe(b(36));

    const ledger = await getDb().inventoryCostEntry.findFirst({
      where: {
        variantId,
        entryType: "MANUAL_ADJUSTMENT",
        referenceType: "procurement_fx_correction",
        referenceId: poPublicId,
      },
      select: { costDeltaUsdMinor: true, quantityDelta: true },
    });
    expect(ledger).toEqual({ costDeltaUsdMinor: b(36), quantityDelta: 0 });

    // Same correction twice stays idempotent.
    await setProcurementFxRate({
      procurementPublicId: poPublicId,
      fxRate: "7.00",
      fxRateDate: "",
      fxRateSource: "MANUAL",
      fxRateNote: "repeat",
    });
    const repeatState = await getDb().inventoryCostState.findUniqueOrThrow({
      where: { variantId },
      select: { totalCostUsdMinor: true },
    });
    expect(repeatState.totalCostUsdMinor).toBe(afterState.totalCostUsdMinor);

    // A→B→A: switching back to the original rate re-values by the exact
    // opposite delta. A rate-valued idempotency key used to skip this step
    // and desync the valuation from the PO snapshot.
    const reverted = await setProcurementFxRate({
      procurementPublicId: poPublicId,
      fxRate: "7.25",
      fxRateDate: "",
      fxRateSource: "MANUAL",
      fxRateNote: "back to the original rate",
    });
    expect(reverted.ok).toBe(true);
    const revertedState = await getDb().inventoryCostState.findUniqueOrThrow({
      where: { variantId },
      select: { totalCostUsdMinor: true },
    });
    expect(revertedState.totalCostUsdMinor).toBe(beforeState.totalCostUsdMinor);
  });

  it("rejects edits after receipt and imports CSV lines with row-level errors", async () => {
    const receivedPo = await getDb().procurementOrder.findFirstOrThrow({
      where: { status: "RECEIVED", supplier: { publicId: supplierPublicId } },
      select: { publicId: true },
    });
    const editAttempt = await upsertProcurementOrder({
      publicId: receivedPo.publicId,
      supplierPublicId,
      status: "PAID",
      domesticShipping: b(1),
      internationalShipping: b(0),
      customs: b(0),
      procurementFee: b(0),
      packaging: b(0),
      otherCost: b(0),
      orderedAt: "",
      paidAt: "",
      notes: "",
    });
    expect(!editAttempt.ok && editAttempt.reason).toBe("immutable_status");

    const poPublicId = await createPo();
    const sku = `FIN-IT-${suffix.slice(0, 8).toUpperCase()}`;
    const imported = await importProcurementLines({
      procurementPublicId: poPublicId,
      csvText: `sku,quantity,unitPriceCny\n${sku},3,58.00\nUNKNOWN-SKU,1,10.00\n${sku},bad,1`,
    });
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.imported).toBe(1);
      expect(imported.errors).toHaveLength(2);
    }
    const lines = await getDb().procurementOrderItem.findMany({
      where: { procurementOrder: { publicId: poPublicId } },
      select: { quantity: true, unitPriceMinor: true },
    });
    expect(lines).toEqual([{ quantity: 3, unitPriceMinor: b(5_800) }]);
  });
});
