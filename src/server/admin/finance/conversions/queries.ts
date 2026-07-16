import "server-only";

import {
  buildPagination,
  normalizePageSearchParameter,
  type SearchParameter,
} from "@/lib/pagination";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";

export async function getAdminConversionIndex(
  searchParams: Record<string, SearchParameter>,
) {
  await requirePermission("finance.read", "/admin/finance/conversions");
  const page = normalizePageSearchParameter(searchParams.page);
  const db = getDb();
  const total = await db.cryptoConversionBatch.count();
  const pagination = buildPagination(total, page, 25);
  const batches = await db.cryptoConversionBatch.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: pagination.skip,
    take: pagination.pageSize,
    select: {
      publicId: true,
      batchNumber: true,
      kind: true,
      status: true,
      targetAsset: true,
      totalUsdMinor: true,
      feeRateBps: true,
      estimatedFeeUsdMinor: true,
      actualFeeUsdMinor: true,
      chainFeeUsdMinor: true,
      transactionId: true,
      convertedAt: true,
      createdAt: true,
      _count: { select: { entries: true } },
    },
  });
  return {
    pagination,
    batches: batches.map((batch) => ({
      publicId: batch.publicId,
      batchNumber: batch.batchNumber,
      kind: batch.kind,
      status: batch.status,
      targetAsset: batch.targetAsset,
      totalUsdMinor: batch.totalUsdMinor.toString(),
      feeRateBps: batch.feeRateBps,
      estimatedFeeUsdMinor: batch.estimatedFeeUsdMinor.toString(),
      actualFeeUsdMinor: batch.actualFeeUsdMinor?.toString() ?? null,
      chainFeeUsdMinor: batch.chainFeeUsdMinor?.toString() ?? null,
      transactionId: batch.transactionId,
      entryCount: batch._count.entries,
      convertedAt: batch.convertedAt?.toISOString() ?? null,
      createdAt: batch.createdAt.toISOString(),
    })),
  };
}

export async function getAdminConversionBatch(publicId: string) {
  await requirePermission("finance.read", "/admin/finance/conversions");
  const db = getDb();
  const batch = await db.cryptoConversionBatch.findFirst({
    where: { publicId },
    select: {
      publicId: true,
      batchNumber: true,
      kind: true,
      status: true,
      targetAsset: true,
      totalUsdMinor: true,
      feeRateBps: true,
      estimatedFeeUsdMinor: true,
      actualFeeUsdMinor: true,
      chainFeeUsdMinor: true,
      rate: true,
      rateAt: true,
      rateSource: true,
      targetAmount: true,
      receivedAmount: true,
      transactionId: true,
      convertedAt: true,
      notes: true,
      createdAt: true,
      completedAt: true,
      voidedAt: true,
      entries: {
        orderBy: { id: "asc" },
        select: {
          usdAmountMinor: true,
          allocatedFeeUsdMinor: true,
          allocatedChainFeeUsdMinor: true,
          payment: {
            select: {
              publicId: true,
              method: true,
              cryptoCurrency: true,
              actuallyPaid: true,
            },
          },
          order: { select: { publicId: true, orderNumber: true } },
        },
      },
    },
  });
  if (!batch) return null;

  // Confirmed payments not yet in a live batch, matching the batch kind.
  const candidates =
    batch.status === "DRAFT"
      ? await db.payment.findMany({
          where: {
            status: "CONFIRMED",
            method:
              batch.kind === "DIRECT_CRYPTO"
                ? "NOWPAYMENTS"
                : { in: ["WIRE_TRANSFER", "ZELLE", "OTHER_MANUAL"] },
            conversionEntries: { none: { activePaymentKey: { not: null } } },
          },
          orderBy: { confirmedAt: "desc" },
          take: 100,
          select: {
            publicId: true,
            method: true,
            amountMinor: true,
            confirmedAt: true,
            order: { select: { orderNumber: true } },
          },
        })
      : [];

  return {
    batch: {
      ...batch,
      totalUsdMinor: batch.totalUsdMinor.toString(),
      estimatedFeeUsdMinor: batch.estimatedFeeUsdMinor.toString(),
      actualFeeUsdMinor: batch.actualFeeUsdMinor?.toString() ?? null,
      chainFeeUsdMinor: batch.chainFeeUsdMinor?.toString() ?? null,
      rate: batch.rate?.toString() ?? null,
      rateAt: batch.rateAt?.toISOString() ?? null,
      targetAmount: batch.targetAmount?.toString() ?? null,
      receivedAmount: batch.receivedAmount?.toString() ?? null,
      convertedAt: batch.convertedAt?.toISOString() ?? null,
      createdAt: batch.createdAt.toISOString(),
      completedAt: batch.completedAt?.toISOString() ?? null,
      voidedAt: batch.voidedAt?.toISOString() ?? null,
      entries: batch.entries.map((entry) => ({
        usdAmountMinor: entry.usdAmountMinor.toString(),
        allocatedFeeUsdMinor: entry.allocatedFeeUsdMinor.toString(),
        allocatedChainFeeUsdMinor: entry.allocatedChainFeeUsdMinor.toString(),
        paymentPublicId: entry.payment.publicId,
        method: entry.payment.method,
        cryptoCurrency: entry.payment.cryptoCurrency,
        actuallyPaid: entry.payment.actuallyPaid?.toString() ?? null,
        orderNumber: entry.order.orderNumber,
        orderPublicId: entry.order.publicId,
      })),
    },
    candidates: candidates.map((payment) => ({
      publicId: payment.publicId,
      method: payment.method,
      amountMinor: payment.amountMinor.toString(),
      confirmedAt: payment.confirmedAt?.toISOString() ?? null,
      orderNumber: payment.order.orderNumber,
    })),
  };
}

export const CONVERSION_CSV_COLUMNS = [
  "batchNumber",
  "kind",
  "status",
  "targetAsset",
  "orderNumber",
  "paymentMethod",
  "usdAmount",
  "allocatedFeeUsd",
  "allocatedChainFeeUsd",
  "feeRateBps",
  "rate",
  "rateAt",
  "rateSource",
  "receivedAmount",
  "transactionId",
  "originalCurrency",
  "feeState",
  "convertedAt",
] as const;

function usdString(minor: bigint): string {
  const negative = minor < BigInt(0);
  const abs = (negative ? -minor : minor).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

export async function getConversionExportRows() {
  await requirePermission("finance.export", "/admin/finance/conversions");
  const entries = await getDb().cryptoConversionEntry.findMany({
    orderBy: { id: "asc" },
    take: 10_000,
    select: {
      usdAmountMinor: true,
      allocatedFeeUsdMinor: true,
      allocatedChainFeeUsdMinor: true,
      payment: { select: { method: true, cryptoCurrency: true } },
      order: { select: { orderNumber: true } },
      batch: {
        select: {
          batchNumber: true,
          kind: true,
          status: true,
          targetAsset: true,
          feeRateBps: true,
          rate: true,
          rateAt: true,
          rateSource: true,
          receivedAmount: true,
          transactionId: true,
          actualFeeUsdMinor: true,
          convertedAt: true,
        },
      },
    },
  });
  return entries.map((entry) => ({
    batchNumber: entry.batch.batchNumber,
    kind: entry.batch.kind,
    status: entry.batch.status,
    targetAsset: entry.batch.targetAsset,
    orderNumber: entry.order.orderNumber,
    paymentMethod: entry.payment.method,
    usdAmount: usdString(entry.usdAmountMinor),
    allocatedFeeUsd: usdString(entry.allocatedFeeUsdMinor),
    allocatedChainFeeUsd: usdString(entry.allocatedChainFeeUsdMinor),
    feeRateBps: String(entry.batch.feeRateBps),
    rate: entry.batch.rate?.toString() ?? "",
    rateAt: entry.batch.rateAt?.toISOString() ?? "",
    rateSource: entry.batch.rateSource ?? "",
    receivedAmount: entry.batch.receivedAmount?.toString() ?? "",
    transactionId: entry.batch.transactionId ?? "",
    originalCurrency: entry.payment.method === "NOWPAYMENTS" ? (entry.payment.cryptoCurrency ?? "CRYPTO") : "USD",
    feeState:
      entry.batch.status === "COMPLETED" && entry.batch.actualFeeUsdMinor !== null
        ? "Finalized"
        : "Estimated",
    convertedAt: entry.batch.convertedAt?.toISOString() ?? "",
  }));
}
