import { serializeCatalogCsv } from "@/server/admin/catalog/csv";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import {
  computeProfitForOrderRow,
  ORDER_PROFIT_SELECT,
} from "@/server/finance/order-profit-data";

const COLUMNS = [
  "orderNumber",
  "customerEmail",
  "confirmedAt",
  "currency",
  "merchandiseRevenueUsd",
  "shippingRevenueUsd",
  "taxCollectedUsd",
  "refundsUsd",
  "netRevenueUsd",
  "cogsUsd",
  "shippingCostUsd",
  "packagingUsd",
  "paymentFeesUsd",
  "conversionFeesUsd",
  "afterSalesUsd",
  "otherCostsUsd",
  "costCorrectionsUsd",
  "exchangeNetUsd",
  "finalProfitUsd",
  "marginBps",
  "calcVersion",
  "state",
  "settled",
] as const;

function usd(minor: bigint): string {
  const negative = minor < BigInt(0);
  const abs = (negative ? -minor : minor).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

export async function GET() {
  await requirePermission("finance.export", "/admin/finance/orders");
  const orders = await getDb().order.findMany({
    where: { status: { in: ["CONFIRMED", "PROCESSING", "COMPLETED"] } },
    select: ORDER_PROFIT_SELECT,
    orderBy: { id: "asc" },
    take: 10_000,
  });
  const rows = orders.map((order) => {
    const profit = computeProfitForOrderRow(order);
    return {
      orderNumber: order.orderNumber,
      customerEmail: order.customerEmail,
      confirmedAt: order.confirmedAt?.toISOString() ?? "",
      currency: order.currency,
      merchandiseRevenueUsd: usd(profit.merchandiseRevenueUsdMinor),
      shippingRevenueUsd: usd(profit.shippingRevenueUsdMinor),
      taxCollectedUsd: usd(profit.taxCollectedUsdMinor),
      refundsUsd: usd(profit.refundsUsdMinor + profit.shippingRefundsUsdMinor),
      netRevenueUsd: usd(profit.netOperatingRevenueUsdMinor),
      cogsUsd: usd(profit.cogsUsdMinor),
      shippingCostUsd: usd(profit.shippingCostUsdMinor),
      packagingUsd: usd(profit.packagingCostUsdMinor),
      paymentFeesUsd: usd(profit.paymentFeesUsdMinor),
      conversionFeesUsd: usd(profit.conversionFeesUsdMinor),
      afterSalesUsd: usd(profit.afterSalesCostUsdMinor),
      otherCostsUsd: usd(profit.otherDirectCostUsdMinor),
      costCorrectionsUsd: usd(profit.costCorrectionsUsdMinor),
      exchangeNetUsd: usd(profit.exchangeNetUsdMinor),
      finalProfitUsd: usd(profit.finalProfitUsdMinor),
      marginBps: profit.marginBps === null ? "" : String(profit.marginBps),
      calcVersion: String(profit.calcVersion),
      state: profit.isEstimated ? "Estimated" : "Finalized",
      settled: order.profitSettledSettlementId === null ? "no" : "yes",
    };
  });
  return new Response(serializeCatalogCsv(rows, COLUMNS), {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": 'attachment; filename="order-profit.csv"',
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
