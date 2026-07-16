"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import {
  actionFailure,
  actionSuccess,
  formDataFailure,
  logUnexpectedAdminActionError,
  type AdminActionState,
  validationFailure,
} from "@/server/admin/audit/action-state";
import { readStrictFormData } from "@/server/admin/audit/form-data";
import {
  createFinancialAdjustment,
  isAdjustmentType,
  reverseFinancialAdjustment,
} from "@/server/admin/finance/adjustments/mutations";
import {
  addPaymentToBatch,
  completeConversionBatch,
  createConversionBatch,
  removePaymentFromBatch,
  voidConversionBatch,
} from "@/server/admin/finance/conversions/mutations";
import { recordShipmentCosts } from "@/server/admin/finance/costs/mutations";
import {
  confirmSettlement,
  generateSettlementDraft,
  lockSettlement,
  markSettlementPaid,
  upsertPartner,
  voidSettlement,
} from "@/server/admin/finance/settlements/mutations";
import { parseDecimal } from "@/server/payments/nowpayments/decimal";

function refreshFinance(extra?: string[]) {
  for (const path of [
    "/admin/finance",
    "/admin/finance/orders",
    "/admin/finance/conversions",
    "/admin/finance/settlements",
    ...(extra ?? []),
  ]) {
    revalidatePath(path);
  }
}

const usdMinor = z
  .string()
  .trim()
  // An empty input means zero; typed values must look like 12.34.
  .regex(/^(?:\d{1,13}(?:\.\d{1,2})?)?$/u, "Use a USD amount like 12.34")
  .transform((value) => {
    const parsed = parseDecimal(value === "" ? "0" : value);
    return parsed.coefficient * BigInt(10) ** BigInt(2 - parsed.scale);
  });

type Outcome =
  | { ok: true; publicId?: string; orderPublicId?: string }
  | { ok: false; reason: string; message: string };

async function run(
  scope: string,
  work: () => Promise<Outcome>,
  successMessage: string,
  extraPaths?: (result: Outcome & { ok: true }) => string[],
): Promise<AdminActionState> {
  try {
    const result = await work();
    if (!result.ok) return actionFailure(result.message);
    refreshFinance(extraPaths?.(result));
    return actionSuccess(successMessage);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError(scope, error);
    return actionFailure("The change failed unexpectedly. Try again.");
  }
}

// ---- Shipment costs -------------------------------------------------------

const shipmentCostsSchema = z.object({
  shipmentPublicId: z.uuid(),
  orderPublicId: z.uuid(),
  shippingCost: usdMinor,
  packagingCost: usdMinor.default("0" as never),
});

export async function recordShipmentCostsAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, [
    "shipmentPublicId",
    "orderPublicId",
    "shippingCost",
    "packagingCost",
  ]);
  if (!raw.success) return formDataFailure(raw.message);
  const parsed = shipmentCostsSchema.safeParse(raw.data);
  if (!parsed.success) return validationFailure(parsed.error);
  return run(
    "finance.costs.record",
    () =>
      recordShipmentCosts({
        shipmentPublicId: parsed.data.shipmentPublicId,
        shippingCostMinor: parsed.data.shippingCost,
        packagingCostMinor: parsed.data.packagingCost,
      }),
    "Actual shipment costs recorded.",
    () => [`/admin/finance/orders/${parsed.data.orderPublicId}`],
  );
}

// ---- Manual adjustments ---------------------------------------------------

const adjustmentSchema = z.object({
  orderPublicId: z.uuid(),
  type: z.string().refine(isAdjustmentType, "Unknown adjustment type"),
  direction: z.enum(["INCREASE", "DECREASE"]),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,13}(?:\.\d{1,2})?$/u, "Use an amount like 12.34"),
  originalCurrency: z.enum(["USD", "CNY"]),
  fxRate: z.string().trim().max(24).optional().default(""),
  effectiveAt: z.string().trim().max(40).optional().default(""),
  reason: z.string().trim().min(1).max(4_000),
  isEstimated: z.enum(["true", "false"]).default("false"),
});

export async function createAdjustmentAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, [
    "orderPublicId",
    "type",
    "direction",
    "amount",
    "originalCurrency",
    "fxRate",
    "effectiveAt",
    "reason",
    "isEstimated",
  ]);
  if (!raw.success) return formDataFailure(raw.message);
  const parsed = adjustmentSchema.safeParse(raw.data);
  if (!parsed.success) return validationFailure(parsed.error);
  const amountParsed = parseDecimal(parsed.data.amount);
  const amountMinor =
    amountParsed.coefficient * BigInt(10) ** BigInt(2 - amountParsed.scale);
  return run(
    "finance.adjustment.create",
    () =>
      createFinancialAdjustment({
        orderPublicId: parsed.data.orderPublicId,
        type: parsed.data.type,
        direction: parsed.data.direction,
        amountMinor,
        originalCurrency: parsed.data.originalCurrency,
        fxRateCnyPerUsd: parsed.data.fxRate,
        effectiveAt: parsed.data.effectiveAt,
        reason: parsed.data.reason,
        isEstimated: parsed.data.isEstimated === "true",
      }),
    "Adjustment recorded.",
    () => [`/admin/finance/orders/${parsed.data.orderPublicId}`],
  );
}

export async function reverseAdjustmentAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, [
    "adjustmentPublicId",
    "orderPublicId",
    "reason",
  ]);
  if (!raw.success) return formDataFailure(raw.message);
  const orderPublicId = raw.data.orderPublicId ?? "";
  return run(
    "finance.adjustment.reverse",
    () =>
      reverseFinancialAdjustment({
        adjustmentPublicId: raw.data.adjustmentPublicId ?? "",
        reason: raw.data.reason ?? "",
      }),
    "Reversal recorded.",
    () => (orderPublicId ? [`/admin/finance/orders/${orderPublicId}`] : []),
  );
}

// ---- Conversion batches ---------------------------------------------------

export async function createConversionBatchAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, ["kind", "targetAsset", "notes"]);
  if (!raw.success) return formDataFailure(raw.message);
  const kind = raw.data.kind === "DIRECT_CRYPTO" ? "DIRECT_CRYPTO" : "USD_TO_CRYPTO";
  return run(
    "finance.conversion.create",
    () =>
      createConversionBatch({
        kind,
        targetAsset: raw.data.targetAsset ?? "",
        notes: raw.data.notes ?? "",
      }),
    "Conversion batch created.",
  );
}

export async function addPaymentToBatchAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, ["batchPublicId", "paymentPublicId"]);
  if (!raw.success) return formDataFailure(raw.message);
  return run(
    "finance.conversion.add",
    () =>
      addPaymentToBatch({
        batchPublicId: raw.data.batchPublicId ?? "",
        paymentPublicId: raw.data.paymentPublicId ?? "",
      }),
    "Payment added to the batch.",
    () => [`/admin/finance/conversions/${raw.data.batchPublicId}`],
  );
}

export async function removePaymentFromBatchAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, ["batchPublicId", "paymentPublicId"]);
  if (!raw.success) return formDataFailure(raw.message);
  return run(
    "finance.conversion.remove",
    () =>
      removePaymentFromBatch({
        batchPublicId: raw.data.batchPublicId ?? "",
        paymentPublicId: raw.data.paymentPublicId ?? "",
      }),
    "Payment removed from the batch.",
    () => [`/admin/finance/conversions/${raw.data.batchPublicId}`],
  );
}

const completeBatchSchema = z.object({
  batchPublicId: z.uuid(),
  actualFee: z.string().trim().optional().default(""),
  chainFee: z.string().trim().optional().default(""),
  rate: z.string().trim().max(40).optional().default(""),
  rateSource: z.string().trim().max(160).optional().default(""),
  targetAmount: z.string().trim().max(60).optional().default(""),
  receivedAmount: z.string().trim().max(60).optional().default(""),
  transactionId: z.string().trim().max(255).optional().default(""),
  convertedAt: z.string().trim().max(40).optional().default(""),
});

function optionalUsdMinor(value: string): bigint | null {
  if (!value) return null;
  if (!/^\d{1,13}(?:\.\d{1,2})?$/u.test(value)) {
    throw new Error("Fees must look like 12.34");
  }
  const parsed = parseDecimal(value);
  return parsed.coefficient * BigInt(10) ** BigInt(2 - parsed.scale);
}

export async function completeConversionBatchAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, [
    "batchPublicId",
    "actualFee",
    "chainFee",
    "rate",
    "rateSource",
    "targetAmount",
    "receivedAmount",
    "transactionId",
    "convertedAt",
  ]);
  if (!raw.success) return formDataFailure(raw.message);
  const parsed = completeBatchSchema.safeParse(raw.data);
  if (!parsed.success) return validationFailure(parsed.error);
  let actualFee: bigint | null;
  let chainFee: bigint | null;
  try {
    actualFee = optionalUsdMinor(parsed.data.actualFee);
    chainFee = optionalUsdMinor(parsed.data.chainFee);
  } catch (error) {
    return actionFailure(error instanceof Error ? error.message : "Invalid fee.");
  }
  return run(
    "finance.conversion.complete",
    () =>
      completeConversionBatch({
        batchPublicId: parsed.data.batchPublicId,
        actualFeeUsdMinor: actualFee,
        chainFeeUsdMinor: chainFee,
        rate: parsed.data.rate,
        rateSource: parsed.data.rateSource,
        targetAmount: parsed.data.targetAmount,
        receivedAmount: parsed.data.receivedAmount,
        transactionId: parsed.data.transactionId,
        convertedAt: parsed.data.convertedAt,
      }),
    "Batch completed and fees allocated across orders.",
    () => [`/admin/finance/conversions/${parsed.data.batchPublicId}`],
  );
}

export async function voidConversionBatchAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, ["batchPublicId"]);
  if (!raw.success) return formDataFailure(raw.message);
  return run(
    "finance.conversion.void",
    () => voidConversionBatch(raw.data.batchPublicId ?? ""),
    "Batch voided; its payments may join a new batch.",
    () => [`/admin/finance/conversions/${raw.data.batchPublicId}`],
  );
}

// ---- Partners & settlements ----------------------------------------------

const partnerSchema = z.object({
  publicId: z.uuid().optional(),
  name: z.string().trim().min(1).max(255),
  shareBps: z.coerce.number().int().min(0).max(10_000),
  effectiveFrom: z.string().trim().max(40).optional().default(""),
  isActive: z.enum(["true", "false"]).default("true"),
  notes: z.string().trim().max(4_000).optional().default(""),
});

export async function upsertPartnerAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, [
    "publicId",
    "name",
    "shareBps",
    "effectiveFrom",
    "isActive",
    "notes",
  ]);
  if (!raw.success) return formDataFailure(raw.message);
  const parsed = partnerSchema.safeParse(raw.data);
  if (!parsed.success) return validationFailure(parsed.error);
  return run(
    "finance.partner.upsert",
    () =>
      upsertPartner({
        publicId: parsed.data.publicId,
        name: parsed.data.name,
        shareBps: parsed.data.shareBps,
        effectiveFrom: parsed.data.effectiveFrom,
        isActive: parsed.data.isActive === "true",
        notes: parsed.data.notes,
      }),
    "Partner saved.",
  );
}

const draftSchema = z.object({
  partnerPublicId: z.uuid(),
  periodStart: z.string().trim().min(1).max(40),
  periodEnd: z.string().trim().min(1).max(40),
  notes: z.string().trim().max(4_000).optional().default(""),
});

export async function generateSettlementDraftAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, [
    "partnerPublicId",
    "periodStart",
    "periodEnd",
    "notes",
  ]);
  if (!raw.success) return formDataFailure(raw.message);
  const parsed = draftSchema.safeParse(raw.data);
  if (!parsed.success) return validationFailure(parsed.error);
  return run(
    "finance.settlement.draft",
    () => generateSettlementDraft(parsed.data),
    "Settlement draft generated; review the included orders before confirming.",
  );
}

export async function confirmSettlementAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, ["settlementPublicId"]);
  if (!raw.success) return formDataFailure(raw.message);
  return run(
    "finance.settlement.confirm",
    () => confirmSettlement(raw.data.settlementPublicId ?? ""),
    "Settlement confirmed; lock it to make it immutable.",
    () => [`/admin/finance/settlements/${raw.data.settlementPublicId}`],
  );
}

export async function lockSettlementAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, ["settlementPublicId"]);
  if (!raw.success) return formDataFailure(raw.message);
  return run(
    "finance.settlement.lock",
    () => lockSettlement(raw.data.settlementPublicId ?? ""),
    "Settlement locked. It can no longer be edited.",
    () => [`/admin/finance/settlements/${raw.data.settlementPublicId}`],
  );
}

const paidSchema = z.object({
  settlementPublicId: z.uuid(),
  paidAmount: usdMinor,
  paymentMethod: z.string().trim().max(120).optional().default(""),
  paymentReference: z.string().trim().max(255).optional().default(""),
  paidAt: z.string().trim().max(40).optional().default(""),
});

export async function markSettlementPaidAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, [
    "settlementPublicId",
    "paidAmount",
    "paymentMethod",
    "paymentReference",
    "paidAt",
  ]);
  if (!raw.success) return formDataFailure(raw.message);
  const parsed = paidSchema.safeParse(raw.data);
  if (!parsed.success) return validationFailure(parsed.error);
  return run(
    "finance.settlement.paid",
    () =>
      markSettlementPaid({
        settlementPublicId: parsed.data.settlementPublicId,
        paidUsdMinor: parsed.data.paidAmount,
        paymentMethod: parsed.data.paymentMethod,
        paymentReference: parsed.data.paymentReference,
        paidAt: parsed.data.paidAt,
      }),
    "Settlement marked as paid. (No transfer is ever sent automatically.)",
    () => [`/admin/finance/settlements/${parsed.data.settlementPublicId}`],
  );
}

export async function voidSettlementAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, ["settlementPublicId", "reason"]);
  if (!raw.success) return formDataFailure(raw.message);
  return run(
    "finance.settlement.void",
    () =>
      voidSettlement({
        settlementPublicId: raw.data.settlementPublicId ?? "",
        reason: raw.data.reason ?? "",
      }),
    "Settlement voided; its orders and adjustments were released.",
    () => [`/admin/finance/settlements/${raw.data.settlementPublicId}`],
  );
}
