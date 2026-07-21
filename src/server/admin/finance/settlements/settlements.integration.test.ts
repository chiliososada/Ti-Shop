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
      "finance.adjustments.manage",
      "finance.partner-settlements.manage",
      "finance.partner-settlements.lock",
    ]),
  })),
  authorizeApiPermission: vi.fn(async () => ({
    ok: true,
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set(["finance.partner-settlements.manage"]),
  })),
}));

import {
  createFinancialAdjustment,
  reverseFinancialAdjustment,
} from "@/server/admin/finance/adjustments/mutations";
import {
  confirmSettlement,
  generateSettlementDraft,
  lockSettlement,
  markSettlementPaid,
  upsertPartner,
  voidSettlement,
} from "@/server/admin/finance/settlements/mutations";
import { getDb } from "@/server/db/client";
import { PROFIT_CALC_VERSION } from "@/server/finance/math/profit";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

const b = BigInt;

integration("partner settlements with carryover", () => {
  const suffix = randomUUID();
  let customerId = "";
  let partnerPublicId = "";
  let orderSeq = 0;

  // Distinct months keep periods deterministic and non-overlapping.
  const P1 = { start: "2031-01-01T00:00:00Z", end: "2031-02-01T00:00:00Z" };
  const P2 = { start: "2031-02-01T00:00:00Z", end: "2031-03-01T00:00:00Z" };
  const P3 = { start: "2031-03-01T00:00:00Z", end: "2031-04-01T00:00:00Z" };

  /** Paid order with a single untracked line (no cost snapshot needed). */
  async function createConfirmedOrder(totalMinor: bigint, confirmedAtIso: string) {
    orderSeq += 1;
    const confirmedAt = new Date(confirmedAtIso);
    return getDb().order.create({
      data: {
        orderNumber: `PS-IT-${suffix.slice(0, 6)}-${orderSeq}`,
        userId: customerId,
        customerEmail: `ps-it-${suffix}@example.invalid`,
        status: "CONFIRMED",
        paymentStatus: "PAID",
        subtotalMinor: totalMinor,
        totalMinor,
        placedAt: confirmedAt,
        confirmedAt,
        items: {
          create: {
            productName: "PS IT service line",
            quantity: 1,
            unitPriceMinor: totalMinor,
            lineTotalMinor: totalMinor,
          },
        },
      },
      select: { id: true, publicId: true },
    });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const actor = await db.user.create({
      data: {
        name: "Settlement integration admin",
        email: `ps-admin-${suffix}@example.invalid`,
        adminProfile: { create: { isActive: true } },
      },
      select: { id: true },
    });
    authorization.actorUserId = actor.id;
    const customer = await db.user.create({
      data: { name: "PS customer", email: `ps-customer-${suffix}@example.invalid` },
      select: { id: true },
    });
    customerId = customer.id;

    const partner = await upsertPartner({
      name: `Partner ${suffix.slice(0, 8)}`,
      shareBps: 5_000,
      effectiveFrom: "2031-01-01T00:00:00Z",
      isActive: true,
      notes: "",
    });
    if (!partner.ok) throw new Error(partner.message);
    partnerPublicId = partner.publicId;
  });

  afterAll(async () => {
    const db = getDb();
    await db.financialAdjustment.deleteMany({ where: { order: { userId: customerId } } });
    await db.partnerSettlement.deleteMany({
      where: { partner: { publicId: partnerPublicId } },
    });
    await db.order.deleteMany({ where: { userId: customerId } });
    await db.partner.deleteMany({ where: { publicId: partnerPublicId } });
    await db.auditLog.deleteMany({ where: { actorUserId: authorization.actorUserId } });
    await db.outboxEvent.deleteMany({ where: { aggregateType: "finance" } });
    await db.user.deleteMany({
      where: { id: { in: [authorization.actorUserId, customerId] } },
    });
  });

  it("drafts, confirms, locks, and pays a 50% settlement — and blocks edits after lock", async () => {
    const order = await createConfirmedOrder(b(100_000), "2031-01-10T00:00:00Z"); // $1000

    const draft = await generateSettlementDraft({
      partnerPublicId,
      periodStart: P1.start,
      periodEnd: P1.end,
      notes: "",
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const row = await getDb().partnerSettlement.findFirstOrThrow({
      where: { publicId: draft.publicId },
      select: {
        status: true,
        revenueUsdMinor: true,
        profitUsdMinor: true,
        partnerShareUsdMinor: true,
        ownerShareUsdMinor: true,
        carryoverInUsdMinor: true,
        carryoverOutUsdMinor: true,
        shareBpsSnapshot: true,
        calcVersion: true,
      },
    });
    expect(row.revenueUsdMinor).toBe(b(100_000));
    expect(row.profitUsdMinor).toBe(b(100_000));
    expect(row.partnerShareUsdMinor).toBe(b(50_000));
    expect(row.ownerShareUsdMinor).toBe(b(50_000));
    expect(row.carryoverOutUsdMinor).toBe(b(0));
    expect(row.shareBpsSnapshot).toBe(5_000);
    expect(row.calcVersion).toBe(PROFIT_CALC_VERSION);

    // The order is claimed — a parallel draft cannot double-settle it.
    const claimed = await getDb().order.findUniqueOrThrow({
      where: { id: order.id },
      select: { profitSettledSettlementId: true },
    });
    expect(claimed.profitSettledSettlementId).not.toBeNull();
    const overlapping = await generateSettlementDraft({
      partnerPublicId,
      periodStart: P1.start,
      periodEnd: P1.end,
      notes: "",
    });
    expect(!overlapping.ok && overlapping.reason).toBe("open_settlement");

    expect((await confirmSettlement(draft.publicId)).ok).toBe(true);
    expect((await lockSettlement(draft.publicId)).ok).toBe(true);

    // Locked settlements reject overpayment and record the real payout.
    const overpaid = await markSettlementPaid({
      settlementPublicId: draft.publicId,
      paidUsdMinor: b(50_001),
      paymentMethod: "USDT",
      paymentReference: "tx-1",
      paidAt: "2031-02-02T00:00:00Z",
    });
    expect(!overpaid.ok && overpaid.reason).toBe("overpaid");
    const paid = await markSettlementPaid({
      settlementPublicId: draft.publicId,
      paidUsdMinor: b(50_000),
      paymentMethod: "USDT",
      paymentReference: "tx-1",
      paidAt: "2031-02-02T00:00:00Z",
    });
    expect(paid.ok).toBe(true);

    // Paid settlements cannot be voided (immutable history).
    const voidAttempt = await voidSettlement({
      settlementPublicId: draft.publicId,
      reason: "should fail",
    });
    expect(!voidAttempt.ok && voidAttempt.reason).toBe("paid_immutable");
  });

  it("routes post-settlement refunds into the next period and carries losses forward", async () => {
    // A $600 refund lands on the already-settled period-1 order.
    const settledOrder = await getDb().order.findFirstOrThrow({
      where: { userId: customerId, profitSettledSettlementId: { not: null } },
      select: { publicId: true },
    });
    const refund = await createFinancialAdjustment({
      orderPublicId: settledOrder.publicId,
      type: "REFUND",
      direction: "DECREASE",
      amountMinor: b(60_000),
      originalCurrency: "USD",
      fxRateCnyPerUsd: "",
      effectiveAt: "2031-02-05T00:00:00Z",
      reason: "post-settlement refund",
      isEstimated: false,
    });
    expect(refund.ok).toBe(true);

    // Period 2 also has $200 of fresh profit.
    await createConfirmedOrder(b(20_000), "2031-02-10T00:00:00Z");

    const draft2 = await generateSettlementDraft({
      partnerPublicId,
      periodStart: P2.start,
      periodEnd: P2.end,
      notes: "",
    });
    expect(draft2.ok).toBe(true);
    if (!draft2.ok) return;
    const row2 = await getDb().partnerSettlement.findFirstOrThrow({
      where: { publicId: draft2.publicId },
      select: {
        profitUsdMinor: true,
        partnerShareUsdMinor: true,
        carryoverInUsdMinor: true,
        carryoverOutUsdMinor: true,
      },
    });
    // -600 (late refund) + 200 (new order) = -400: no share, loss carries.
    expect(row2.profitUsdMinor).toBe(b(-40_000));
    expect(row2.carryoverInUsdMinor).toBe(b(0));
    expect(row2.partnerShareUsdMinor).toBe(b(0));
    expect(row2.carryoverOutUsdMinor).toBe(b(-40_000));

    expect((await confirmSettlement(draft2.publicId)).ok).toBe(true);
    expect((await lockSettlement(draft2.publicId)).ok).toBe(true);

    // Period 3: $900 profit nets the -$400 carryover → $500 distributable.
    await createConfirmedOrder(b(90_000), "2031-03-10T00:00:00Z");
    const draft3 = await generateSettlementDraft({
      partnerPublicId,
      periodStart: P3.start,
      periodEnd: P3.end,
      notes: "",
    });
    expect(draft3.ok).toBe(true);
    if (!draft3.ok) return;
    const row3 = await getDb().partnerSettlement.findFirstOrThrow({
      where: { publicId: draft3.publicId },
      select: {
        profitUsdMinor: true,
        carryoverInUsdMinor: true,
        distributableUsdMinor: true,
        partnerShareUsdMinor: true,
        ownerShareUsdMinor: true,
      },
    });
    expect(row3.profitUsdMinor).toBe(b(90_000));
    expect(row3.carryoverInUsdMinor).toBe(b(-40_000));
    expect(row3.distributableUsdMinor).toBe(b(50_000));
    expect(row3.partnerShareUsdMinor).toBe(b(25_000));
    expect(row3.ownerShareUsdMinor).toBe(b(25_000));

    // Voiding the draft releases its claims for regeneration.
    const voided = await voidSettlement({
      settlementPublicId: draft3.publicId,
      reason: "regenerate",
    });
    expect(voided.ok).toBe(true);
    const released = await getDb().order.findFirstOrThrow({
      where: { userId: customerId, confirmedAt: new Date("2031-03-10T00:00:00Z") },
      select: { profitSettledSettlementId: true },
    });
    expect(released.profitSettledSettlementId).toBeNull();

    // Regeneration reproduces identical numbers (deterministic).
    const draft3b = await generateSettlementDraft({
      partnerPublicId,
      periodStart: P3.start,
      periodEnd: P3.end,
      notes: "",
    });
    expect(draft3b.ok).toBe(true);
    if (!draft3b.ok) return;
    const row3b = await getDb().partnerSettlement.findFirstOrThrow({
      where: { publicId: draft3b.publicId },
      select: { partnerShareUsdMinor: true, carryoverInUsdMinor: true },
    });
    expect(row3b.partnerShareUsdMinor).toBe(b(25_000));
    expect(row3b.carryoverInUsdMinor).toBe(b(-40_000));
  });

  it("reverses a wrong adjustment instead of editing it", async () => {
    const order = await createConfirmedOrder(b(10_000), "2031-03-20T00:00:00Z");
    const wrong = await createFinancialAdjustment({
      orderPublicId: order.publicId,
      type: "MANUAL_DIRECT_COST",
      direction: "DECREASE",
      amountMinor: b(1_234),
      originalCurrency: "USD",
      fxRateCnyPerUsd: "",
      effectiveAt: "2031-03-21T00:00:00Z",
      reason: "typo",
      isEstimated: false,
    });
    expect(wrong.ok).toBe(true);
    if (!wrong.ok) return;

    const reversal = await reverseFinancialAdjustment({
      adjustmentPublicId: wrong.publicId,
      reason: "entered against the wrong order",
    });
    expect(reversal.ok).toBe(true);

    const rows = await getDb().financialAdjustment.findMany({
      where: { orderId: order.id },
      orderBy: { id: "asc" },
      select: { signedUsdMinor: true, reversesId: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].signedUsdMinor + rows[1].signedUsdMinor).toBe(b(0));
    expect(rows[1].reversesId).not.toBeNull();

    // A second reversal of the same row is rejected.
    const again = await reverseFinancialAdjustment({
      adjustmentPublicId: wrong.publicId,
      reason: "double",
    });
    expect(!again.ok && again.reason).toBe("already_reversed");

    // CNY adjustments retain the original amount and historical rate.
    const cny = await createFinancialAdjustment({
      orderPublicId: order.publicId,
      type: "MANUAL_DIRECT_COST",
      direction: "DECREASE",
      amountMinor: b(72_500), // ¥725.00
      originalCurrency: "CNY",
      fxRateCnyPerUsd: "7.25",
      effectiveAt: "2031-03-22T00:00:00Z",
      reason: "domestic repacking paid in CNY",
      isEstimated: false,
    });
    expect(cny.ok).toBe(true);
    if (!cny.ok) return;
    const cnyRow = await getDb().financialAdjustment.findFirstOrThrow({
      where: { publicId: cny.publicId },
      select: { originalAmountMinor: true, originalCurrency: true, fxRate: true, signedUsdMinor: true },
    });
    expect(cnyRow.originalAmountMinor).toBe(b(72_500));
    expect(cnyRow.originalCurrency).toBe("CNY");
    expect(cnyRow.fxRate?.toString()).toBe("7.25");
    expect(cnyRow.signedUsdMinor).toBe(b(-10_000)); // exactly -$100 at 7.25
  });
});
