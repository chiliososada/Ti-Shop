const FORMULA_PREFIX = /^[\t\r ]*[=+\-@]/u;

export const CATALOG_CSV_COLUMNS = [
  "productPublicId",
  "productSlug",
  "productTitle",
  "productStatus",
  "productPublishedAt",
  "primaryCategorySlug",
  "categorySlugs",
  "variantPublicId",
  "variantTitle",
  "sku",
  "variantStatus",
  "variantPublishedAt",
  "priceMode",
  "usdPrice",
  "minimumOrderQuantity",
  "trackInventory",
  "position",
  "optionValues",
] as const;

export function protectSpreadsheetCell(value: string) {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function escapeCsvCell(value: string) {
  const protectedValue = protectSpreadsheetCell(value);
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

export function serializeCatalogCsv(
  rows: readonly Record<string, string>[],
  columns: readonly string[],
) {
  const lines = [columns.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvCell(row[column] ?? "")).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
