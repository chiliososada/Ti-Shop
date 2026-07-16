import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { cnyMinorToUsdMinor, validateFxRate } from "@/server/finance/math/fx";
import { withSerializableRetry } from "@/server/orders/retry";

const RETURN_TO = "/admin/finance";

type MutationResult =
  | { ok: true; publicId: string }
  | { ok: false; reason: string; message: string };

function failure(reason: string, message: string): MutationResult {
  return { ok: false, reason, message };
}

const ADJUSTMENT_TYPES = [
  "REFUND",
  "SHIPPING_REFUND",
  "RETURN_SHIPPING",
  "DAMAGED_RETURN",
  "COMPENSATION_PRODUCT",
  "COMPENSATION_SHIPPING",
  "PAYMENT_FEE",
  "CRYPTO_CONVERSION_FEE",
  "EXCHANGE_GAIN",
  "EXCHANGE_LOSS",
  "MANUAL_DIRECT_COST",
  "COST_CORRECTION",
  "ROUNDING_ADJUSTMENT",
  "PARTNER_SETTLEMENT_CORRECTION",
] as const;

type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

// Types with a fixed economic direction; the rest accept either sign.
const ALWAYS_DECREASES: ReadonlySet<AdjustmentType> = new Set([
  "REFUND",
  "SHIPPING_REFUND",
  "RETURN_SHIPPING",
  "DAMAGED_RETURN",
  "COMPENSATION_PRODUCT",
  "COMPENSATION_SHIPPING",
  "PAYMENT_FEE",
  "CRYPTO_CONVERSION_FEE",
  "EXCHANGE_LOSS",
  "MANUAL_DIRECT_COST",
]);
const ALWAYS_INCREASES: ReadonlySet<AdjustmentType> = new Set(["EXCHANGE_GAIN"]);

export function isAdjustmentType(value: string): value is AdjustmentType {
  return (ADJUSTMENT_TYPES as readonly string[]).includes(value);
}

/**
 * Creates one append-only financial adjustment. Original-currency amounts
 * and their historical FX rate are retained; CNY converts through the same
 * fixed-point path as procurement.
 */
export async function createFinancialAdjustment(input: {
  orderPublicId: string;
  type: AdjustmentType;
  direction: "INCREASE" | "DECREASE";
  amountMinor: bigint;
  originalCurrency: "USD" | "CNY";
  fxRateCnyPerUsd: string;
  effectiveAt: string;
  reason: string;
  isEstimated: boolean;
}): Promise<MutationResult> {
  const authorization = await requirePermission(
    "finance.adjustments.manage",
    RETURN_TO,
  );
  const actorUserId = authorization.session.user.id;

  if (input.amountMinor <= BigInt(0)) {
    return failure("invalid_amount", "The amount must be greater than zero.");
  }
  if (ALWAYS_DECREASES.has(input.type) && input.direction !== "DECREASE") {
    return failure("invalid_direction", `${input.type} always decreases profit.`);
  }
  if (ALWAYS_INCREASES.has(input.type) && input.direction !== "INCREASE") {
    return failure("invalid_direction", `${input.type} always increases profit.`);
  }
  const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : new Date();
  if (Number.isNaN(effectiveAt.getTime())) {
    return failure("invalid_date", "Effective date must be ISO formatted.");
  }

  let usdMinor = input.amountMinor;
  let fxRate: string | null = null;
  if (input.originalCurrency === "CNY") {
    try {
      fxRate = validateFxRate(input.fxRateCnyPerUsd);
      usdMinor = cnyMinorToUsdMinor(input.amountMinor, fxRate);
    } catch (error) {
      return failure(
        "invalid_rate",
        error instanceof Error ? error.message : "Invalid exchange rate.",
      );
    }
  }
  const signedUsdMinor = input.direction === "INCREASE" ? usdMinor : -usdMinor;

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const order = await tx.order.findFirst({
          where: { publicId: input.orderPublicId },
          select: { id: true, publicId: true, status: true },
        });
        if (!order) return failure("order_not_found", "Order not found.");
        if (order.status === "DRAFT") {
          return failure("order_draft", "Adjustments require a placed order.");
        }

        const created = await tx.financialAdjustment.create({
          data: {
            type: input.type,
            orderId: order.id,
            originalAmountMinor: input.amountMinor,
            originalCurrency: input.originalCurrency,
            fxRate,
            fxRateDate: fxRate ? effectiveAt : null,
            fxRateSource: fxRate ? "MANUAL" : null,
            signedUsdMinor,
            effectiveAt,
            reason: input.reason,
            isEstimated: input.isEstimated,
            createdByUserId: actorUserId,
            approvedByUserId: actorUserId,
          },
          select: { publicId: true, type: true, signedUsdMinor: true },
        });
        await writeAdminAuditLog(tx, {
          actorUserId,
          action: "finance.adjustment.create",
          resourceType: "financial_adjustment",
          resourceId: created.publicId,
          before: { exists: false },
          after: {
            type: created.type,
            signedUsdMinor: created.signedUsdMinor.toString(),
            orderPublicId: order.publicId,
          },
        });
        return { ok: true as const, publicId: created.publicId };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      },
    ),
  );
}

/**
 * Corrects a wrong adjustment by appending its exact opposite. Nothing is
 * ever edited or deleted; if the original was already settled, the reversal
 * flows into the next settlement period automatically.
 */
export async function reverseFinancialAdjustment(input: {
  adjustmentPublicId: string;
  reason: string;
}): Promise<MutationResult> {
  const authorization = await requirePermission(
    "finance.adjustments.manage",
    RETURN_TO,
  );
  const actorUserId = authorization.session.user.id;
  if (!input.reason.trim()) {
    return failure("reason_required", "A reversal reason is required.");
  }

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const original = await tx.financialAdjustment.findFirst({
          where: { publicId: input.adjustmentPublicId },
          select: {
            id: true,
            publicId: true,
            type: true,
            orderId: true,
            orderItemId: true,
            paymentId: true,
            shipmentId: true,
            afterSalesEventId: true,
            conversionBatchId: true,
            originalAmountMinor: true,
            originalCurrency: true,
            fxRate: true,
            fxRateDate: true,
            fxRateSource: true,
            signedUsdMinor: true,
            reversedBy: { select: { publicId: true } },
          },
        });
        if (!original) return failure("not_found", "Adjustment not found.");
        if (original.reversedBy) {
          return failure(
            "already_reversed",
            `This adjustment was already reversed by ${original.reversedBy.publicId}.`,
          );
        }

        const reversal = await tx.financialAdjustment.create({
          data: {
            type: original.type,
            orderId: original.orderId,
            orderItemId: original.orderItemId,
            paymentId: original.paymentId,
            shipmentId: original.shipmentId,
            afterSalesEventId: original.afterSalesEventId,
            conversionBatchId: original.conversionBatchId,
            originalAmountMinor: original.originalAmountMinor,
            originalCurrency: original.originalCurrency,
            fxRate: original.fxRate,
            fxRateDate: original.fxRateDate,
            fxRateSource: original.fxRateSource,
            signedUsdMinor: -original.signedUsdMinor,
            effectiveAt: new Date(),
            reason: `Reversal of ${original.publicId}: ${input.reason}`,
            isEstimated: false,
            reversesId: original.id,
            createdByUserId: actorUserId,
            approvedByUserId: actorUserId,
          },
          select: { publicId: true },
        });
        await writeAdminAuditLog(tx, {
          actorUserId,
          action: "finance.adjustment.reverse",
          resourceType: "financial_adjustment",
          resourceId: original.publicId,
          before: { signedUsdMinor: original.signedUsdMinor.toString() },
          after: { reversedBy: reversal.publicId, reason: input.reason },
        });
        return { ok: true as const, publicId: reversal.publicId };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      },
    ),
  );
}
