import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import {
  allocateBatchFees,
  DEFAULT_CRYPTO_CONVERSION_FEE_BPS,
  estimateConversionFeeUsdMinor,
} from "@/server/finance/math/fees";
import { sumSignedMinor } from "@/server/finance/math/rounding";
import { withSerializableRetry } from "@/server/orders/retry";
import { positiveDecimalOrNull } from "@/server/payments/nowpayments/decimal";

const RETURN_TO = "/admin/finance/conversions";

type MutationResult =
  | { ok: true; publicId: string }
  | { ok: false; reason: string; message: string };

function failure(reason: string, message: string): MutationResult {
  return { ok: false, reason, message };
}

function transactionOptions() {
  return {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 20_000,
  } as const;
}

function createBatchNumber(now: Date) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const entropy = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return `CV-${date}-${entropy}`;
}

/**
 * Reads the configurable USD→crypto conversion fee (basis points) from
 * finance settings; the 0.5% default lives in exactly one place.
 */
export async function readConversionFeeBps(
  tx: Prisma.TransactionClient,
): Promise<number> {
  const setting = await tx.siteSetting.findUnique({
    where: { key: "finance.crypto_conversion_fee_bps" },
    select: { value: true },
  });
  const raw = setting?.value;
  const bps =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? Number((raw as Record<string, unknown>).bps)
      : Number.NaN;
  return Number.isSafeInteger(bps) && bps >= 0 && bps <= 10_000
    ? bps
    : DEFAULT_CRYPTO_CONVERSION_FEE_BPS;
}

async function recomputeBatchTotals(
  tx: Prisma.TransactionClient,
  batchId: bigint,
) {
  const batch = await tx.cryptoConversionBatch.findUniqueOrThrow({
    where: { id: batchId },
    select: { feeRateBps: true, entries: { select: { usdAmountMinor: true } } },
  });
  const totalUsdMinor = sumSignedMinor(batch.entries.map((entry) => entry.usdAmountMinor));
  await tx.cryptoConversionBatch.update({
    where: { id: batchId },
    data: {
      totalUsdMinor,
      estimatedFeeUsdMinor: estimateConversionFeeUsdMinor(totalUsdMinor, batch.feeRateBps),
    },
    select: { id: true },
  });
}

export async function createConversionBatch(input: {
  kind: "USD_TO_CRYPTO" | "DIRECT_CRYPTO";
  targetAsset: string;
  notes: string;
}): Promise<MutationResult> {
  const authorization = await requirePermission(
    "finance.crypto-settlements.manage",
    RETURN_TO,
  );
  const actorUserId = authorization.session.user.id;
  const targetAsset = input.targetAsset.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,20}$/u.test(targetAsset)) {
    return failure("invalid_asset", "Target asset must be a short ticker like USDT or BTC.");
  }

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      // Direct crypto receipts never pay the USD→crypto conversion fee.
      const feeRateBps =
        input.kind === "DIRECT_CRYPTO" ? 0 : await readConversionFeeBps(tx);
      const created = await tx.cryptoConversionBatch.create({
        data: {
          batchNumber: createBatchNumber(new Date()),
          kind: input.kind,
          targetAsset,
          feeRateBps,
          notes: input.notes || null,
          createdByUserId: actorUserId,
        },
        select: { publicId: true, batchNumber: true, kind: true, feeRateBps: true },
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.conversion.create",
        resourceType: "crypto_conversion_batch",
        resourceId: created.publicId,
        before: { exists: false },
        after: created,
      });
      return { ok: true as const, publicId: created.publicId };
    }, transactionOptions()),
  );
}

export async function addPaymentToBatch(input: {
  batchPublicId: string;
  paymentPublicId: string;
}): Promise<MutationResult> {
  const authorization = await requirePermission(
    "finance.crypto-settlements.manage",
    RETURN_TO,
  );
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const batch = await tx.cryptoConversionBatch.findFirst({
        where: { publicId: input.batchPublicId },
        select: { id: true, publicId: true, status: true, kind: true },
      });
      if (!batch) return failure("not_found", "Conversion batch not found.");
      if (batch.status !== "DRAFT") {
        return failure("immutable_status", "Only draft batches accept payments.");
      }
      const payment = await tx.payment.findFirst({
        where: { publicId: input.paymentPublicId },
        select: {
          id: true,
          publicId: true,
          method: true,
          status: true,
          amountMinor: true,
          orderId: true,
        },
      });
      if (!payment) return failure("payment_not_found", "Payment not found.");
      if (payment.status !== "CONFIRMED") {
        return failure("payment_not_confirmed", "Only confirmed payments can be converted.");
      }
      if (batch.kind === "DIRECT_CRYPTO" && payment.method !== "NOWPAYMENTS") {
        return failure(
          "method_mismatch",
          "Direct-crypto batches accept only NOWPayments receipts.",
        );
      }
      if (batch.kind === "USD_TO_CRYPTO" && payment.method === "NOWPAYMENTS") {
        return failure(
          "method_mismatch",
          "This payment was already received as crypto; use a direct-crypto batch (no 0.5% fee).",
        );
      }

      const duplicate = await tx.cryptoConversionEntry.findFirst({
        where: { activePaymentKey: payment.id },
        select: { batch: { select: { batchNumber: true } } },
      });
      if (duplicate) {
        return failure(
          "already_converted",
          `This payment is already part of batch ${duplicate.batch.batchNumber}.`,
        );
      }

      await tx.cryptoConversionEntry.create({
        data: {
          batchId: batch.id,
          paymentId: payment.id,
          orderId: payment.orderId,
          usdAmountMinor: payment.amountMinor,
          activePaymentKey: payment.id,
        },
        select: { id: true },
      });
      await recomputeBatchTotals(tx, batch.id);
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.conversion.add_payment",
        resourceType: "crypto_conversion_batch",
        resourceId: batch.publicId,
        before: { paymentPublicId: payment.publicId, included: false },
        after: {
          paymentPublicId: payment.publicId,
          usdAmountMinor: payment.amountMinor.toString(),
        },
      });
      return { ok: true as const, publicId: batch.publicId };
    }, transactionOptions()),
  );
}

export async function removePaymentFromBatch(input: {
  batchPublicId: string;
  paymentPublicId: string;
}): Promise<MutationResult> {
  const authorization = await requirePermission(
    "finance.crypto-settlements.manage",
    RETURN_TO,
  );
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const batch = await tx.cryptoConversionBatch.findFirst({
        where: { publicId: input.batchPublicId },
        select: { id: true, publicId: true, status: true },
      });
      if (!batch) return failure("not_found", "Conversion batch not found.");
      if (batch.status !== "DRAFT") {
        return failure("immutable_status", "Only draft batches can change entries.");
      }
      const entry = await tx.cryptoConversionEntry.findFirst({
        where: { batchId: batch.id, payment: { publicId: input.paymentPublicId } },
        select: { id: true },
      });
      if (!entry) return failure("not_found", "The payment is not in this batch.");
      await tx.cryptoConversionEntry.delete({ where: { id: entry.id }, select: { id: true } });
      await recomputeBatchTotals(tx, batch.id);
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.conversion.remove_payment",
        resourceType: "crypto_conversion_batch",
        resourceId: batch.publicId,
        before: { paymentPublicId: input.paymentPublicId, included: true },
        after: { paymentPublicId: input.paymentPublicId, included: false },
      });
      return { ok: true as const, publicId: batch.publicId };
    }, transactionOptions()),
  );
}

/**
 * Completes a draft batch: records the real conversion results, allocates the
 * fee (actual when provided, otherwise the estimate — profit stays marked
 * Estimated until the actual lands) across entries in exact proportion to
 * their USD amounts, and locks the batch.
 */
export async function completeConversionBatch(input: {
  batchPublicId: string;
  actualFeeUsdMinor: bigint | null;
  chainFeeUsdMinor: bigint | null;
  rate: string;
  rateSource: string;
  targetAmount: string;
  receivedAmount: string;
  transactionId: string;
  convertedAt: string;
}): Promise<MutationResult> {
  const authorization = await requirePermission(
    "finance.crypto-settlements.manage",
    RETURN_TO,
  );
  const actorUserId = authorization.session.user.id;
  if (
    (input.actualFeeUsdMinor !== null && input.actualFeeUsdMinor < BigInt(0)) ||
    (input.chainFeeUsdMinor !== null && input.chainFeeUsdMinor < BigInt(0))
  ) {
    return failure("negative_fee", "Fees cannot be negative.");
  }
  let convertedAt: Date | null = null;
  if (input.convertedAt) {
    convertedAt = new Date(input.convertedAt);
    if (Number.isNaN(convertedAt.getTime())) {
      return failure("invalid_date", "Converted-at must be an ISO date-time.");
    }
  }

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const batch = await tx.cryptoConversionBatch.findFirst({
        where: { publicId: input.batchPublicId },
        select: {
          id: true,
          publicId: true,
          batchNumber: true,
          status: true,
          kind: true,
          feeRateBps: true,
          totalUsdMinor: true,
          estimatedFeeUsdMinor: true,
          entries: { orderBy: { id: "asc" }, select: { id: true, usdAmountMinor: true } },
        },
      });
      if (!batch) return failure("not_found", "Conversion batch not found.");
      if (batch.status === "COMPLETED") return { ok: true as const, publicId: batch.publicId };
      if (batch.status !== "DRAFT") {
        return failure("immutable_status", "Voided batches cannot be completed.");
      }
      if (batch.entries.length === 0) {
        return failure("empty", "Add at least one payment before completing.");
      }

      const feeToAllocate =
        input.actualFeeUsdMinor ?? batch.estimatedFeeUsdMinor;
      const chainFee = input.chainFeeUsdMinor ?? BigInt(0);
      const allocations = allocateBatchFees(
        batch.entries.map((entry) => entry.usdAmountMinor),
        feeToAllocate,
        chainFee,
      );
      for (const [index, entry] of batch.entries.entries()) {
        await tx.cryptoConversionEntry.update({
          where: { id: entry.id },
          data: {
            allocatedFeeUsdMinor: allocations[index].feeUsdMinor,
            allocatedChainFeeUsdMinor: allocations[index].chainFeeUsdMinor,
          },
          select: { id: true },
        });
      }

      const after = await tx.cryptoConversionBatch.update({
        where: { id: batch.id },
        data: {
          status: "COMPLETED",
          actualFeeUsdMinor: input.actualFeeUsdMinor,
          chainFeeUsdMinor: input.chainFeeUsdMinor,
          rate: positiveDecimalOrNull(input.rate),
          rateAt: convertedAt,
          rateSource: input.rateSource.trim() || null,
          targetAmount: positiveDecimalOrNull(input.targetAmount),
          receivedAmount: positiveDecimalOrNull(input.receivedAmount),
          transactionId: input.transactionId.trim() || null,
          convertedAt,
          completedByUserId: actorUserId,
          completedAt: new Date(),
        },
        select: {
          publicId: true,
          status: true,
          actualFeeUsdMinor: true,
          chainFeeUsdMinor: true,
          transactionId: true,
        },
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.conversion.complete",
        resourceType: "crypto_conversion_batch",
        resourceId: batch.publicId,
        before: {
          status: "DRAFT",
          estimatedFeeUsdMinor: batch.estimatedFeeUsdMinor.toString(),
        },
        after: {
          status: after.status,
          actualFeeUsdMinor: after.actualFeeUsdMinor?.toString() ?? null,
          chainFeeUsdMinor: after.chainFeeUsdMinor?.toString() ?? null,
          feeUsedForAllocation: feeToAllocate.toString(),
          feeIsEstimated: input.actualFeeUsdMinor === null,
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "finance",
          aggregateId: batch.publicId,
          eventType: "finance.conversion.completed",
          payload: {
            batchNumber: batch.batchNumber,
            totalUsdMinor: batch.totalUsdMinor.toString(),
            feeUsdMinor: feeToAllocate.toString(),
          },
        },
        select: { id: true },
      });
      return { ok: true as const, publicId: batch.publicId };
    }, transactionOptions()),
  );
}

export async function voidConversionBatch(publicId: string): Promise<MutationResult> {
  const authorization = await requirePermission(
    "finance.crypto-settlements.manage",
    RETURN_TO,
  );
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const batch = await tx.cryptoConversionBatch.findFirst({
        where: { publicId },
        select: { id: true, publicId: true, status: true },
      });
      if (!batch) return failure("not_found", "Conversion batch not found.");
      if (batch.status === "VOIDED") return { ok: true as const, publicId };
      await tx.cryptoConversionBatch.update({
        where: { id: batch.id },
        data: { status: "VOIDED", voidedAt: new Date() },
        select: { id: true },
      });
      // Freeing the unique key lets the payments join a replacement batch.
      await tx.cryptoConversionEntry.updateMany({
        where: { batchId: batch.id },
        data: { activePaymentKey: null },
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.conversion.void",
        resourceType: "crypto_conversion_batch",
        resourceId: publicId,
        before: { status: batch.status },
        after: { status: "VOIDED" },
      });
      return { ok: true as const, publicId };
    }, transactionOptions()),
  );
}
