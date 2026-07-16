"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import {
  actionFailure,
  actionSuccess,
  formDataFailure,
  logUnexpectedAdminActionError,
  type AdminActionState,
  validationFailure,
} from "@/server/admin/audit/action-state";
import { readStrictFormData } from "@/server/admin/audit/form-data";
import {
  cancelProcurementOrder,
  importProcurementLines,
  receiveProcurementOrder,
  setProcurementFxRate,
  upsertProcurementItem,
  upsertProcurementOrder,
  upsertSupplier,
} from "@/server/admin/finance/procurement/mutations";
import {
  PROCUREMENT_FORM_FIELDS,
  PROCUREMENT_FX_FORM_FIELDS,
  PROCUREMENT_ITEM_FORM_FIELDS,
  PROCUREMENT_RECEIVE_FORM_FIELDS,
  procurementFormSchema,
  procurementFxFormSchema,
  procurementItemFormSchema,
  procurementReceiveFormSchema,
  SUPPLIER_FORM_FIELDS,
  supplierFormSchema,
} from "@/server/admin/finance/procurement/validators";

function refresh(publicId?: string) {
  revalidatePath("/admin/finance/procurement");
  if (publicId) {
    revalidatePath(`/admin/finance/procurement/${publicId}`);
  }
  revalidatePath("/admin/finance");
  revalidatePath("/admin/inventory");
}

type MutationOutcome =
  | { ok: true; publicId: string }
  | { ok: false; reason: string; message: string };

async function runAction(
  scope: string,
  work: () => Promise<MutationOutcome>,
  successMessage: string,
): Promise<AdminActionState> {
  try {
    const result = await work();
    if (!result.ok) return actionFailure(result.message);
    refresh(result.publicId);
    return actionSuccess(successMessage);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError(scope, error);
    return actionFailure("The change failed unexpectedly. Try again.");
  }
}

export async function upsertSupplierAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, SUPPLIER_FORM_FIELDS);
  if (!raw.success) return formDataFailure(raw.message);
  const parsed = supplierFormSchema.safeParse(raw.data);
  if (!parsed.success) return validationFailure(parsed.error);
  return runAction(
    "finance.supplier.upsert",
    () => upsertSupplier(parsed.data),
    "Supplier saved.",
  );
}

export async function upsertProcurementOrderAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, PROCUREMENT_FORM_FIELDS);
  if (!raw.success) return formDataFailure(raw.message);
  const parsed = procurementFormSchema.safeParse(raw.data);
  if (!parsed.success) return validationFailure(parsed.error);
  return runAction(
    "finance.procurement.upsert",
    () => upsertProcurementOrder(parsed.data),
    "Purchase order saved.",
  );
}

export async function upsertProcurementItemAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, PROCUREMENT_ITEM_FORM_FIELDS);
  if (!raw.success) return formDataFailure(raw.message);
  const parsed = procurementItemFormSchema.safeParse(raw.data);
  if (!parsed.success) return validationFailure(parsed.error);
  return runAction(
    "finance.procurement.item",
    () => upsertProcurementItem(parsed.data),
    parsed.data.remove === "true" ? "Purchase line removed." : "Purchase line saved.",
  );
}

export async function setProcurementFxRateAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, PROCUREMENT_FX_FORM_FIELDS);
  if (!raw.success) return formDataFailure(raw.message);
  const parsed = procurementFxFormSchema.safeParse(raw.data);
  if (!parsed.success) return validationFailure(parsed.error);
  return runAction(
    "finance.procurement.fx",
    () => setProcurementFxRate(parsed.data),
    "Exchange rate saved.",
  );
}

export async function receiveProcurementOrderAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, PROCUREMENT_RECEIVE_FORM_FIELDS);
  if (!raw.success) return formDataFailure(raw.message);
  const parsed = procurementReceiveFormSchema.safeParse(raw.data);
  if (!parsed.success) return validationFailure(parsed.error);
  return runAction(
    "finance.procurement.receive",
    () => receiveProcurementOrder(parsed.data),
    "Stock received: inventory quantities and moving-average costs are updated.",
  );
}

export async function importProcurementLinesAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, ["procurementPublicId", "csvText"]);
  if (!raw.success) return formDataFailure(raw.message);
  const publicId = raw.data.procurementPublicId ?? "";
  const csvText = raw.data.csvText ?? "";
  if (!publicId) return actionFailure("Missing purchase order id.");
  try {
    const result = await importProcurementLines({ procurementPublicId: publicId, csvText });
    if (!result.ok) return actionFailure(result.message);
    refresh(result.publicId);
    return result.errors.length > 0
      ? actionFailure(
          `Imported ${result.imported} rows; ${result.errors.length} rejected — ${result.errors.slice(0, 3).join(" ")}`,
        )
      : actionSuccess(`Imported ${result.imported} purchase lines.`);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("finance.procurement.import", error);
    return actionFailure("The import failed unexpectedly. Try again.");
  }
}

export async function cancelProcurementOrderAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, ["procurementPublicId"]);
  if (!raw.success) return formDataFailure(raw.message);
  const publicId = raw.data.procurementPublicId ?? "";
  if (!publicId) return actionFailure("Missing purchase order id.");
  return runAction(
    "finance.procurement.cancel",
    () => cancelProcurementOrder(publicId),
    "Purchase order canceled.",
  );
}
