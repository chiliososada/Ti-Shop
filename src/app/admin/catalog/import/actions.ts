"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import type { AdminActionState } from "@/server/admin/audit/action-state";
import { logUnexpectedAdminActionError } from "@/server/admin/audit/action-state";
import {
  CATALOG_IMPORT_CONFIRMATION,
  CATALOG_IMPORT_MAX_BYTES,
  formatCatalogImportIssue,
  parseCatalogImportCsv,
} from "@/server/admin/catalog/catalog-import";
import {
  processAdminCatalogImport,
  type CatalogImportSummary,
} from "@/server/admin/catalog/catalog-import-mutations";

const ALLOWED_CSV_TYPES = new Set([
  "",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
]);

export type CatalogImportActionState = AdminActionState & {
  summary?: CatalogImportSummary;
  previewToken?: string;
  refreshPending?: boolean;
};

export const INITIAL_CATALOG_IMPORT_ACTION_STATE: CatalogImportActionState = {
  status: "idle",
  message: "",
};

type StrictImportFields = {
  file: File;
  mode: "preview" | "apply";
  confirmation: string;
};

function actionFailure(
  message: string,
  fieldErrors?: Record<string, string[]>,
): CatalogImportActionState {
  return { status: "error", message, fieldErrors };
}

function readStrictImportFormData(formData: FormData):
  | { success: true; data: StrictImportFields }
  | { success: false; message: string } {
  const allowed = new Set(["file", "mode", "confirmation"]);
  const entries = new Map<string, FormDataEntryValue>();
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION_")) continue;
    if (!allowed.has(key)) {
      return { success: false, message: "The import form contained an unexpected field." };
    }
    if (entries.has(key)) {
      return { success: false, message: "The import form contained a duplicate field." };
    }
    entries.set(key, value);
  }

  const file = entries.get("file");
  const mode = entries.get("mode");
  const confirmation = entries.get("confirmation");
  if (typeof file === "string" || file === undefined) {
    return { success: false, message: "Choose one CSV file." };
  }
  if (mode !== "preview" && mode !== "apply") {
    return { success: false, message: "Choose Preview or Apply." };
  }
  if (typeof confirmation !== "string") {
    return { success: false, message: "The confirmation field is missing." };
  }
  return { success: true, data: { file, mode, confirmation } };
}

function summaryMessage(summary: CatalogImportSummary, mode: "preview" | "apply") {
  const counts = `${summary.productChangeCount} product, ${summary.variantChangeCount} variant, ${summary.categoryAssignmentChangeCount} category-assignment, and ${summary.priceChangeCount} USD-price changes`;
  if (mode === "preview") {
    return summary.totalChangeCount
      ? `Preview passed for ${summary.rowCount} rows. It would make ${counts}. Type the confirmation phrase and apply this exact file within 15 minutes.`
      : `Preview passed for ${summary.rowCount} rows. The catalog already matches this file; applying it would make no database changes.`;
  }
  return summary.applied
    ? `Catalog import applied atomically: ${counts}.`
    : "Catalog import validated successfully, but the catalog already matched this file, so nothing was written.";
}

type RevalidationTarget = {
  path: string;
  type?: "page" | "layout";
};

const MAX_CATALOG_REVALIDATION_TARGETS = 16;
const CATALOG_REVALIDATION_TARGETS: readonly RevalidationTarget[] = [
  { path: "/" },
  { path: "/admin/catalog" },
  { path: "/admin/catalog/products/[publicId]", type: "page" },
  { path: "/categories/[slug]", type: "page" },
  { path: "/products" },
  { path: "/products/[id]", type: "page" },
  { path: "/sitemap.xml" },
];

function revalidateImportedCatalog() {
  const targets = new Map<string, RevalidationTarget>();
  for (const target of CATALOG_REVALIDATION_TARGETS) {
    targets.set(`${target.path}:${target.type ?? "literal"}`, target);
  }
  if (targets.size > MAX_CATALOG_REVALIDATION_TARGETS) {
    throw new Error("Catalog cache refresh target limit was exceeded.");
  }

  let firstError: unknown;
  for (const target of targets.values()) {
    try {
      revalidatePath(target.path, target.type);
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) throw firstError;
}

export async function catalogImportAction(
  previousState: CatalogImportActionState,
  formData: FormData,
): Promise<CatalogImportActionState> {
  const fields = readStrictImportFormData(formData);
  if (!fields.success) return actionFailure(fields.message);
  const { file, mode, confirmation } = fields.data;

  if (!file.name.toLowerCase().endsWith(".csv")) {
    return actionFailure("Choose a file with a .csv extension.", {
      file: ["The file name must end in .csv."],
    });
  }
  if (!ALLOWED_CSV_TYPES.has(file.type.toLowerCase())) {
    return actionFailure("The selected file does not have an accepted CSV media type.", {
      file: ["Accepted types are text/csv and standard spreadsheet CSV types."],
    });
  }
  if (file.size <= 0 || file.size > CATALOG_IMPORT_MAX_BYTES) {
    return actionFailure("The CSV file size is outside the allowed range.", {
      file: [`Choose a non-empty CSV no larger than ${CATALOG_IMPORT_MAX_BYTES.toLocaleString("en-US")} bytes.`],
    });
  }

  let bytes: Uint8Array;
  let source: string;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size || bytes.byteLength > CATALOG_IMPORT_MAX_BYTES) {
      return actionFailure("The CSV changed while it was being read. Choose it again.");
    }
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return actionFailure("The CSV must be valid UTF-8 text.", {
      file: ["Export a UTF-8 CSV and try again."],
    });
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const parsed = parseCatalogImportCsv(source);
  if (!parsed.success) {
    return actionFailure(
      "The CSV failed strict validation. No database changes were made.",
      { file: parsed.issues.map(formatCatalogImportIssue) },
    );
  }

  if (mode === "apply") {
    if (confirmation !== CATALOG_IMPORT_CONFIRMATION) {
      return actionFailure("The apply confirmation phrase does not match.", {
        confirmation: [`Type ${CATALOG_IMPORT_CONFIRMATION} exactly.`],
      });
    }
    if (!previousState.previewToken) {
      return actionFailure(
        "Preview this exact file again before applying it. Preview approval expires after 15 minutes.",
      );
    }
  }

  try {
    const result = await processAdminCatalogImport(parsed.document, {
      mode,
      sha256,
      previewToken: mode === "apply" ? previousState.previewToken : undefined,
    });
    if (!result.ok) {
      if (result.reason === "stale_preview") {
        return actionFailure(
          "Catalog data or preview approval changed after preview. Preview this exact file again before applying; no import changes were written.",
        );
      }
      return actionFailure(
        `${result.row === null ? "" : `Row ${result.row}: `}${result.message} No database changes were made.`,
      );
    }
    if (mode === "preview") {
      return {
        status: "success",
        message: summaryMessage(result.summary, mode),
        summary: result.summary,
        previewToken: result.previewToken,
      };
    }

    let refreshPending = false;
    try {
      revalidateImportedCatalog();
    } catch (error) {
      refreshPending = true;
      logUnexpectedAdminActionError("catalog.import.cache-refresh", error);
    }
    const committedMessage = summaryMessage(result.summary, mode);
    return {
      status: "success",
      message: refreshPending
        ? `${committedMessage} The catalog database operation succeeded, but one or more storefront cache refreshes are pending. Preview and apply the exact file again to retry refresh without rewriting matching data.`
        : committedMessage,
      summary: result.summary,
      refreshPending,
    };
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("catalog.import", error);
    return actionFailure(
      "The catalog import could not be completed or confirmed. Refresh the catalog state before retrying.",
    );
  }
}
