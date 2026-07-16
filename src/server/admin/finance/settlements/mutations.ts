import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { PROFIT_CALC_VERSION } from "@/server/finance/math/profit";
import { sumSignedMinor } from "@/server/finance/math/rounding";
import { computePartnerShare } from "@/server/finance/math/settlement";
import {
  computeProfitForOrderRow,
  ORDER_PROFIT_SELECT,
} from "@/server/finance/order-profit-data";
import { withSerializableRetry } from "@/server/orders/retry";

const RETURN_TO = "/admin/finance/settlements";

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
    timeout: 30_000,
  } as const;
}

function createSettlementNumber(now: Date) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const entropy = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return `PS-${date}-${entropy}`;
}

export async function upsertPartner(input: {
  publicId?: string;
  name: string;
  shareBps: number;
  effectiveFrom: string;
  isActive: boolean;
  notes: string;
}): Promise<MutationResult> {
  const authorization = await requirePermission(
    "finance.partner-settlements.manage",
    RETURN_TO,
  );
  const actorUserId = authorization.session.user.id;
  if (!Number.isSafeInteger(input.shareBps) || input.shareBps < 0 || input.shareBps > 10_000) {
    return failure("invalid_share", "The share must be between 0 and 10000 basis points.");
  }
  const effectiveFrom = new Date(input.effectiveFrom || new Date().toISOString());
  if (Number.isNaN(effectiveFrom.getTime())) {
    return failure("invalid_date", "Effective-from must be an ISO date.");
  }

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const data = {
        name: input.name,
        shareBps: input.shareBps,
        effectiveFrom,
        isActive: input.isActive,
        notes: input.notes || null,
      };
      if (input.publicId) {
        const before = await tx.partner.findFirst({
          where: { publicId: input.publicId },
          select: { id: true, name: true, shareBps: true, effectiveFrom: true, isActive: true, notes: true },
        });
        if (!before) return failure("not_found", "Partner not found.");
        const after = await tx.partner.update({
          where: { id: before.id },
          data,
          select: { publicId: true, name: true, shareBps: true, effectiveFrom: true, isActive: true, notes: true },
        });
        await writeAdminAuditLog(tx, {
          actorUserId,
          action: "finance.partner.update",
          resourceType: "partner",
          resourceId: after.publicId,
          before,
          after,
        });
        return { ok: true as const, publicId: after.publicId };
      }
      const created = await tx.partner.create({
        data: { ...data, createdByUserId: actorUserId },
        select: { publicId: true, name: true, shareBps: true },
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.partner.create",
        resourceType: "partner",
        resourceId: created.publicId,
        before: { exists: false },
        after: created,
      });
      return { ok: true as const, publicId: created.publicId };
    }, transactionOptions()),
  );
}

/**
 * Builds a settlement draft for one partner and period. The draft claims the
 * included orders and orphan adjustments so no other settlement can take
 * them; voiding releases the claims. Losses carry forward: the previous
 * locked/paid settlement's carryover is netted before the split.
 */
export async function generateSettlementDraft(input: {
  partnerPublicId: string;
  periodStart: string;
  periodEnd: string;
  notes: string;
}): Promise<MutationResult> {
  const authorization = await requirePermission(
    "finance.partner-settlements.manage",
    RETURN_TO,
  );
  const actorUserId = authorization.session.user.id;
  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return failure("invalid_dates", "Period start and end must be ISO dates.");
  }
  if (periodEnd <= periodStart) {
    return failure("invalid_dates", "The period end must be after the start.");
  }

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const partner = await tx.partner.findFirst({
        where: { publicId: input.partnerPublicId, isActive: true },
        select: { id: true, publicId: true, name: true, shareBps: true },
      });
      if (!partner) return failure("partner_not_found", "Active partner not found.");

      const open = await tx.partnerSettlement.findFirst({
        where: {
          partnerId: partner.id,
          status: { in: ["DRAFT", "PENDING_CONFIRMATION"] },
        },
        select: { settlementNumber: true },
      });
      if (open) {
        return failure(
          "open_settlement",
          `Finish or void ${open.settlementNumber} before drafting a new settlement.`,
        );
      }

      // Orders confirmed inside the period whose profit is not yet settled.
      const orders = await tx.order.findMany({
        where: {
          profitSettledSettlementId: null,
          status: { in: ["CONFIRMED", "PROCESSING", "COMPLETED"] },
          confirmedAt: { gte: periodStart, lt: periodEnd },
        },
        select: ORDER_PROFIT_SELECT,
        orderBy: { id: "asc" },
      });

      // Post-settlement/late adjustments: rows not yet settled whose order was
      // settled earlier (or that have no order), effective before period end.
      const orphanAdjustments = await tx.financialAdjustment.findMany({
        where: {
          settledInSettlementId: null,
          effectiveAt: { lt: periodEnd },
          OR: [
            { orderId: null },
            { order: { profitSettledSettlementId: { not: null } } },
          ],
        },
        select: { id: true, signedUsdMinor: true },
        orderBy: { id: "asc" },
      });

      if (orders.length === 0 && orphanAdjustments.length === 0) {
        return failure(
          "empty_period",
          "No unsettled orders or adjustments fall inside this period.",
        );
      }

      const breakdowns = orders.map((order) => ({
        order,
        profit: computeProfitForOrderRow(order),
      }));
      const estimatedOrders = breakdowns.filter((entry) => entry.profit.isEstimated);

      const revenueUsdMinor = sumSignedMinor(
        breakdowns.map((entry) => entry.profit.netOperatingRevenueUsdMinor),
      );
      const cogsUsdMinor = sumSignedMinor(
        breakdowns.map((entry) => entry.profit.cogsUsdMinor),
      );
      const shippingCostUsdMinor = sumSignedMinor(
        breakdowns.map(
          (entry) => entry.profit.shippingCostUsdMinor + entry.profit.packagingCostUsdMinor,
        ),
      );
      const feesUsdMinor = sumSignedMinor(
        breakdowns.map(
          (entry) => entry.profit.paymentFeesUsdMinor + entry.profit.conversionFeesUsdMinor,
        ),
      );
      const afterSalesUsdMinor = sumSignedMinor(
        breakdowns.map((entry) => entry.profit.afterSalesCostUsdMinor),
      );
      const orphanSumUsdMinor = sumSignedMinor(
        orphanAdjustments.map((adjustment) => adjustment.signedUsdMinor),
      );
      const otherAdjustmentsUsdMinor =
        sumSignedMinor(
          breakdowns.map(
            (entry) =>
              entry.profit.exchangeNetUsdMinor +
              entry.profit.costCorrectionsUsdMinor -
              entry.profit.otherDirectCostUsdMinor,
          ),
        ) + orphanSumUsdMinor;

      // Identity check: the stored categories reconcile exactly with the sum
      // of per-order profits plus orphan adjustments.
      const profitUsdMinor =
        revenueUsdMinor -
        cogsUsdMinor -
        shippingCostUsdMinor -
        feesUsdMinor -
        afterSalesUsdMinor +
        otherAdjustmentsUsdMinor;
      const perOrderProfit = sumSignedMinor(
        breakdowns.map((entry) => entry.profit.finalProfitUsdMinor),
      );
      if (profitUsdMinor !== perOrderProfit + orphanSumUsdMinor) {
        throw new Error("Settlement categories failed to reconcile with order detail.");
      }

      const previous = await tx.partnerSettlement.findFirst({
        where: { partnerId: partner.id, status: { in: ["LOCKED", "PAID"] } },
        orderBy: [{ periodEnd: "desc" }, { id: "desc" }],
        select: { id: true, carryoverOutUsdMinor: true },
      });
      const carryoverInUsdMinor = previous?.carryoverOutUsdMinor ?? BigInt(0);

      const share = computePartnerShare({
        periodProfitUsdMinor: profitUsdMinor,
        carryoverInUsdMinor,
        shareBps: partner.shareBps,
      });

      const estimationNote =
        estimatedOrders.length > 0
          ? `WARNING: ${estimatedOrders.length} order(s) still have estimated figures (${[
              ...new Set(estimatedOrders.flatMap((entry) => entry.profit.estimationReasons)),
            ].join(", ")}). Record actual costs before locking.`
          : null;

      const created = await tx.partnerSettlement.create({
        data: {
          settlementNumber: createSettlementNumber(new Date()),
          partnerId: partner.id,
          status: "DRAFT",
          periodStart,
          periodEnd,
          shareBpsSnapshot: partner.shareBps,
          calcVersion: PROFIT_CALC_VERSION,
          revenueUsdMinor,
          cogsUsdMinor,
          shippingCostUsdMinor,
          feesUsdMinor,
          afterSalesUsdMinor,
          otherAdjustmentsUsdMinor,
          profitUsdMinor,
          carryoverInUsdMinor,
          distributableUsdMinor: share.distributableUsdMinor,
          partnerShareUsdMinor: share.partnerShareUsdMinor,
          ownerShareUsdMinor: share.ownerShareUsdMinor,
          carryoverOutUsdMinor: share.carryoverOutUsdMinor,
          notes: [input.notes || null, estimationNote].filter(Boolean).join("\n") || null,
          createdByUserId: actorUserId,
        },
        select: { id: true, publicId: true, settlementNumber: true },
      });

      // Claim the orders and adjustments for this settlement.
      await tx.order.updateMany({
        where: { id: { in: orders.map((order) => order.id) } },
        data: { profitSettledSettlementId: created.id },
      });
      // Adjustments already attached to the claimed orders were counted inside
      // the per-order profits above; mark them settled here so a later
      // settlement's late-adjustment sweep cannot double-count them.
      await tx.financialAdjustment.updateMany({
        where: {
          settledInSettlementId: null,
          orderId: { in: orders.map((order) => order.id) },
        },
        data: { settledInSettlementId: created.id },
      });
      await tx.financialAdjustment.updateMany({
        where: { id: { in: orphanAdjustments.map((adjustment) => adjustment.id) } },
        data: { settledInSettlementId: created.id },
      });

      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.settlement.draft",
        resourceType: "partner_settlement",
        resourceId: created.publicId,
        before: { exists: false },
        after: {
          settlementNumber: created.settlementNumber,
          orders: orders.length,
          orphanAdjustments: orphanAdjustments.length,
          profitUsdMinor: profitUsdMinor.toString(),
          partnerShareUsdMinor: share.partnerShareUsdMinor.toString(),
          carryoverInUsdMinor: carryoverInUsdMinor.toString(),
          estimatedOrders: estimatedOrders.length,
        },
      });
      return { ok: true as const, publicId: created.publicId };
    }, transactionOptions()),
  );
}

async function transition(
  publicId: string,
  from: readonly ("DRAFT" | "PENDING_CONFIRMATION" | "LOCKED")[],
  to: "PENDING_CONFIRMATION" | "LOCKED",
  action: string,
  permission: "finance.partner-settlements.manage" | "finance.partner-settlements.lock",
): Promise<MutationResult> {
  const authorization = await requirePermission(permission, RETURN_TO);
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const settlement = await tx.partnerSettlement.findFirst({
        where: { publicId },
        select: { id: true, publicId: true, status: true, partnerId: true },
      });
      if (!settlement) return failure("not_found", "Settlement not found.");
      if (settlement.status === to) return { ok: true as const, publicId };
      if (!(from as readonly string[]).includes(settlement.status)) {
        return failure("invalid_transition", `A ${settlement.status.toLowerCase()} settlement cannot ${action}.`);
      }

      const data: Prisma.PartnerSettlementUpdateInput = { status: to };
      if (to === "PENDING_CONFIRMATION") {
        data.confirmedBy = { connect: { id: actorUserId } };
      }
      if (to === "LOCKED") {
        data.lockedAt = new Date();
        const previous = await tx.partnerSettlement.findFirst({
          where: {
            partnerId: settlement.partnerId,
            status: { in: ["LOCKED", "PAID"] },
            id: { not: settlement.id },
            nextSettlement: null,
          },
          orderBy: [{ periodEnd: "desc" }, { id: "desc" }],
          select: { id: true },
        });
        if (previous) {
          data.previousSettlement = { connect: { id: previous.id } };
        }
      }
      await tx.partnerSettlement.update({
        where: { id: settlement.id },
        data,
        select: { id: true },
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: `finance.settlement.${action}`,
        resourceType: "partner_settlement",
        resourceId: publicId,
        before: { status: settlement.status },
        after: { status: to },
      });
      return { ok: true as const, publicId };
    }, transactionOptions()),
  );
}

export async function confirmSettlement(publicId: string): Promise<MutationResult> {
  return transition(
    publicId,
    ["DRAFT"],
    "PENDING_CONFIRMATION",
    "confirm",
    "finance.partner-settlements.manage",
  );
}

export async function lockSettlement(publicId: string): Promise<MutationResult> {
  return transition(
    publicId,
    ["PENDING_CONFIRMATION"],
    "LOCKED",
    "lock",
    "finance.partner-settlements.lock",
  );
}

export async function markSettlementPaid(input: {
  settlementPublicId: string;
  paidUsdMinor: bigint;
  paymentMethod: string;
  paymentReference: string;
  paidAt: string;
}): Promise<MutationResult> {
  const authorization = await requirePermission(
    "finance.partner-settlements.lock",
    RETURN_TO,
  );
  const actorUserId = authorization.session.user.id;
  if (input.paidUsdMinor < BigInt(0)) {
    return failure("invalid_amount", "The paid amount cannot be negative.");
  }
  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) {
    return failure("invalid_date", "Paid-at must be an ISO date.");
  }

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const settlement = await tx.partnerSettlement.findFirst({
        where: { publicId: input.settlementPublicId },
        select: { id: true, status: true, partnerShareUsdMinor: true },
      });
      if (!settlement) return failure("not_found", "Settlement not found.");
      if (settlement.status === "PAID") {
        return { ok: true as const, publicId: input.settlementPublicId };
      }
      if (settlement.status !== "LOCKED") {
        return failure("not_locked", "Lock the settlement before marking it paid.");
      }
      if (input.paidUsdMinor > settlement.partnerShareUsdMinor) {
        return failure(
          "overpaid",
          "The paid amount exceeds the partner's share for this settlement.",
        );
      }
      await tx.partnerSettlement.update({
        where: { id: settlement.id },
        data: {
          status: "PAID",
          paidUsdMinor: input.paidUsdMinor,
          paidAt,
          paymentMethod: input.paymentMethod.trim() || null,
          paymentReference: input.paymentReference.trim() || null,
          paidConfirmedByUserId: actorUserId,
        },
        select: { id: true },
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.settlement.mark_paid",
        resourceType: "partner_settlement",
        resourceId: input.settlementPublicId,
        before: { status: "LOCKED" },
        after: {
          status: "PAID",
          paidUsdMinor: input.paidUsdMinor.toString(),
          paymentReference: input.paymentReference || null,
        },
      });
      return { ok: true as const, publicId: input.settlementPublicId };
    }, transactionOptions()),
  );
}

/**
 * Voids a settlement that has not been paid, releasing its orders and
 * adjustments so a corrected settlement can be regenerated. Paid settlements
 * are immutable; corrections happen through PARTNER_SETTLEMENT_CORRECTION
 * adjustments in a later period.
 */
export async function voidSettlement(input: {
  settlementPublicId: string;
  reason: string;
}): Promise<MutationResult> {
  const authorization = await requirePermission(
    "finance.partner-settlements.lock",
    RETURN_TO,
  );
  const actorUserId = authorization.session.user.id;
  if (!input.reason.trim()) {
    return failure("reason_required", "A void reason is required.");
  }

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const settlement = await tx.partnerSettlement.findFirst({
        where: { publicId: input.settlementPublicId },
        select: { id: true, status: true, nextSettlement: { select: { id: true } } },
      });
      if (!settlement) return failure("not_found", "Settlement not found.");
      if (settlement.status === "VOIDED") {
        return { ok: true as const, publicId: input.settlementPublicId };
      }
      if (settlement.status === "PAID") {
        return failure(
          "paid_immutable",
          "Paid settlements cannot be voided; use a settlement correction adjustment.",
        );
      }
      if (settlement.nextSettlement) {
        return failure(
          "has_successor",
          "A later settlement chains from this one; void that settlement first.",
        );
      }

      await tx.order.updateMany({
        where: { profitSettledSettlementId: settlement.id },
        data: { profitSettledSettlementId: null },
      });
      await tx.financialAdjustment.updateMany({
        where: { settledInSettlementId: settlement.id },
        data: { settledInSettlementId: null },
      });
      await tx.partnerSettlement.update({
        where: { id: settlement.id },
        data: {
          status: "VOIDED",
          voidedAt: new Date(),
          previousSettlement: { disconnect: true },
        },
        select: { id: true },
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "finance.settlement.void",
        resourceType: "partner_settlement",
        resourceId: input.settlementPublicId,
        before: { status: settlement.status },
        after: { status: "VOIDED", reason: input.reason },
      });
      return { ok: true as const, publicId: input.settlementPublicId };
    }, transactionOptions()),
  );
}
