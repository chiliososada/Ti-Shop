import { serializeCatalogCsv } from "@/server/admin/catalog/csv";
import {
  AFTER_SALES_CSV_COLUMNS,
  getAfterSalesExportRows,
} from "@/server/admin/finance/after-sales/queries";

export async function GET() {
  // Permission (finance.export) is enforced inside the query.
  const rows = await getAfterSalesExportRows();
  const body = serializeCatalogCsv(rows, AFTER_SALES_CSV_COLUMNS);

  return new Response(body, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": 'attachment; filename="after-sales-costs.csv"',
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
