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
  approveAfterSalesEvent,
  attachCompensationToOrder,
  completeAfterSalesEvent,
  upsertAfterSalesEvent,
  upsertAfterSalesItem,
  voidAfterSalesEvent,
} from "@/server/admin/finance/after-sales/mutations";
import {
  AFTER_SALES_ATTACH_FORM_FIELDS,
  AFTER_SALES_COMPLETE_FORM_FIELDS,
  AFTER_SALES_EVENT_FORM_FIELDS,
  AFTER_SALES_ITEM_FORM_FIELDS,
  afterSalesAttachFormSchema,
  afterSalesCompleteFormSchema,
  afterSalesEventFormSchema,
  afterSalesItemFormSchema,
} from "@/server/admin/finance/after-sales/validators";

function refresh(publicId?: string) {
  revalidatePath("/admin/finance/after-sales");
  if (publicId) revalidatePath(`/admin/finance/after-sales/${publicId}`);
  revalidatePath("/admin/finance");
  revalidatePath("/admin/inventory");
}

type Outcome =
  | { ok: true; publicId: string }
  | { ok: false; reason: string; message: string };

async function run(
  scope: string,
  work: () => Promise<Outcome>,
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

export async function upsertAfterSalesEventAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, AFTER_SALES_EVENT_FORM_FIELDS);
  if (!raw.success) return formDataFailure(raw.message);
  const parsed = afterSalesEventFormSchema.safeParse(raw.data);
  if (!parsed.success) return validationFailure(parsed.error);
  return run(
    "finance.after_sales.upsert",
    () => upsertAfterSalesEvent(parsed.data),
    "After-sales event saved.",
  );
}

export async function upsertAfterSalesItemAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, AFTER_SALES_ITEM_FORM_FIELDS);
  if (!raw.success) return formDataFailure(raw.message);
  const parsed = afterSalesItemFormSchema.safeParse(raw.data);
  if (!parsed.success) return validationFailure(parsed.error);
  return run(
    "finance.after_sales.item",
    () => upsertAfterSalesItem(parsed.data),
    parsed.data.remove === "true" ? "Item removed." : "Item saved.",
  );
}

export async function approveAfterSalesEventAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, ["eventPublicId"]);
  if (!raw.success) return formDataFailure(raw.message);
  return run(
    "finance.after_sales.approve",
    () => approveAfterSalesEvent(raw.data.eventPublicId ?? ""),
    "Event approved.",
  );
}

export async function completeAfterSalesEventAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, AFTER_SALES_COMPLETE_FORM_FIELDS);
  if (!raw.success) return formDataFailure(raw.message);
  const parsed = afterSalesCompleteFormSchema.safeParse(raw.data);
  if (!parsed.success) return validationFailure(parsed.error);
  return run(
    "finance.after_sales.complete",
    () => completeAfterSalesEvent(parsed.data),
    "Event completed: adjustments, stock, and costs are recorded.",
  );
}

export async function voidAfterSalesEventAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, ["eventPublicId"]);
  if (!raw.success) return formDataFailure(raw.message);
  return run(
    "finance.after_sales.void",
    () => voidAfterSalesEvent(raw.data.eventPublicId ?? ""),
    "Event voided.",
  );
}

export async function attachCompensationToOrderAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const raw = readStrictFormData(formData, AFTER_SALES_ATTACH_FORM_FIELDS);
  if (!raw.success) return formDataFailure(raw.message);
  const parsed = afterSalesAttachFormSchema.safeParse(raw.data);
  if (!parsed.success) return validationFailure(parsed.error);
  return run(
    "finance.after_sales.attach",
    () => attachCompensationToOrder(parsed.data),
    "Compensation attached to the order as a zero-priced line.",
  );
}
