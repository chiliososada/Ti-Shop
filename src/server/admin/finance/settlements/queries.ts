import "server-only";

import {
  buildPagination,
  normalizePageSearchParameter,
  type SearchParameter,
} from "@/lib/pagination";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { computeProfitForOrderRow, ORDER_PROFIT_SELECT } from "@/server/finance/order-profit-data";

const settlementSelect = {
  publicId: true,
  settlementNumber: true,
  status: true,
  periodStart: true,
  periodEnd: true,
  shareBpsSnapshot: true,
  calcVersion: true,
  revenueUsdMinor: true,
  cogsUsdMinor: true,
  shippingCostUsdMinor: true,
  feesUsdMinor: true,
  afterSalesUsdMinor: true,
  otherAdjustmentsUsdMinor: true,
  profitUsdMinor: true,
  carryoverInUsdMinor: true,
  distributableUsdMinor: true,
  partnerShareUsdMinor: true,
  ownerShareUsdMinor: true,
  carryoverOutUsdMinor: true,
  paidUsdMinor: true,
  paidAt: true,
  paymentMethod: true,
  paymentReference: true,
  notes: true,
  lockedAt: true,
  voidedAt: true,
  createdAt: true,
} as const;

export type SerializedSettlement = Record<string, string | number | null>;

function serializeSettlement(row: Record<string, unknown>): SerializedSettlement {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === "bigint"
        ? value.toString()
        : value instanceof Date
          ? value.toISOString()
          : (value as string | number | null),
    ]),
  ) as SerializedSettlement;
}

export async function getAdminSettlementIndex(
  searchParams: Record<string, SearchParameter>,
) {
  await requirePermission(
    "finance.partner-settlements.read",
    "/admin/finance/settlements",
  );
  const page = normalizePageSearchParameter(searchParams.page);
  const db = getDb();
  const [total, partners] = await Promise.all([
    db.partnerSettlement.count(),
    db.partner.findMany({
      orderBy: { effectiveFrom: "desc" },
      select: {
        publicId: true,
        name: true,
        shareBps: true,
        effectiveFrom: true,
        isActive: true,
        notes: true,
      },
    }),
  ]);
  const pagination = buildPagination(total, page, 25);
  const settlements = await db.partnerSettlement.findMany({
    orderBy: [{ periodStart: "desc" }, { id: "desc" }],
    skip: pagination.skip,
    take: pagination.pageSize,
    select: { ...settlementSelect, partner: { select: { name: true, publicId: true } } },
  });
  return {
    pagination,
    partners: partners.map((partner) => ({
      ...partner,
      effectiveFrom: partner.effectiveFrom.toISOString(),
    })),
    settlements: settlements.map((settlement) => {
      const serialized: SerializedSettlement = serializeSettlement(settlement);
      serialized.partnerName = settlement.partner.name;
      return serialized;
    }),
  };
}

export async function getAdminSettlementDetail(publicId: string) {
  await requirePermission(
    "finance.partner-settlements.read",
    "/admin/finance/settlements",
  );
  const db = getDb();
  const settlement = await db.partnerSettlement.findFirst({
    where: { publicId },
    select: {
      ...settlementSelect,
      id: true,
      partner: { select: { name: true, publicId: true, shareBps: true } },
      createdBy: { select: { name: true } },
      confirmedBy: { select: { name: true } },
      paidConfirmedBy: { select: { name: true } },
      previousSettlement: { select: { publicId: true, settlementNumber: true } },
    },
  });
  if (!settlement) return null;

  const [orders, adjustments] = await Promise.all([
    db.order.findMany({
      where: { profitSettledSettlementId: settlement.id },
      select: ORDER_PROFIT_SELECT,
      orderBy: { confirmedAt: "asc" },
      take: 2_000,
    }),
    db.financialAdjustment.findMany({
      // True late/orphan rows only — adjustments on orders claimed by this
      // settlement are already inside the per-order profits above.
      where: {
        settledInSettlementId: settlement.id,
        OR: [
          { orderId: null },
          { order: { profitSettledSettlementId: { not: settlement.id } } },
        ],
      },
      orderBy: { effectiveAt: "asc" },
      select: {
        publicId: true,
        type: true,
        signedUsdMinor: true,
        effectiveAt: true,
        reason: true,
        order: { select: { orderNumber: true, publicId: true } },
      },
    }),
  ]);

  const { partner, createdBy, confirmedBy, paidConfirmedBy, previousSettlement, ...rest } =
    settlement;
  delete (rest as Record<string, unknown>).id;

  const serialized: SerializedSettlement = serializeSettlement(rest);
  serialized.partnerName = partner.name;
  serialized.partnerPublicId = partner.publicId;
  serialized.createdByName = createdBy?.name ?? null;
  serialized.confirmedByName = confirmedBy?.name ?? null;
  serialized.paidConfirmedByName = paidConfirmedBy?.name ?? null;
  serialized.previousSettlementNumber = previousSettlement?.settlementNumber ?? null;
  serialized.previousSettlementPublicId = previousSettlement?.publicId ?? null;

  return {
    settlement: serialized,
    orders: orders.map((order) => {
      const profit = computeProfitForOrderRow(order);
      return {
        publicId: order.publicId,
        orderNumber: order.orderNumber,
        confirmedAt: order.confirmedAt?.toISOString() ?? null,
        netRevenueUsdMinor: profit.netOperatingRevenueUsdMinor.toString(),
        profitUsdMinor: profit.finalProfitUsdMinor.toString(),
        isEstimated: profit.isEstimated,
      };
    }),
    lateAdjustments: adjustments.map((adjustment) => ({
      publicId: adjustment.publicId,
      type: adjustment.type,
      signedUsdMinor: adjustment.signedUsdMinor.toString(),
      effectiveAt: adjustment.effectiveAt.toISOString(),
      reason: adjustment.reason,
      orderNumber: adjustment.order?.orderNumber ?? null,
      orderPublicId: adjustment.order?.publicId ?? null,
    })),
  };
}

export const SETTLEMENT_CSV_COLUMNS = [
  "settlementNumber",
  "partner",
  "status",
  "periodStart",
  "periodEnd",
  "shareBps",
  "calcVersion",
  "revenueUsd",
  "cogsUsd",
  "shippingCostUsd",
  "feesUsd",
  "afterSalesUsd",
  "otherAdjustmentsUsd",
  "profitUsd",
  "carryoverInUsd",
  "distributableUsd",
  "partnerShareUsd",
  "ownerShareUsd",
  "carryoverOutUsd",
  "paidUsd",
  "paidAt",
  "paymentMethod",
  "paymentReference",
  "originalCurrency",
  "state",
] as const;

function usdString(minor: bigint): string {
  const negative = minor < BigInt(0);
  const abs = (negative ? -minor : minor).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

export async function getSettlementExportRows() {
  await requirePermission("finance.export", "/admin/finance/settlements");
  const settlements = await getDb().partnerSettlement.findMany({
    orderBy: { id: "asc" },
    take: 5_000,
    select: { ...settlementSelect, partner: { select: { name: true } } },
  });
  return settlements.map((settlement) => ({
    settlementNumber: settlement.settlementNumber,
    partner: settlement.partner.name,
    status: settlement.status,
    periodStart: settlement.periodStart.toISOString().slice(0, 10),
    periodEnd: settlement.periodEnd.toISOString().slice(0, 10),
    shareBps: String(settlement.shareBpsSnapshot),
    calcVersion: String(settlement.calcVersion),
    revenueUsd: usdString(settlement.revenueUsdMinor),
    cogsUsd: usdString(settlement.cogsUsdMinor),
    shippingCostUsd: usdString(settlement.shippingCostUsdMinor),
    feesUsd: usdString(settlement.feesUsdMinor),
    afterSalesUsd: usdString(settlement.afterSalesUsdMinor),
    otherAdjustmentsUsd: usdString(settlement.otherAdjustmentsUsdMinor),
    profitUsd: usdString(settlement.profitUsdMinor),
    carryoverInUsd: usdString(settlement.carryoverInUsdMinor),
    distributableUsd: usdString(settlement.distributableUsdMinor),
    partnerShareUsd: usdString(settlement.partnerShareUsdMinor),
    ownerShareUsd: usdString(settlement.ownerShareUsdMinor),
    carryoverOutUsd: usdString(settlement.carryoverOutUsdMinor),
    paidUsd: usdString(settlement.paidUsdMinor),
    paidAt: settlement.paidAt?.toISOString() ?? "",
    paymentMethod: settlement.paymentMethod ?? "",
    paymentReference: settlement.paymentReference ?? "",
    originalCurrency: "USD",
    state: settlement.status === "LOCKED" || settlement.status === "PAID" ? "Finalized" : "Estimated",
  }));
}
