import { describe, expect, it } from "vitest";

import {
  escapeCsvCell,
  protectSpreadsheetCell,
  serializeCatalogCsv,
} from "@/server/admin/catalog/csv";

describe("catalog CSV export", () => {
  it("neutralizes spreadsheet formulas including whitespace-prefixed values", () => {
    expect(protectSpreadsheetCell("=1+1")).toBe("'=1+1");
    expect(protectSpreadsheetCell("  @SUM(A1:A2)")).toBe("'  @SUM(A1:A2)");
    expect(protectSpreadsheetCell("safe-value")).toBe("safe-value");
  });

  it("quotes commas, newlines, and double quotes", () => {
    expect(escapeCsvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });

  it("uses a stable column order and UTF-8 BOM", () => {
    expect(serializeCatalogCsv([{ b: "2", a: "1" }], ["a", "b"])).toBe(
      '\uFEFF"a","b"\r\n"1","2"\r\n',
    );
  });
});
