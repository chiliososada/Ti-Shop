import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  buildPagination,
  normalizePageSearchParameter,
  normalizeSearchText,
  type SearchParameter,
} from "@/lib/pagination";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { PROFIT_CALC_VERSION } from "@/server/finance/math/profit";
import { divideRoundHalfUp, sumSignedMinor } from "@/server/finance/math/rounding";
import { computePartnerShare } from "@/server/finance/math/settlement";
import {
  computeProfitForOrderRow,
  ORDER_PROFIT_SELECT,
  type OrderProfitRow,
} from "@/server/finance/order-profit-data";

const SETTLED_ORDER_STATUSES = ["CONFIRMED", "PROCESSING", "COMPLETED"] as const;

/**
 * SQL twin of computeOrderProfit's estimation reasons, so the index filter
 * paginates in the database instead of after the fact. Must stay in sync with
 * src/server/finance/math/profit.ts (the integration test asserts this):
 * missing cost snapshot / missing shipping cost / not yet shipped /
 * non-final conversion fee / estimated adjustment. VOIDED conversion batches
 * and canceled shipments are excluded, matching the waterfall.
 */
export const ESTIMATED_ORDER_WHERE: Prisma.OrderWhereInput = {
  OR: [
    { items: { some: { totalCogsUsdMinor: null, compensationEventId: null } } },
    {
      shipments: {
        some: { status: { not: "CANCELED" }, shippingCostMinor: null },
      },
    },
    // No active shipment at all: logistics cost is unknown, not zero.
    { shipments: { none: { status: { not: "CANCELED" } } } },
    {
      conversionEntries: {
        some: {
          batch: {
            OR: [
              { status: "DRAFT" },
              { status: "COMPLETED", actualFeeUsdMinor: null },
            ],
          },
        },
      },
    },
    { financialAdjustments: { some: { isEstimated: true } } },
  ],
};

export type FinanceRange = {
  key: "today" | "week" | "month" | "custom";
  start: Date;
  end: Date;
};

export function resolveFinanceRange(
  searchParams: Record<string, SearchParameter>,
  now = new Date(),
): FinanceRange {
  const key = typeof searchParams.range === "string" ? searchParams.range : "month";
  const from = typeof searchParams.from === "string" ? searchParams.from : "";
  const to = typeof searchParams.to === "string" ? searchParams.to : "";
  const dayStartUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  if (key === "custom" && from && to) {
    const start = new Date(`${from}T00:00:00Z`);
    const endDay = new Date(`${to}T00:00:00Z`);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(endDay.getTime()) && endDay >= start) {
      return { key: "custom", start, end: new Date(endDay.getTime() + 86_400_000) };
    }
  }
  if (key === "today") {
    return { key, start: dayStartUtc, end: new Date(dayStartUtc.getTime() + 86_400_000) };
  }
  if (key === "week") {
    const weekday = (dayStartUtc.getUTCDay() + 6) % 7; // Monday-based
    const start = new Date(dayStartUtc.getTime() - weekday * 86_400_000);
    return { key, start, end: new Date(start.getTime() + 7 * 86_400_000) };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { key: "month", start, end };
}

const DASHBOARD_ORDER_LIMIT = 5_000;

async function loadRangeOrders(range: FinanceRange): Promise<OrderProfitRow[]> {
  return getDb().order.findMany({
    where: {
      status: { in: [...SETTLED_ORDER_STATUSES] },
      confirmedAt: { gte: range.start, lt: range.end },
    },
    select: ORDER_PROFIT_SELECT,
    orderBy: { id: "asc" },
    take: DASHBOARD_ORDER_LIMIT,
  });
}

/**
 * Finance dashboard aggregates. Every number is the sum of per-order
 * breakdowns from the shared assembler — identical to what the order profit
 * page and settlements show, so totals always reconcile with detail.
 */
export async function getFinanceDashboard(
  searchParams: Record<string, SearchParameter>,
) {
  await requirePermission("finance.read", "/admin/finance");
  const range = resolveFinanceRange(searchParams);
  const db = getDb();
  const orders = await loadRangeOrders(range);
  const breakdowns = orders.map((order) => ({
    order,
    profit: computeProfitForOrderRow(order),
  }));

  const sum = (pick: (entry: (typeof breakdowns)[number]) => bigint) =>
    sumSignedMinor(breakdowns.map(pick));

  const revenue = sum((entry) => entry.profit.operatingRevenueUsdMinor);
  const refunds = sum(
    (entry) => entry.profit.refundsUsdMinor + entry.profit.shippingRefundsUsdMinor,
  );
  const netRevenue = sum((entry) => entry.profit.netOperatingRevenueUsdMinor);
  const profit = sum((entry) => entry.profit.finalProfitUsdMinor);

  const partner = await db.partner.findFirst({
    where: { isActive: true },
    orderBy: { effectiveFrom: "desc" },
    select: { name: true, shareBps: true },
  });
  const share = computePartnerShare({
    periodProfitUsdMinor: profit,
    carryoverInUsdMinor: BigInt(0),
    shareBps: partner?.shareBps ?? 5_000,
  });

  const [missingCostOrders, unsettledOrders, pendingSettlements] = await Promise.all([
    db.order.count({
      where: {
        status: { in: [...SETTLED_ORDER_STATUSES] },
        OR: [
          {
            items: {
              some: {
                totalCogsUsdMinor: null,
                compensationEventId: null,
              },
            },
          },
          {
            shipments: {
              some: { status: { not: "CANCELED" }, shippingCostMinor: null },
            },
          },
          { shipments: { none: { status: { not: "CANCELED" } } } },
        ],
      },
    }),
    db.order.count({
      where: {
        status: { in: [...SETTLED_ORDER_STATUSES] },
        profitSettledSettlementId: null,
      },
    }),
    db.partnerSettlement.count({
      where: { status: { in: ["DRAFT", "PENDING_CONFIRMATION"] } },
    }),
  ]);

  const estimatedCount = breakdowns.filter((entry) => entry.profit.isEstimated).length;

  return {
    range: {
      key: range.key,
      start: range.start.toISOString().slice(0, 10),
      endInclusive: new Date(range.end.getTime() - 86_400_000)
        .toISOString()
        .slice(0, 10),
    },
    calcVersion: PROFIT_CALC_VERSION,
    orderCount: orders.length,
    // Totals sum per-order breakdowns; a range with more orders than the
    // scan limit must say so instead of silently undercounting.
    truncated: orders.length === DASHBOARD_ORDER_LIMIT,
    metrics: {
      revenueUsdMinor: revenue.toString(),
      refundsUsdMinor: refunds.toString(),
      shippingRevenueUsdMinor: sum((entry) => entry.profit.shippingRevenueUsdMinor).toString(),
      netRevenueUsdMinor: netRevenue.toString(),
      cogsUsdMinor: sum((entry) => entry.profit.cogsUsdMinor).toString(),
      shippingCostUsdMinor: sum(
        (entry) => entry.profit.shippingCostUsdMinor + entry.profit.packagingCostUsdMinor,
      ).toString(),
      afterSalesUsdMinor: sum((entry) => entry.profit.afterSalesCostUsdMinor).toString(),
      paymentFeesUsdMinor: sum((entry) => entry.profit.paymentFeesUsdMinor).toString(),
      conversionFeesUsdMinor: sum((entry) => entry.profit.conversionFeesUsdMinor).toString(),
      exchangeNetUsdMinor: sum((entry) => entry.profit.exchangeNetUsdMinor).toString(),
      taxCollectedUsdMinor: sum((entry) => entry.profit.taxCollectedUsdMinor).toString(),
      profitUsdMinor: profit.toString(),
      marginBps:
        netRevenue === BigInt(0)
          ? null
          : Number(divideRoundHalfUp(profit * BigInt(10_000), netRevenue)),
      partnerName: partner?.name ?? null,
      partnerShareBps: partner?.shareBps ?? null,
      partnerShareUsdMinor: share.partnerShareUsdMinor.toString(),
      ownerShareUsdMinor: share.ownerShareUsdMinor.toString(),
    },
    health: {
      estimatedOrderCount: estimatedCount,
      finalizedOrderCount: orders.length - estimatedCount,
      missingCostOrders,
      unsettledOrders,
      pendingSettlements,
    },
  };
}

export type FinanceOrderIndexFilters = {
  q: string;
  state: "" | "estimated" | "finalized" | "unsettled" | "settled";
  page: number;
};

export async function getFinanceOrderIndex(
  searchParams: Record<string, SearchParameter>,
) {
  await requirePermission("finance.read", "/admin/finance/orders");
  const state = typeof searchParams.state === "string" ? searchParams.state : "";
  const filters: FinanceOrderIndexFilters = {
    q: normalizeSearchText(searchParams.q),
    state: ["estimated", "finalized", "unsettled", "settled"].includes(state)
      ? (state as FinanceOrderIndexFilters["state"])
      : "",
    page: normalizePageSearchParameter(searchParams.page),
  };

  const conditions: Prisma.OrderWhereInput[] = [
    { status: { in: [...SETTLED_ORDER_STATUSES] } },
  ];
  if (filters.q) {
    conditions.push({
      OR: [
        { orderNumber: { contains: filters.q, mode: "insensitive" } },
        { customerEmail: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }
  if (filters.state === "unsettled") conditions.push({ profitSettledSettlementId: null });
  if (filters.state === "settled") conditions.push({ profitSettledSettlementId: { not: null } });
  if (filters.state === "estimated") conditions.push(ESTIMATED_ORDER_WHERE);
  if (filters.state === "finalized") conditions.push({ NOT: ESTIMATED_ORDER_WHERE });
  const where: Prisma.OrderWhereInput = { AND: conditions };

  const db = getDb();
  const total = await db.order.count({ where });
  const pagination = buildPagination(total, filters.page, 25);
  const orders = await db.order.findMany({
    where,
    select: ORDER_PROFIT_SELECT,
    orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
    skip: pagination.skip,
    take: pagination.pageSize,
  });

  const rows = orders.map((order) => {
    const profit = computeProfitForOrderRow(order);
    return {
      publicId: order.publicId,
      orderNumber: order.orderNumber,
      customerEmail: order.customerEmail,
      confirmedAt: order.confirmedAt?.toISOString() ?? null,
      settled: order.profitSettledSettlementId !== null,
      netRevenueUsdMinor: profit.netOperatingRevenueUsdMinor.toString(),
      cogsUsdMinor: profit.cogsUsdMinor.toString(),
      profitUsdMinor: profit.finalProfitUsdMinor.toString(),
      marginBps: profit.marginBps,
      isEstimated: profit.isEstimated,
    };
  });

  return { filters, pagination, rows };
}

/** Full waterfall + editing context for one order's profit page. */
export async function getFinanceOrderDetail(publicId: string) {
  await requirePermission("finance.read", "/admin/finance/orders");
  const db = getDb();
  const order = await db.order.findFirst({
    where: { publicId },
    select: ORDER_PROFIT_SELECT,
  });
  if (!order) return null;
  const profit = computeProfitForOrderRow(order);
  const partner = await db.partner.findFirst({
    where: { isActive: true },
    orderBy: { effectiveFrom: "desc" },
    select: { name: true, shareBps: true },
  });
  const share = computePartnerShare({
    periodProfitUsdMinor: profit.finalProfitUsdMinor,
    carryoverInUsdMinor: BigInt(0),
    shareBps: partner?.shareBps ?? 5_000,
  });
  const settledIn = order.profitSettledSettlementId
    ? await db.partnerSettlement.findUnique({
        where: { id: order.profitSettledSettlementId },
        select: { publicId: true, settlementNumber: true, status: true },
      })
    : null;

  const items = await db.orderItem.findMany({
    where: { orderId: order.id },
    orderBy: { id: "asc" },
    select: {
      productName: true,
      variantName: true,
      sku: true,
      quantity: true,
      unitPriceMinor: true,
      lineTotalMinor: true,
      unitCostUsdMinor: true,
      totalCogsUsdMinor: true,
      costMethod: true,
      costSnapshotAt: true,
      compensationEventId: true,
      compensationEvent: { select: { publicId: true } },
    },
  });

  return {
    order: {
      publicId: order.publicId,
      orderNumber: order.orderNumber,
      customerEmail: order.customerEmail,
      status: order.status,
      paymentStatus: order.paymentStatus,
      confirmedAt: order.confirmedAt?.toISOString() ?? null,
      settledIn,
    },
    profit: {
      calcVersion: profit.calcVersion,
      merchandiseRevenue: profit.merchandiseRevenueUsdMinor.toString(),
      discount: order.discountMinor.toString(),
      shippingRevenue: profit.shippingRevenueUsdMinor.toString(),
      taxCollected: profit.taxCollectedUsdMinor.toString(),
      refunds: profit.refundsUsdMinor.toString(),
      shippingRefunds: profit.shippingRefundsUsdMinor.toString(),
      netRevenue: profit.netOperatingRevenueUsdMinor.toString(),
      cogs: profit.cogsUsdMinor.toString(),
      shippingCost: profit.shippingCostUsdMinor.toString(),
      packagingCost: profit.packagingCostUsdMinor.toString(),
      paymentFees: profit.paymentFeesUsdMinor.toString(),
      conversionFees: profit.conversionFeesUsdMinor.toString(),
      afterSalesCost: profit.afterSalesCostUsdMinor.toString(),
      otherDirectCost: profit.otherDirectCostUsdMinor.toString(),
      costCorrections: profit.costCorrectionsUsdMinor.toString(),
      exchangeNet: profit.exchangeNetUsdMinor.toString(),
      finalProfit: profit.finalProfitUsdMinor.toString(),
      marginBps: profit.marginBps,
      isEstimated: profit.isEstimated,
      estimationReasons: profit.estimationReasons,
      partnerName: partner?.name ?? null,
      partnerShareBps: partner?.shareBps ?? null,
      partnerShare: share.partnerShareUsdMinor.toString(),
      ownerShare: share.ownerShareUsdMinor.toString(),
    },
    items: items.map((item) => ({
      label: `${item.productName}${item.variantName ? ` · ${item.variantName}` : ""}${item.sku ? ` (${item.sku})` : ""}`,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor.toString(),
      lineTotalMinor: item.lineTotalMinor.toString(),
      unitCostUsdMinor: item.unitCostUsdMinor?.toString() ?? null,
      totalCogsUsdMinor: item.totalCogsUsdMinor?.toString() ?? null,
      costMethod: item.costMethod,
      costSnapshotAt: item.costSnapshotAt?.toISOString() ?? null,
      isCompensation: item.compensationEventId !== null,
      compensationEventPublicId: item.compensationEvent?.publicId ?? null,
    })),
    shipments: order.shipments.map((shipment) => ({
      publicId: shipment.publicId,
      shipmentNumber: shipment.shipmentNumber,
      status: shipment.status,
      shippingCostMinor: shipment.shippingCostMinor?.toString() ?? null,
      packagingCostMinor: shipment.packagingCostMinor?.toString() ?? null,
    })),
    conversionEntries: order.conversionEntries.map((entry) => ({
      batchNumber: entry.batch.batchNumber,
      batchStatus: entry.batch.status,
      allocatedFeeUsdMinor: entry.allocatedFeeUsdMinor.toString(),
      allocatedChainFeeUsdMinor: entry.allocatedChainFeeUsdMinor.toString(),
      feeIsEstimated:
        entry.batch.status !== "COMPLETED" || entry.batch.actualFeeUsdMinor === null,
    })),
    adjustments: [...order.financialAdjustments]
      .sort((left, right) => left.effectiveAt.getTime() - right.effectiveAt.getTime())
      .map((adjustment) => ({
        publicId: adjustment.publicId,
        type: adjustment.type,
        signedUsdMinor: adjustment.signedUsdMinor.toString(),
        isEstimated: adjustment.isEstimated,
        effectiveAt: adjustment.effectiveAt.toISOString(),
        reason: adjustment.reason,
        settled: adjustment.settledInSettlementId !== null,
      })),
  };
}

/** Product/SKU profitability over a range, from the same snapshots. */
export async function getProductProfitReport(
  searchParams: Record<string, SearchParameter>,
) {
  await requirePermission("finance.read", "/admin/finance/products");
  const range = resolveFinanceRange(searchParams);
  const db = getDb();

  const items = await db.orderItem.findMany({
    where: {
      order: {
        status: { in: [...SETTLED_ORDER_STATUSES] },
        confirmedAt: { gte: range.start, lt: range.end },
      },
    },
    select: {
      quantity: true,
      unitPriceMinor: true,
      lineTotalMinor: true,
      taxMinor: true,
      totalCogsUsdMinor: true,
      compensationEventId: true,
      variantId: true,
      productName: true,
      variantName: true,
      sku: true,
      orderId: true,
    },
    take: 20_000,
  });

  const refundByOrder = new Map<bigint, bigint>();
  const orderIds = [...new Set(items.map((item) => item.orderId))];
  if (orderIds.length > 0) {
    const refunds = await db.financialAdjustment.findMany({
      where: { orderId: { in: orderIds }, type: "REFUND" },
      select: { orderId: true, signedUsdMinor: true },
    });
    for (const refund of refunds) {
      if (refund.orderId === null) continue;
      refundByOrder.set(
        refund.orderId,
        (refundByOrder.get(refund.orderId) ?? BigInt(0)) - refund.signedUsdMinor,
      );
    }
  }

  const afterSalesByVariant = new Map<string, { returned: number; gifted: number; cost: bigint }>();
  const afterSalesItems = await db.afterSalesItem.findMany({
    where: {
      event: { status: "COMPLETED", completedAt: { gte: range.start, lt: range.end } },
    },
    select: {
      kind: true,
      quantity: true,
      totalCostUsdMinor: true,
      variant: { select: { publicId: true } },
    },
  });
  for (const item of afterSalesItems) {
    const key = item.variant.publicId;
    const entry = afterSalesByVariant.get(key) ?? { returned: 0, gifted: 0, cost: BigInt(0) };
    if (item.kind === "RETURN") entry.returned += item.quantity;
    else entry.gifted += item.quantity;
    entry.cost += item.totalCostUsdMinor ?? BigInt(0);
    afterSalesByVariant.set(key, entry);
  }

  type Row = {
    key: string;
    label: string;
    sku: string;
    soldQuantity: number;
    giftQuantity: number;
    revenueUsdMinor: bigint;
    cogsUsdMinor: bigint;
    missingSnapshots: number;
    variantPublicId: string | null;
  };
  const rows = new Map<string, Row>();
  const variantPublicIds = new Map<bigint, string>();
  const variants = await db.productVariant.findMany({
    where: { id: { in: [...new Set(items.map((i) => i.variantId).filter((v): v is bigint => v !== null))] } },
    select: { id: true, publicId: true },
  });
  for (const variant of variants) variantPublicIds.set(variant.id, variant.publicId);

  for (const item of items) {
    const key = item.sku ?? `${item.productName}·${item.variantName ?? ""}`;
    const row =
      rows.get(key) ??
      ({
        key,
        label: `${item.productName}${item.variantName ? ` · ${item.variantName}` : ""}`,
        sku: item.sku ?? "",
        soldQuantity: 0,
        giftQuantity: 0,
        revenueUsdMinor: BigInt(0),
        cogsUsdMinor: BigInt(0),
        missingSnapshots: 0,
        variantPublicId: item.variantId ? (variantPublicIds.get(item.variantId) ?? null) : null,
      } satisfies Row);
    if (item.compensationEventId !== null) {
      row.giftQuantity += item.quantity;
    } else {
      row.soldQuantity += item.quantity;
      row.revenueUsdMinor += item.lineTotalMinor - item.taxMinor;
      if (item.totalCogsUsdMinor !== null) row.cogsUsdMinor += item.totalCogsUsdMinor;
      else row.missingSnapshots += 1;
    }
    rows.set(key, row);
  }

  // Average CNY procurement cost per variant (latest received orders).
  const procurement = await db.procurementOrderItem.findMany({
    where: {
      procurementOrder: { status: "RECEIVED" },
      variantId: { in: [...variantPublicIds.keys()] },
    },
    select: { variantId: true, quantity: true, totalMinor: true, totalUsdMinor: true },
  });
  const cnyByVariant = new Map<bigint, { qty: number; cny: bigint; usd: bigint }>();
  for (const line of procurement) {
    const entry = cnyByVariant.get(line.variantId) ?? { qty: 0, cny: BigInt(0), usd: BigInt(0) };
    entry.qty += line.quantity;
    entry.cny += line.totalMinor;
    entry.usd += line.totalUsdMinor ?? BigInt(0);
    cnyByVariant.set(line.variantId, entry);
  }

  const report = [...rows.values()]
    .map((row) => {
      const variantId = [...variantPublicIds.entries()].find(
        ([, publicId]) => publicId === row.variantPublicId,
      )?.[0];
      const procurementEntry = variantId ? cnyByVariant.get(variantId) : undefined;
      const afterSales = row.variantPublicId
        ? afterSalesByVariant.get(row.variantPublicId)
        : undefined;
      const grossProfit = row.revenueUsdMinor - row.cogsUsdMinor - (afterSales?.cost ?? BigInt(0));
      return {
        label: row.label,
        sku: row.sku,
        soldQuantity: row.soldQuantity,
        returnedQuantity: afterSales?.returned ?? 0,
        giftQuantity: row.giftQuantity + (afterSales?.gifted ?? 0),
        averageSellUsdMinor:
          row.soldQuantity > 0
            ? divideRoundHalfUp(row.revenueUsdMinor, BigInt(row.soldQuantity)).toString()
            : null,
        averageCnyCostMinor:
          procurementEntry && procurementEntry.qty > 0
            ? divideRoundHalfUp(procurementEntry.cny, BigInt(procurementEntry.qty)).toString()
            : null,
        averageUsdCostMinor:
          procurementEntry && procurementEntry.qty > 0
            ? divideRoundHalfUp(procurementEntry.usd, BigInt(procurementEntry.qty)).toString()
            : null,
        revenueUsdMinor: row.revenueUsdMinor.toString(),
        cogsUsdMinor: row.cogsUsdMinor.toString(),
        afterSalesCostUsdMinor: (afterSales?.cost ?? BigInt(0)).toString(),
        grossProfitUsdMinor: grossProfit.toString(),
        marginBps:
          row.revenueUsdMinor === BigInt(0)
            ? null
            : Number(divideRoundHalfUp(grossProfit * BigInt(10_000), row.revenueUsdMinor)),
        isEstimated: row.missingSnapshots > 0,
      };
    })
    .sort((left, right) => (BigInt(right.revenueUsdMinor) < BigInt(left.revenueUsdMinor) ? -1 : 1));

  return {
    range: {
      key: range.key,
      start: range.start.toISOString().slice(0, 10),
      endInclusive: new Date(range.end.getTime() - 86_400_000).toISOString().slice(0, 10),
    },
    rows: report,
  };
}
