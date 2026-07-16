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
import { updateAdminWhatsAppSettings } from "@/server/admin/settings/whatsapp/mutations";
import {
  adminWhatsAppSettingsSchema,
  WHATSAPP_SETTINGS_FORM_FIELDS,
} from "@/server/admin/settings/whatsapp/validators";

type SettingsActionState = AdminActionState & {
  refreshPending?: boolean;
};

type SettingsRevalidationTarget = {
  path: string;
  type?: "page" | "layout";
};

const MAX_SETTINGS_REVALIDATION_TARGETS = 2;

function revalidateWhatsAppSettings(errorScope: `${string}.cache-refresh`) {
  const candidates: SettingsRevalidationTarget[] = [
    { path: "/admin/settings" },
    { path: "/", type: "layout" },
  ];
  const targets = new Map<string, SettingsRevalidationTarget>();
  for (const target of candidates) {
    targets.set(`${target.path}:${target.type ?? "literal"}`, target);
  }
  let refreshPending = false;

  if (targets.size > MAX_SETTINGS_REVALIDATION_TARGETS) {
    refreshPending = true;
    logUnexpectedAdminActionError(
      errorScope,
      new Error("Settings cache refresh target limit was exceeded."),
    );
  }

  for (const target of [...targets.values()].slice(
    0,
    MAX_SETTINGS_REVALIDATION_TARGETS,
  )) {
    try {
      revalidatePath(target.path, target.type);
    } catch (error) {
      unstable_rethrow(error);
      refreshPending = true;
      logUnexpectedAdminActionError(errorScope, error);
    }
  }

  return refreshPending;
}

function committedSettingsSuccess(
  message: string,
  refreshPending: boolean,
): SettingsActionState {
  if (!refreshPending) return actionSuccess(message);
  return {
    status: "success",
    message: `${message} The database operation is committed, but one or more affected page refreshes may be delayed. Do not resubmit this form; reload the affected page later.`,
    refreshPending: true,
  };
}

export async function updateWhatsAppSettingsAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const fields = readStrictFormData(formData, WHATSAPP_SETTINGS_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = adminWhatsAppSettingsSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminWhatsAppSettings>>;
  try {
    result = await updateAdminWhatsAppSettings(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("settings.whatsapp.update", error);
    return actionFailure("WhatsApp settings could not be saved.");
  }
  if (!result.ok) {
    return actionFailure(
      "The baseline WhatsApp setting is missing. Run the safe database seed first.",
    );
  }
  const refreshPending = revalidateWhatsAppSettings(
    "settings.whatsapp.update.cache-refresh",
  );
  return committedSettingsSuccess(
    "WhatsApp storefront settings saved.",
    refreshPending,
  );
}
