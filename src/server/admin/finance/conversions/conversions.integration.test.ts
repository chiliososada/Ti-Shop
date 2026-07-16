import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set(["finance.read", "finance.crypto-settlements.manage"]),
  })),
  authorizeApiPermission: vi.fn(async () => ({
    ok: true,
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set(["finance.crypto-settlements.manage"]),
  })),
}));

import {
  addPaymentToBatch,
  completeConversionBatch,
  createConversionBatch,
  removePaymentFromBatch,
  voidConversionBatch,
} from "@/server/admin/finance/conversions/mutations";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

const b = BigInt;

integration("crypto conversion batches", () => {
  const suffix = randomUUID();
  let customerId = "";
  let orderSeq = 0;
  const paymentIds: string[] = [];

  async function createConfirmedPayment(
    method: "WIRE_TRANSFER" | "ZELLE" | "NOWPAYMENTS",
    amountMinor: bigint,
  ) {
    orderSeq += 1;
    const db = getDb();
    const now = new Date();
    const order = await db.order.create({
      data: {
        orderNumber: `CV-IT-${suffix.slice(0, 6)}-${orderSeq}`,
        userId: customerId,
        customerEmail: `cv-it-${suffix}@example.invalid`,
        status: "CONFIRMED",
        paymentStatus: "PAID",
        placedAt: now,
        confirmedAt: now,
      },
      select: { id: true },
    });
    const payment = await db.payment.create({
      data: {
        orderId: order.id,
        method,
        status: "CONFIRMED",
        confirmedAt: now,
        amountMinor,
      },
      select: { publicId: true },
    });
    paymentIds.push(payment.publicId);
    return payment.publicId;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const actor = await db.user.create({
      data: {
        name: "Conversion integration admin",
        email: `cv-admin-${suffix}@example.invalid`,
        adminProfile: { create: { isActive: true } },
      },
      select: { id: true },
    });
    authorization.actorUserId = actor.id;
    const customer = await db.user.create({
      data: { name: "CV customer", email: `cv-customer-${suffix}@example.invalid` },
      select: { id: true },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.cryptoConversionEntry.deleteMany({
      where: { payment: { publicId: { in: paymentIds } } },
    });
    await db.cryptoConversionBatch.deleteMany({
      where: { createdByUserId: authorization.actorUserId },
    });
    await db.payment.deleteMany({ where: { publicId: { in: paymentIds } } });
    await db.order.deleteMany({ where: { userId: customerId } });
    await db.auditLog.deleteMany({ where: { actorUserId: authorization.actorUserId } });
    await db.outboxEvent.deleteMany({ where: { aggregateType: "finance" } });
    await db.user.deleteMany({ where: { id: { in: [authorization.actorUserId, customerId] } } });
  });

  it("charges the configured 0.5% estimate on USD-to-crypto batches and allocates exactly", async () => {
    const batch = await createConversionBatch({
      kind: "USD_TO_CRYPTO",
      targetAsset: "usdt",
      notes: "",
    });
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;

    const wire = await createConfirmedPayment("WIRE_TRANSFER", b(10_000)); // $100
    const zelle = await createConfirmedPayment("ZELLE", b(5_000)); // $50
    expect((await addPaymentToBatch({ batchPublicId: batch.publicId, paymentPublicId: wire })).ok).toBe(true);
    expect((await addPaymentToBatch({ batchPublicId: batch.publicId, paymentPublicId: zelle })).ok).toBe(true);

    const draft = await getDb().cryptoConversionBatch.findFirstOrThrow({
      where: { publicId: batch.publicId },
      select: { feeRateBps: true, totalUsdMinor: true, estimatedFeeUsdMinor: true },
    });
    expect(draft.feeRateBps).toBe(50);
    expect(draft.totalUsdMinor).toBe(b(15_000));
    expect(draft.estimatedFeeUsdMinor).toBe(b(75)); // 0.5% of $150

    // Complete WITHOUT an actual fee: the estimate is allocated and the batch
    // stays flagged Estimated for profit purposes.
    const completed = await completeConversionBatch({
      batchPublicId: batch.publicId,
      actualFeeUsdMinor: null,
      chainFeeUsdMinor: null,
      rate: "1.0",
      rateSource: "manual",
      targetAmount: "149.25",
      receivedAmount: "149.25",
      transactionId: "tx-estimated",
      convertedAt: "2026-07-15T00:00:00Z",
    });
    expect(completed.ok).toBe(true);

    const entries = await getDb().cryptoConversionEntry.findMany({
      where: { batch: { publicId: batch.publicId } },
      orderBy: { id: "asc" },
      select: { usdAmountMinor: true, allocatedFeeUsdMinor: true },
    });
    expect(entries.map((entry) => entry.allocatedFeeUsdMinor)).toEqual([b(50), b(25)]);

    // Completing again is a no-op.
    expect(
      (
        await completeConversionBatch({
          batchPublicId: batch.publicId,
          actualFeeUsdMinor: b(999),
          chainFeeUsdMinor: null,
          rate: "",
          rateSource: "",
          targetAmount: "",
          receivedAmount: "",
          transactionId: "",
          convertedAt: "",
        })
      ).ok,
    ).toBe(true);
    const after = await getDb().cryptoConversionBatch.findFirstOrThrow({
      where: { publicId: batch.publicId },
      select: { actualFeeUsdMinor: true },
    });
    expect(after.actualFeeUsdMinor).toBeNull();
  });

  it("direct crypto batches have a zero conversion fee and reject USD payments", async () => {
    const batch = await createConversionBatch({
      kind: "DIRECT_CRYPTO",
      targetAsset: "BTC",
      notes: "",
    });
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;

    const crypto = await createConfirmedPayment("NOWPAYMENTS", b(20_000)); // $200 direct
    const wire = await createConfirmedPayment("WIRE_TRANSFER", b(3_000));

    expect((await addPaymentToBatch({ batchPublicId: batch.publicId, paymentPublicId: crypto })).ok).toBe(true);
    const rejected = await addPaymentToBatch({
      batchPublicId: batch.publicId,
      paymentPublicId: wire,
    });
    expect(!rejected.ok && rejected.reason).toBe("method_mismatch");

    const draft = await getDb().cryptoConversionBatch.findFirstOrThrow({
      where: { publicId: batch.publicId },
      select: { feeRateBps: true, estimatedFeeUsdMinor: true },
    });
    // No 0.5% for direct crypto receipts — enforced here and by a DB check.
    expect(draft.feeRateBps).toBe(0);
    expect(draft.estimatedFeeUsdMinor).toBe(b(0));

    // Actual platform + chain fees are still recordable.
    const completed = await completeConversionBatch({
      batchPublicId: batch.publicId,
      actualFeeUsdMinor: b(120),
      chainFeeUsdMinor: b(35),
      rate: "0.0000165",
      rateSource: "NOWPayments",
      targetAmount: "0.0033",
      receivedAmount: "0.0032845",
      transactionId: "tx-direct",
      convertedAt: "2026-07-15T00:00:00Z",
    });
    expect(completed.ok).toBe(true);
    const entry = await getDb().cryptoConversionEntry.findFirstOrThrow({
      where: { batch: { publicId: batch.publicId } },
      select: { allocatedFeeUsdMinor: true, allocatedChainFeeUsdMinor: true },
    });
    expect(entry.allocatedFeeUsdMinor).toBe(b(120));
    expect(entry.allocatedChainFeeUsdMinor).toBe(b(35));
  });

  it("prevents one payment from joining two live batches, until a void frees it", async () => {
    const payment = await createConfirmedPayment("WIRE_TRANSFER", b(4_200));
    const first = await createConversionBatch({
      kind: "USD_TO_CRYPTO",
      targetAsset: "USDT",
      notes: "",
    });
    const second = await createConversionBatch({
      kind: "USD_TO_CRYPTO",
      targetAsset: "USDT",
      notes: "",
    });
    if (!first.ok || !second.ok) throw new Error("batch setup failed");

    expect((await addPaymentToBatch({ batchPublicId: first.publicId, paymentPublicId: payment })).ok).toBe(true);
    const duplicate = await addPaymentToBatch({
      batchPublicId: second.publicId,
      paymentPublicId: payment,
    });
    expect(!duplicate.ok && duplicate.reason).toBe("already_converted");

    // Removing from the draft frees it; re-adding to the other batch works.
    expect(
      (await removePaymentFromBatch({ batchPublicId: first.publicId, paymentPublicId: payment })).ok,
    ).toBe(true);
    expect((await addPaymentToBatch({ batchPublicId: second.publicId, paymentPublicId: payment })).ok).toBe(true);

    // Voiding the second batch frees the payment again.
    expect((await voidConversionBatch(second.publicId)).ok).toBe(true);
    expect((await addPaymentToBatch({ batchPublicId: first.publicId, paymentPublicId: payment })).ok).toBe(true);
  });
});
