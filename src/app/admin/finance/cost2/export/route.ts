import { serializeCatalogCsv } from "@/server/admin/catalog/csv";
import { getCost2CatalogReport } from "@/server/admin/finance/reports/cost2-queries";
import { requirePermission } from "@/server/auth/rbac";

const COLUMNS = [
  "product",
  "sku",
  "sellingPriceUsd",
  "cost1Cny",
  "cost1Usd",
  "cost2Usd",
  "partnerShareUsd",
  "ownerShareUsd",
  "fxRateCnyPerUsd",
  "fxDate",
  "source",
  "state",
] as const;

function money(minor: string | null): string {
  if (minor === null) return "";
  const value = BigInt(minor);
  const negative = value < BigInt(0);
  const abs = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

export async function GET() {
  await requirePermission("finance.export", "/admin/finance/cost2");
  const report = await getCost2CatalogReport();
  const rows = report.rows.map((row) => ({
    product: row.product,
    sku: row.sku,
    sellingPriceUsd: money(row.sellUsdMinor),
    cost1Cny: money(row.cost1CnyMinor),
    cost1Usd: money(row.cost1UsdMinor),
    cost2Usd: money(row.cost2UsdMinor),
    partnerShareUsd: money(row.partnerShareUsdMinor),
    ownerShareUsd: money(row.ownerShareUsdMinor),
    fxRateCnyPerUsd: row.fxRateCnyPerUsd ?? "",
    fxDate: row.fxDate ?? "",
    source: row.source ?? "",
    state: row.state,
  }));

  return new Response(serializeCatalogCsv(rows, COLUMNS), {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": 'attachment; filename="product-cost2.csv"',
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
