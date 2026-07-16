import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processImport: vi.fn(),
  revalidatePath: vi.fn(),
  logUnexpected: vi.fn(),
  unstableRethrow: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("next/navigation", () => ({
  unstable_rethrow: mocks.unstableRethrow,
}));
vi.mock("@/server/admin/catalog/catalog-import-mutations", () => ({
  processAdminCatalogImport: mocks.processImport,
}));
vi.mock("@/server/admin/audit/action-state", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/admin/audit/action-state")
  >();
  return {
    ...actual,
    logUnexpectedAdminActionError: mocks.logUnexpected,
  };
});

import {
  catalogImportAction,
  INITIAL_CATALOG_IMPORT_ACTION_STATE,
} from "@/app/admin/catalog/import/actions";
import { CATALOG_IMPORT_CONFIRMATION } from "@/server/admin/catalog/catalog-import-constants";
import { CATALOG_CSV_COLUMNS, serializeCatalogCsv } from "@/server/admin/catalog/csv";
import type { CatalogImportSummary } from "@/server/admin/catalog/catalog-import-mutations";

function validCsvFile() {
  const source = serializeCatalogCsv([{
    productPublicId: randomUUID(),
    productSlug: "action-import-product",
    productTitle: "Action import product",
    productStatus: "DRAFT",
    productPublishedAt: "",
    primaryCategorySlug: "",
    categorySlugs: "",
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
  }], CATALOG_CSV_COLUMNS);
  return new File([source], "catalog.csv", { type: "text/csv" });
}

function importForm(mode: "preview" | "apply") {
  const formData = new FormData();
  formData.set("file", validCsvFile());
  formData.set("mode", mode);
  formData.set(
    "confirmation",
    mode === "apply" ? CATALOG_IMPORT_CONFIRMATION : "",
  );
  return formData;
}

function summary(applied: boolean): CatalogImportSummary {
  return {
    rowCount: 1,
    productCount: 1,
    variantCount: 0,
    productChangeCount: applied ? 1 : 0,
    variantChangeCount: 0,
    categoryAssignmentChangeCount: 0,
    priceChangeCount: 0,
    totalChangeCount: applied ? 1 : 0,
    applied,
  };
}

describe("catalog import Server Action commit and refresh semantics", () => {
  beforeEach(() => {
    mocks.processImport.mockReset();
    mocks.revalidatePath.mockReset();
    mocks.logUnexpected.mockReset();
    mocks.unstableRethrow.mockReset();
  });

  it("returns the opaque approval created by the transaction preview", async () => {
    mocks.processImport.mockResolvedValue({
      ok: true,
      summary: summary(false),
      previewToken: "v1.opaque-approval",
    });

    const state = await catalogImportAction(
      INITIAL_CATALOG_IMPORT_ACTION_STATE,
      importForm("preview"),
    );

    expect(state).toMatchObject({
      status: "success",
      previewToken: "v1.opaque-approval",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps a committed import successful when cache refresh partly fails", async () => {
    const refreshError = new Error("cache backend unavailable");
    mocks.processImport.mockResolvedValue({
      ok: true,
      summary: summary(true),
    });
    mocks.revalidatePath
      .mockImplementationOnce(() => {
        throw refreshError;
      })
      .mockImplementation(() => undefined);

    const state = await catalogImportAction(
      {
        status: "success",
        message: "Preview passed.",
        previewToken: "opaque-preview-token",
      },
      importForm("apply"),
    );

    expect(state).toMatchObject({
      status: "success",
      refreshPending: true,
      summary: { applied: true },
    });
    expect(state.message).toContain("database operation succeeded");
    expect(state.message).toContain("cache refreshes are pending");
    expect(state.message).not.toContain("No partial import was committed");
    expect(mocks.logUnexpected).toHaveBeenCalledWith(
      "catalog.import.cache-refresh",
      refreshError,
    );

    const calls = mocks.revalidatePath.mock.calls.map(([path, type]) =>
      `${String(path)}:${String(type ?? "literal")}`,
    );
    expect(calls).toHaveLength(7);
    expect(new Set(calls).size).toBe(calls.length);
    expect(calls.length).toBeLessThanOrEqual(16);
    expect(mocks.processImport).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        mode: "apply",
        previewToken: "opaque-preview-token",
      }),
    );
  });

  it("does not refresh or claim a write when the transaction rejects stale approval", async () => {
    mocks.processImport.mockResolvedValue({
      ok: false,
      reason: "stale_preview",
      row: null,
      message: "Catalog state changed after preview.",
    });

    const state = await catalogImportAction(
      {
        status: "success",
        message: "Preview passed.",
        previewToken: "opaque-preview-token",
      },
      importForm("apply"),
    );

    expect(state.status).toBe("error");
    expect(state.message).toContain("Preview this exact file again");
    expect(state.message).toContain("no import changes were written");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
