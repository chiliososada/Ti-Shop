import { serializeCatalogCsv } from "@/server/admin/catalog/csv";
import {
  CONVERSION_CSV_COLUMNS,
  getConversionExportRows,
} from "@/server/admin/finance/conversions/queries";

export async function GET() {
  const rows = await getConversionExportRows();
  return new Response(serializeCatalogCsv(rows, CONVERSION_CSV_COLUMNS), {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": 'attachment; filename="crypto-conversions.csv"',
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
