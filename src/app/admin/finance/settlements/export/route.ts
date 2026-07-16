import { serializeCatalogCsv } from "@/server/admin/catalog/csv";
import {
  getSettlementExportRows,
  SETTLEMENT_CSV_COLUMNS,
} from "@/server/admin/finance/settlements/queries";

export async function GET() {
  const rows = await getSettlementExportRows();
  return new Response(serializeCatalogCsv(rows, SETTLEMENT_CSV_COLUMNS), {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": 'attachment; filename="partner-settlements.csv"',
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
