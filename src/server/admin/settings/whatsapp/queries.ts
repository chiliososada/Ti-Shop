import "server-only";

import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import {
  DEFAULT_WHATSAPP_SETTING,
  WHATSAPP_SETTING_KEY,
  whatsappSettingValueSchema,
} from "@/server/whatsapp/config";

export async function getAdminWhatsAppSettings() {
  const authorization = await requirePermission(
    "settings.read",
    "/admin/settings",
  );
  const setting = await getDb().siteSetting.findUnique({
    where: { key: WHATSAPP_SETTING_KEY },
    select: { value: true, updatedAt: true },
  });
  const parsed = setting
    ? whatsappSettingValueSchema.safeParse(setting.value)
    : null;

  return {
    exists: setting !== null,
    invalid: setting !== null && parsed?.success === false,
    value:
      parsed?.success === true ? parsed.data : DEFAULT_WHATSAPP_SETTING,
    updatedAt: setting?.updatedAt.toISOString() ?? null,
    canManage: authorization.permissions.has("settings.manage"),
  };
}
