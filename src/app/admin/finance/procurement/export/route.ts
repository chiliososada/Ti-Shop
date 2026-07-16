import {
  serializeCatalogCsv,
} from "@/server/admin/catalog/csv";
import {
  getProcurementExportRows,
  PROCUREMENT_CSV_COLUMNS,
} from "@/server/admin/finance/procurement/queries";

export async function GET() {
  // Permission (finance.export) is enforced inside the query.
  const rows = await getProcurementExportRows();
  const body = serializeCatalogCsv(rows, PROCUREMENT_CSV_COLUMNS);

  return new Response(body, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": 'attachment; filename="procurement-costs.csv"',
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
