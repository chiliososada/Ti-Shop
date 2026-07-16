import { z } from "zod";

import { publishedAtSchema, publicIdSchema } from "@/server/admin/audit/validation";
import {
  CATALOG_IMPORT_MAX_CATEGORY_ASSIGNMENTS,
  CATALOG_IMPORT_MAX_ROWS,
} from "@/server/admin/catalog/catalog-import-constants";
import { CATALOG_CSV_COLUMNS } from "@/server/admin/catalog/csv";
import { variantFormSchema } from "@/server/admin/catalog/validators";

export {
  CATALOG_IMPORT_CONFIRMATION,
  CATALOG_IMPORT_MAX_BYTES,
  CATALOG_IMPORT_MAX_CATEGORY_ASSIGNMENTS,
  CATALOG_IMPORT_MAX_ROWS,
} from "@/server/admin/catalog/catalog-import-constants";

const MAX_ISSUES = 20;
const CONTROL_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const FORMULA_LIKE = /^[\p{White_Space}]*'?[\p{White_Space}]*[=+\-@]/u;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CATALOG_STATUS = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
const TRIMMED_VARIANT_COLUMNS = [
  "variantTitle",
  "sku",
  "variantPublishedAt",
  "usdPrice",
  "minimumOrderQuantity",
  "position",
] as const;

export type CatalogImportIssue = {
  row: number | null;
  column: string | null;
  message: string;
};

export type CatalogImportVariant = {
  row: number;
  publicId: string;
  title: string;
  sku: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  publishedAt: Date | null;
  priceMode: "FIXED" | "ON_REQUEST";
  amountMinor: bigint | null;
  minimumOrderQuantity: number;
  trackInventory: boolean;
  position: number;
  optionValues: Record<string, string | number | boolean | null>;
};

export type CatalogImportProduct = {
  row: number;
  publicId: string;
  slug: string;
  title: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  publishedAt: Date | null;
  primaryCategorySlug: string | null;
  categorySlugs: string[];
  variants: CatalogImportVariant[];
  hasVariantlessRow: boolean;
};

export type CatalogImportDocument = {
  rowCount: number;
  products: CatalogImportProduct[];
  variantCount: number;
  categoryAssignmentCount: number;
};

type ParseResult =
  | { success: true; document: CatalogImportDocument }
  | { success: false; issues: CatalogImportIssue[] };

type CsvParseResult =
  | { success: true; rows: string[][] }
  | { success: false; issue: CatalogImportIssue };

function structuralIssue(message: string, row: number | null = null): CsvParseResult {
  return {
    success: false,
    issue: { row, column: null, message },
  };
}

/**
 * Parses the RFC 4180 grammar used by the matching export route. Record
 * separators must be CRLF; quoted fields may contain delimiters and escaped
 * double quotes. Cell-level controls, including embedded newlines, are
 * rejected separately before domain validation.
 */
export function parseRfc4180Csv(input: string): CsvParseResult {
  const value = input.startsWith("\uFEFF") ? input.slice(1) : input;
  if (!value.length) return structuralIssue("The CSV file is empty.");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let quoteClosed = false;
  let fieldStarted = false;
  let rowNumber = 1;

  const pushField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
    quoteClosed = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    rowNumber += 1;
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quoted) {
      if (character === '"') {
        if (value[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (quoteClosed) {
      if (character === ",") {
        pushField();
        continue;
      }
      if (character === "\r" && value[index + 1] === "\n") {
        pushRow();
        index += 1;
        continue;
      }
      if (character === "\r" || character === "\n") {
        return structuralIssue("CSV records must use CRLF line endings.", rowNumber);
      }
      return structuralIssue(
        "A quoted field must be followed by a comma, CRLF, or end of file.",
        rowNumber,
      );
    }

    if (character === '"') {
      if (fieldStarted) {
        return structuralIssue(
          "A double quote appeared inside an unquoted field.",
          rowNumber,
        );
      }
      quoted = true;
      fieldStarted = true;
      continue;
    }
    if (character === ",") {
      pushField();
      continue;
    }
    if (character === "\r") {
      if (value[index + 1] !== "\n") {
        return structuralIssue("CSV records must use CRLF line endings.", rowNumber);
      }
      pushRow();
      index += 1;
      continue;
    }
    if (character === "\n") {
      return structuralIssue("CSV records must use CRLF line endings.", rowNumber);
    }
    field += character;
    fieldStarted = true;
  }

  if (quoted) {
    return structuralIssue("The CSV ended inside a quoted field.", rowNumber);
  }
  if (row.length || field.length || fieldStarted || quoteClosed) pushRow();
  if (!rows.length) return structuralIssue("The CSV file is empty.");
  return { success: true, rows };
}

function addIssue(
  issues: CatalogImportIssue[],
  issue: CatalogImportIssue,
) {
  if (issues.length < MAX_ISSUES) issues.push(issue);
}

function issueForZod(
  issues: CatalogImportIssue[],
  row: number,
  column: string,
  error: z.ZodError,
) {
  addIssue(issues, {
    row,
    column,
    message: error.issues[0]?.message ?? "The value is invalid.",
  });
}

function sameDate(left: Date | null, right: Date | null) {
  return left?.getTime() === right?.getTime();
}

function sameProductFields(
  left: CatalogImportProduct,
  right: Omit<CatalogImportProduct, "variants" | "hasVariantlessRow">,
) {
  return (
    left.slug === right.slug &&
    left.title === right.title &&
    left.status === right.status &&
    sameDate(left.publishedAt, right.publishedAt) &&
    left.primaryCategorySlug === right.primaryCategorySlug &&
    left.categorySlugs.length === right.categorySlugs.length &&
    left.categorySlugs.every((slug, index) => slug === right.categorySlugs[index])
  );
}

function parseCategorySlugs(
  value: string,
  primary: string,
  row: number,
  issues: CatalogImportIssue[],
) {
  const slugs = value.length ? value.split("|") : [];
  if (slugs.length > 200) {
    addIssue(issues, {
      row,
      column: "categorySlugs",
      message: "A product may reference at most 200 categories.",
    });
    return null;
  }
  const unique = new Set(slugs);
  const invalid = slugs.find(
    (slug) => slug.length > 180 || !SLUG_PATTERN.test(slug),
  );
  if (invalid !== undefined) {
    addIssue(issues, {
      row,
      column: "categorySlugs",
      message: "Category slugs must be lowercase slug values separated by |.",
    });
    return null;
  }
  if (unique.size !== slugs.length) {
    addIssue(issues, {
      row,
      column: "categorySlugs",
      message: "A category slug was listed more than once.",
    });
    return null;
  }
  if (!slugs.length && primary.length) {
    addIssue(issues, {
      row,
      column: "primaryCategorySlug",
      message: "The primary category must be empty when categorySlugs is empty.",
    });
    return null;
  }
  if (slugs.length && primary !== slugs[0]) {
    addIssue(issues, {
      row,
      column: "primaryCategorySlug",
      message: "The primary category must equal the first categorySlugs value.",
    });
    return null;
  }
  return slugs;
}

export function parseCatalogImportCsv(input: string): ParseResult {
  const parsedCsv = parseRfc4180Csv(input);
  if (!parsedCsv.success) return { success: false, issues: [parsedCsv.issue] };

  const [header, ...dataRows] = parsedCsv.rows;
  const duplicateHeaders = header.filter(
    (column, index) => header.indexOf(column) !== index,
  );
  if (duplicateHeaders.length) {
    return {
      success: false,
      issues: [{ row: 1, column: null, message: "The CSV header contains duplicate columns." }],
    };
  }
  if (
    header.length !== CATALOG_CSV_COLUMNS.length ||
    !CATALOG_CSV_COLUMNS.every((column, index) => header[index] === column)
  ) {
    return {
      success: false,
      issues: [{
        row: 1,
        column: null,
        message: "The CSV header must exactly match the current catalog export columns and order.",
      }],
    };
  }
  if (!dataRows.length) {
    return {
      success: false,
      issues: [{ row: null, column: null, message: "The CSV contains no catalog rows." }],
    };
  }
  if (dataRows.length > CATALOG_IMPORT_MAX_ROWS) {
    return {
      success: false,
      issues: [{
        row: null,
        column: null,
        message: `The CSV exceeds the ${CATALOG_IMPORT_MAX_ROWS.toLocaleString("en-US")}-row import limit.`,
      }],
    };
  }

  const issues: CatalogImportIssue[] = [];
  const products = new Map<string, CatalogImportProduct>();
  const productBySlug = new Map<string, string>();
  const variantIds = new Set<string>();
  const desiredSkus = new Set<string>();
  let categoryAssignmentCount = 0;

  for (let index = 0; index < dataRows.length; index += 1) {
    const cells = dataRows[index];
    const rowNumber = index + 2;
    if (cells.length !== CATALOG_CSV_COLUMNS.length) {
      addIssue(issues, {
        row: rowNumber,
        column: null,
        message: `Expected ${CATALOG_CSV_COLUMNS.length} columns but found ${cells.length}.`,
      });
      continue;
    }
    if (cells.every((cell) => cell.length === 0)) {
      addIssue(issues, {
        row: rowNumber,
        column: null,
        message: "Blank catalog rows are not allowed.",
      });
      continue;
    }

    let unsafeCell = false;
    for (let columnIndex = 0; columnIndex < cells.length; columnIndex += 1) {
      const cell = cells[columnIndex];
      if (CONTROL_CHARACTER.test(cell)) {
        addIssue(issues, {
          row: rowNumber,
          column: CATALOG_CSV_COLUMNS[columnIndex],
          message: "Control characters are not allowed in imported cells.",
        });
        unsafeCell = true;
        break;
      }
      if (FORMULA_LIKE.test(cell)) {
        addIssue(issues, {
          row: rowNumber,
          column: CATALOG_CSV_COLUMNS[columnIndex],
          message: "Spreadsheet formula-like values are not allowed.",
        });
        unsafeCell = true;
        break;
      }
    }
    if (unsafeCell) continue;

    const row = Object.fromEntries(
      CATALOG_CSV_COLUMNS.map((column, columnIndex) => [column, cells[columnIndex]]),
    ) as Record<(typeof CATALOG_CSV_COLUMNS)[number], string>;

    const productId = publicIdSchema.safeParse(row.productPublicId);
    if (!productId.success) {
      issueForZod(issues, rowNumber, "productPublicId", productId.error);
      continue;
    }
    if (
      row.productSlug.length > 220 ||
      !SLUG_PATTERN.test(row.productSlug)
    ) {
      addIssue(issues, {
        row: rowNumber,
        column: "productSlug",
        message: "Product slug must be a valid lowercase slug.",
      });
      continue;
    }
    if (
      !row.productTitle.length ||
      row.productTitle.length > 255 ||
      row.productTitle !== row.productTitle.trim()
    ) {
      addIssue(issues, {
        row: rowNumber,
        column: "productTitle",
        message: "Product title must be 1–255 characters without surrounding whitespace.",
      });
      continue;
    }
    const productStatus = CATALOG_STATUS.safeParse(row.productStatus);
    if (!productStatus.success) {
      issueForZod(issues, rowNumber, "productStatus", productStatus.error);
      continue;
    }
    if (row.productPublishedAt !== row.productPublishedAt.trim()) {
      addIssue(issues, {
        row: rowNumber,
        column: "productPublishedAt",
        message: "Publish timestamps cannot contain surrounding whitespace.",
      });
      continue;
    }
    const productPublishedAt = publishedAtSchema.safeParse(row.productPublishedAt);
    if (!productPublishedAt.success) {
      issueForZod(issues, rowNumber, "productPublishedAt", productPublishedAt.error);
      continue;
    }
    if (productStatus.data === "ACTIVE" && productPublishedAt.data === null) {
      addIssue(issues, {
        row: rowNumber,
        column: "productPublishedAt",
        message: "An active product requires a publish timestamp.",
      });
      continue;
    }
    const categorySlugs = parseCategorySlugs(
      row.categorySlugs,
      row.primaryCategorySlug,
      rowNumber,
      issues,
    );
    if (categorySlugs === null) continue;

    const productFields = {
      row: rowNumber,
      publicId: productId.data,
      slug: row.productSlug,
      title: row.productTitle,
      status: productStatus.data,
      publishedAt: productPublishedAt.data,
      primaryCategorySlug: row.primaryCategorySlug || null,
      categorySlugs,
    };
    const existingProduct = products.get(productId.data);
    if (existingProduct && !sameProductFields(existingProduct, productFields)) {
      addIssue(issues, {
        row: rowNumber,
        column: "productPublicId",
        message: "Rows for the same product contain inconsistent product or category values.",
      });
      continue;
    }
    const slugOwner = productBySlug.get(row.productSlug);
    if (slugOwner && slugOwner !== productId.data) {
      addIssue(issues, {
        row: rowNumber,
        column: "productSlug",
        message: "The same product slug was assigned to more than one public ID.",
      });
      continue;
    }

    const product = existingProduct ?? {
      ...productFields,
      variants: [],
      hasVariantlessRow: false,
    };
    if (!existingProduct) {
      products.set(product.publicId, product);
      productBySlug.set(product.slug, product.publicId);
      categoryAssignmentCount += categorySlugs.length;
    }

    if (!row.variantPublicId.length) {
      const nonEmptyVariantColumn = CATALOG_CSV_COLUMNS.slice(8).find(
        (column) => row[column].length > 0,
      );
      if (nonEmptyVariantColumn) {
        addIssue(issues, {
          row: rowNumber,
          column: nonEmptyVariantColumn,
          message: "All variant columns must be empty when variantPublicId is empty.",
        });
        continue;
      }
      if (product.hasVariantlessRow || product.variants.length) {
        addIssue(issues, {
          row: rowNumber,
          column: "variantPublicId",
          message: "A product cannot mix or duplicate variantless and variant rows.",
        });
        continue;
      }
      product.hasVariantlessRow = true;
      continue;
    }
    if (product.hasVariantlessRow) {
      addIssue(issues, {
        row: rowNumber,
        column: "variantPublicId",
        message: "A product cannot mix variantless and variant rows.",
      });
      continue;
    }
    if (variantIds.has(row.variantPublicId)) {
      addIssue(issues, {
        row: rowNumber,
        column: "variantPublicId",
        message: "The variant public ID appears more than once.",
      });
      continue;
    }
    if (row.trackInventory !== "true" && row.trackInventory !== "false") {
      addIssue(issues, {
        row: rowNumber,
        column: "trackInventory",
        message: "trackInventory must be exactly true or false.",
      });
      continue;
    }
    const surroundingWhitespaceColumn = TRIMMED_VARIANT_COLUMNS.find(
      (column) => row[column] !== row[column].trim(),
    );
    if (surroundingWhitespaceColumn) {
      addIssue(issues, {
        row: rowNumber,
        column: surroundingWhitespaceColumn,
        message: "Imported variant fields cannot contain surrounding whitespace.",
      });
      continue;
    }

    const variant = variantFormSchema.safeParse({
      productPublicId: product.publicId,
      variantPublicId: row.variantPublicId,
      title: row.variantTitle,
      sku: row.sku,
      status: row.variantStatus,
      publishedAt: row.variantPublishedAt,
      priceMode: row.priceMode,
      usdPrice: row.usdPrice,
      minimumOrderQuantity: row.minimumOrderQuantity,
      trackInventory: row.trackInventory === "true" ? "true" : undefined,
      position: row.position,
      optionValues: row.optionValues,
    });
    if (!variant.success) {
      const first = variant.error.issues[0];
      addIssue(issues, {
        row: rowNumber,
        column: typeof first?.path[0] === "string" ? first.path[0] : null,
        message: first?.message ?? "The variant row is invalid.",
      });
      continue;
    }
    if (variant.data.sku && desiredSkus.has(variant.data.sku)) {
      addIssue(issues, {
        row: rowNumber,
        column: "sku",
        message: "The same non-empty SKU appears more than once in the import.",
      });
      continue;
    }

    variantIds.add(variant.data.variantPublicId);
    if (variant.data.sku) desiredSkus.add(variant.data.sku);
    product.variants.push({
      row: rowNumber,
      publicId: variant.data.variantPublicId,
      title: variant.data.title,
      sku: variant.data.sku,
      status: variant.data.status,
      publishedAt: variant.data.publishedAt,
      priceMode: variant.data.priceMode,
      amountMinor: variant.data.amountMinor,
      minimumOrderQuantity: variant.data.minimumOrderQuantity,
      trackInventory: variant.data.trackInventory,
      position: variant.data.position,
      optionValues: variant.data.optionValues,
    });
  }

  if (categoryAssignmentCount > CATALOG_IMPORT_MAX_CATEGORY_ASSIGNMENTS) {
    addIssue(issues, {
      row: null,
      column: "categorySlugs",
      message: `The import exceeds the ${CATALOG_IMPORT_MAX_CATEGORY_ASSIGNMENTS.toLocaleString("en-US")}-assignment safety limit.`,
    });
  }
  if (issues.length) return { success: false, issues };

  return {
    success: true,
    document: {
      rowCount: dataRows.length,
      products: [...products.values()],
      variantCount: variantIds.size,
      categoryAssignmentCount,
    },
  };
}

export function formatCatalogImportIssue(issue: CatalogImportIssue) {
  const location = [
    issue.row === null ? null : `row ${issue.row}`,
    issue.column,
  ].filter(Boolean).join(", ");
  return location ? `${location}: ${issue.message}` : issue.message;
}
