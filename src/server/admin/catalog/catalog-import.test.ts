import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CATALOG_IMPORT_MAX_ROWS,
  parseCatalogImportCsv,
  parseRfc4180Csv,
} from "@/server/admin/catalog/catalog-import";
import {
  CATALOG_CSV_COLUMNS,
  serializeCatalogCsv,
} from "@/server/admin/catalog/csv";

function validRow(overrides: Record<string, string> = {}) {
  return {
    productPublicId: randomUUID(),
    productSlug: "catalog-import-product",
    productTitle: "Catalog import product",
    productStatus: "ACTIVE",
    productPublishedAt: "2026-07-13T12:00:00.000Z",
    primaryCategorySlug: "research",
    categorySlugs: "research|featured",
    variantPublicId: randomUUID(),
    variantTitle: "Five pack, quoted \"edition\"",
    sku: "IMPORT-5",
    variantStatus: "ACTIVE",
    variantPublishedAt: "2026-07-13T12:00:00.000Z",
    priceMode: "FIXED",
    usdPrice: "12.34",
    minimumOrderQuantity: "2",
    trackInventory: "true",
    position: "4",
    optionValues: '{"size":"5 pack","limited":false}',
    ...overrides,
  };
}

function csv(rows: Array<Record<string, string>>) {
  return serializeCatalogCsv(rows, CATALOG_CSV_COLUMNS);
}

describe("catalog CSV import parsing", () => {
  it("round-trips the exact quoted export format into validated domain values", () => {
    const parsed = parseCatalogImportCsv(csv([validRow()]));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.document).toMatchObject({
      rowCount: 1,
      variantCount: 1,
      categoryAssignmentCount: 2,
      products: [
        {
          slug: "catalog-import-product",
          title: "Catalog import product",
          status: "ACTIVE",
          categorySlugs: ["research", "featured"],
          variants: [
            {
              title: 'Five pack, quoted "edition"',
              sku: "IMPORT-5",
              status: "ACTIVE",
              priceMode: "FIXED",
              amountMinor: BigInt(1_234),
              minimumOrderQuantity: 2,
              trackInventory: true,
              position: 4,
              optionValues: {
                size: "5 pack",
                limited: false,
                minimumOrderQuantity: 2,
              },
            },
          ],
        },
      ],
    });
  });

  it("implements strict RFC 4180 quoting and CRLF boundaries", () => {
    expect(parseRfc4180Csv('"a","b"\r\n"x","y"\r\n')).toEqual({
      success: true,
      rows: [["a", "b"], ["x", "y"]],
    });
    expect(parseRfc4180Csv('"a","b"\n"x","y"')).toMatchObject({
      success: false,
      issue: { message: "CSV records must use CRLF line endings." },
    });
    expect(parseRfc4180Csv('"a","unterminated')).toMatchObject({
      success: false,
      issue: { message: "The CSV ended inside a quoted field." },
    });
    expect(parseRfc4180Csv('"a"tail,"b"')).toMatchObject({
      success: false,
      issue: {
        message: "A quoted field must be followed by a comma, CRLF, or end of file.",
      },
    });
  });

  it("rejects non-exact or duplicate headers", () => {
    const row = validRow();
    const duplicate = serializeCatalogCsv(
      [row],
      CATALOG_CSV_COLUMNS.map((column, index) => index === 1 ? "productPublicId" : column),
    );
    expect(parseCatalogImportCsv(duplicate)).toMatchObject({
      success: false,
      issues: [{ message: "The CSV header contains duplicate columns." }],
    });

    const reordered = serializeCatalogCsv(
      [row],
      [CATALOG_CSV_COLUMNS[1], CATALOG_CSV_COLUMNS[0], ...CATALOG_CSV_COLUMNS.slice(2)],
    );
    expect(parseCatalogImportCsv(reordered)).toMatchObject({
      success: false,
      issues: [{ message: expect.stringContaining("exactly match") }],
    });
  });

  it("rejects formula-like cells, spreadsheet escaping, and control characters", () => {
    for (const productTitle of [
      "=1+1",
      "  +SUM(A1)",
      "'=cmd",
      "safe\u0000title",
      "zero\u200Bwidth",
    ]) {
      const parsed = parseCatalogImportCsv(csv([validRow({ productTitle })]));
      expect(parsed).toMatchObject({ success: false });
    }
  });

  it("rejects inconsistent product rows and duplicate variant IDs or SKUs", () => {
    const productPublicId = randomUUID();
    const variantPublicId = randomUUID();
    const inconsistent = parseCatalogImportCsv(csv([
      validRow({ productPublicId, variantPublicId }),
      validRow({
        productPublicId,
        variantPublicId: randomUUID(),
        productTitle: "Changed only on the second row",
        sku: "IMPORT-6",
      }),
    ]));
    expect(inconsistent).toMatchObject({
      success: false,
      issues: [{ row: 3, message: expect.stringContaining("inconsistent") }],
    });

    const duplicateVariant = parseCatalogImportCsv(csv([
      validRow({ productPublicId, variantPublicId }),
      validRow({ productPublicId, variantPublicId }),
    ]));
    expect(duplicateVariant).toMatchObject({
      success: false,
      issues: [{ row: 3, column: "variantPublicId" }],
    });

    const duplicateSku = parseCatalogImportCsv(csv([
      validRow({ productPublicId, variantPublicId, sku: "SAME-SKU" }),
      validRow({ productPublicId, variantPublicId: randomUUID(), sku: "SAME-SKU" }),
    ]));
    expect(duplicateSku).toMatchObject({
      success: false,
      issues: [{ row: 3, column: "sku" }],
    });
  });

  it("accepts a truly variantless export row but rejects mixed variant columns", () => {
    const emptyVariant = Object.fromEntries(
      CATALOG_CSV_COLUMNS.map((column) => [column, ""]),
    ) as Record<string, string>;
    const base = validRow();
    for (const column of CATALOG_CSV_COLUMNS.slice(7)) emptyVariant[column] = "";
    Object.assign(emptyVariant, {
      productPublicId: base.productPublicId,
      productSlug: base.productSlug,
      productTitle: base.productTitle,
      productStatus: "DRAFT",
      productPublishedAt: "",
      primaryCategorySlug: base.primaryCategorySlug,
      categorySlugs: base.categorySlugs,
    });
    expect(parseCatalogImportCsv(csv([emptyVariant]))).toMatchObject({
      success: true,
      document: { variantCount: 0 },
    });
    expect(
      parseCatalogImportCsv(csv([{ ...emptyVariant, variantTitle: "orphan" }])),
    ).toMatchObject({
      success: false,
      issues: [{ row: 2, column: "variantTitle" }],
    });
  });

  it("enforces the 1,000-row boundary before building an import plan", () => {
    const row = validRow({
      productStatus: "DRAFT",
      productPublishedAt: "",
      variantPublicId: "",
      variantTitle: "",
      sku: "",
      variantStatus: "",
      variantPublishedAt: "",
      priceMode: "",
      usdPrice: "",
      minimumOrderQuantity: "",
      trackInventory: "",
      position: "",
      optionValues: "",
      primaryCategorySlug: "",
      categorySlugs: "",
    });
    const source = csv(Array.from({ length: CATALOG_IMPORT_MAX_ROWS + 1 }, () => row));
    expect(parseCatalogImportCsv(source)).toMatchObject({
      success: false,
      issues: [{ message: expect.stringContaining("1,000-row") }],
    });
  });
});
