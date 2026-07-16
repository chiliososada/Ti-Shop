import {
  CATALOG_CSV_COLUMNS,
  serializeCatalogCsv,
} from "@/server/admin/catalog/csv";
import { getAdminCatalogExportRows } from "@/server/admin/catalog/queries";

export async function GET() {
  const rows = await getAdminCatalogExportRows();
  const body = serializeCatalogCsv(rows, CATALOG_CSV_COLUMNS);
  return new Response(body, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": 'attachment; filename="catalog-export.csv"',
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
