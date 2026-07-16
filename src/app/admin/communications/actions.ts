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
  addAdminInquiryNote,
  assignAdminInquiry,
  createAdminInquiryFromWhatsAppIntent,
  updateAdminInquiryStatus,
} from "@/server/admin/communications/mutations";
import {
  ADD_INQUIRY_NOTE_FORM_FIELDS,
  addInquiryNoteSchema,
  ASSIGN_INQUIRY_FORM_FIELDS,
  assignInquirySchema,
  CREATE_WHATSAPP_FOLLOW_UP_FORM_FIELDS,
  createWhatsAppFollowUpSchema,
  UPDATE_INQUIRY_STATUS_FORM_FIELDS,
  updateInquiryStatusSchema,
} from "@/server/admin/communications/validators";

type CommunicationsActionState = AdminActionState & {
  refreshPending?: boolean;
};

const MAX_COMMUNICATIONS_REVALIDATION_TARGETS = 3;

function revalidateInquiry(
  errorScope: `${string}.cache-refresh`,
  inquiryPublicId: string,
) {
  const targets = new Set([
    "/admin/communications",
    `/admin/communications/${inquiryPublicId}`,
    "/admin",
  ]);
  let refreshPending = false;

  if (targets.size > MAX_COMMUNICATIONS_REVALIDATION_TARGETS) {
    refreshPending = true;
    logUnexpectedAdminActionError(
      errorScope,
      new Error("Communications cache refresh target limit was exceeded."),
    );
  }

  for (const path of [...targets].slice(
    0,
    MAX_COMMUNICATIONS_REVALIDATION_TARGETS,
  )) {
    try {
      revalidatePath(path);
    } catch (error) {
      unstable_rethrow(error);
      refreshPending = true;
      logUnexpectedAdminActionError(errorScope, error);
    }
  }

  return refreshPending;
}

function committedCommunicationsSuccess(
  message: string,
  refreshPending: boolean,
): CommunicationsActionState {
  if (!refreshPending) return actionSuccess(message);
  return {
    status: "success",
    message: `${message} The database operation is committed, but one or more affected page refreshes may be delayed. Do not resubmit this form; reload the affected page later.`,
    refreshPending: true,
  };
}

export async function updateInquiryStatusAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<CommunicationsActionState> {
  const fields = readStrictFormData(
    formData,
    UPDATE_INQUIRY_STATUS_FORM_FIELDS,
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = updateInquiryStatusSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminInquiryStatus>>;
  try {
    result = await updateAdminInquiryStatus(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("communications.inquiry.status", error);
    return actionFailure("The inquiry status could not be saved. Try again.");
  }
  if (!result.ok) {
    if (result.reason === "conflict") {
      return actionFailure(
        "This inquiry changed after the page loaded. Refresh before applying another status.",
      );
    }
    if (result.reason === "invalid_transition") {
      return actionFailure(
        "That status transition is not allowed. Refresh the inquiry and choose an available transition.",
      );
    }
    return actionFailure("The inquiry could not be found.");
  }

  const refreshPending = revalidateInquiry(
    "communications.inquiry.status.cache-refresh",
    result.inquiryPublicId,
  );
  return committedCommunicationsSuccess(
    result.unchanged
      ? `${result.inquiryNumber} already has that status.`
      : `${result.inquiryNumber} status updated.`,
    refreshPending,
  );
}

export async function assignInquiryAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<CommunicationsActionState> {
  const fields = readStrictFormData(formData, ASSIGN_INQUIRY_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = assignInquirySchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof assignAdminInquiry>>;
  try {
    result = await assignAdminInquiry(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("communications.inquiry.assign", error);
    return actionFailure("The inquiry assignment could not be saved. Try again.");
  }
  if (!result.ok) {
    if (result.reason === "conflict") {
      return actionFailure(
        "This inquiry changed after the page loaded. Refresh before changing its assignment.",
      );
    }
    if (result.reason === "ineligible_admin") {
      return actionFailure(
        "The selected administrator is inactive or no longer has communications access. Refresh and choose another assignee.",
      );
    }
    return actionFailure("The inquiry could not be found.");
  }

  const refreshPending = revalidateInquiry(
    "communications.inquiry.assign.cache-refresh",
    result.inquiryPublicId,
  );
  return committedCommunicationsSuccess(
    result.unchanged
      ? `${result.inquiryNumber} already has that assignment.`
      : result.assigneeName
        ? `${result.inquiryNumber} assigned to ${result.assigneeName}.`
        : `${result.inquiryNumber} is now unassigned.`,
    refreshPending,
  );
}

export async function addInquiryNoteAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<CommunicationsActionState> {
  const fields = readStrictFormData(formData, ADD_INQUIRY_NOTE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = addInquiryNoteSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof addAdminInquiryNote>>;
  try {
    result = await addAdminInquiryNote(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("communications.inquiry.note", error);
    return actionFailure("The internal note could not be saved. Try again.");
  }
  if (!result.ok) return actionFailure("The inquiry could not be found.");

  const refreshPending = revalidateInquiry(
    "communications.inquiry.note.cache-refresh",
    result.inquiryPublicId,
  );
  return committedCommunicationsSuccess(
    `Internal note added to ${result.inquiryNumber}.`,
    refreshPending,
  );
}

export async function createWhatsAppFollowUpAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<CommunicationsActionState> {
  const fields = readStrictFormData(
    formData,
    CREATE_WHATSAPP_FOLLOW_UP_FORM_FIELDS,
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = createWhatsAppFollowUpSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<
    ReturnType<typeof createAdminInquiryFromWhatsAppIntent>
  >;
  try {
    result = await createAdminInquiryFromWhatsAppIntent(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError(
      "communications.whatsapp_follow_up.create",
      error,
    );
    return actionFailure("The follow-up inquiry could not be created. Try again.");
  }
  if (!result.ok) {
    if (result.reason === "missing_contact") {
      return actionFailure(
        "This anonymous intent has no stored customer identity or order contact. It cannot become a follow-up inquiry.",
      );
    }
    return actionFailure("The WhatsApp intent could not be found.");
  }

  const refreshPending = revalidateInquiry(
    "communications.whatsapp_follow_up.create.cache-refresh",
    result.inquiryPublicId,
  );
  return committedCommunicationsSuccess(
    result.duplicate
      ? `${result.inquiryNumber} is already linked to this intent.`
      : `${result.inquiryNumber} created as an administrative follow-up. No WhatsApp message was imported.`,
    refreshPending,
  );
}
