import type { NextRequest } from "next/server";

import { serializeCatalogCsv } from "@/server/admin/catalog/csv";
import { getProductProfitReport } from "@/server/admin/finance/reports/queries";
import { requirePermission } from "@/server/auth/rbac";

const COLUMNS = [
  "product",
  "sku",
  "soldQuantity",
  "returnedQuantity",
  "giftQuantity",
  "averageSellUsd",
  "averageCostCny",
  "averageCostUsd",
  "revenueUsd",
  "cogsUsd",
  "afterSalesUsd",
  "grossProfitUsd",
  "marginBps",
  "state",
] as const;

function money(minor: string | null): string {
  if (minor === null) return "";
  const value = BigInt(minor);
  const negative = value < BigInt(0);
  const abs = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

export async function GET(request: NextRequest) {
  await requirePermission("finance.export", "/admin/finance/products");
  const report = await getProductProfitReport(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );
  const rows = report.rows.map((row) => ({
    product: row.label,
    sku: row.sku,
    soldQuantity: String(row.soldQuantity),
    returnedQuantity: String(row.returnedQuantity),
    giftQuantity: String(row.giftQuantity),
    averageSellUsd: money(row.averageSellUsdMinor),
    averageCostCny: money(row.averageCnyCostMinor),
    averageCostUsd: money(row.averageUsdCostMinor),
    revenueUsd: money(row.revenueUsdMinor),
    cogsUsd: money(row.cogsUsdMinor),
    afterSalesUsd: money(row.afterSalesCostUsdMinor),
    grossProfitUsd: money(row.grossProfitUsdMinor),
    marginBps: row.marginBps === null ? "" : String(row.marginBps),
    state: row.isEstimated ? "Estimated" : "Finalized",
  }));
  return new Response(serializeCatalogCsv(rows, COLUMNS), {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": 'attachment; filename="product-profit.csv"',
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
