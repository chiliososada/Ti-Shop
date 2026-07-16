import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import type { AdminWhatsAppSettingsInput } from "@/server/admin/settings/whatsapp/validators";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { WHATSAPP_SETTING_KEY } from "@/server/whatsapp/config";

const settingAuditSelect = {
  key: true,
  value: true,
  description: true,
  isPublic: true,
  updatedByUserId: true,
  updatedAt: true,
} as const;

export async function updateAdminWhatsAppSettings(
  input: AdminWhatsAppSettingsInput,
) {
  const authorization = await requirePermission(
    "settings.manage",
    "/admin/settings",
  );

  return getDb().$transaction(
    async (tx) => {
      const before = await tx.siteSetting.findUnique({
        where: { key: WHATSAPP_SETTING_KEY },
        select: settingAuditSelect,
      });
      if (!before) {
        return { ok: false as const, reason: "not_found" as const };
      }

      const after = await tx.siteSetting.update({
        where: { key: WHATSAPP_SETTING_KEY },
        data: {
          value: input,
          updatedByUserId: authorization.session.user.id,
        },
        select: settingAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "settings.whatsapp.update",
        resourceType: "site_setting",
        resourceId: WHATSAPP_SETTING_KEY,
        before,
        after,
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "site_setting",
          aggregateId: WHATSAPP_SETTING_KEY,
          eventType: "storefront.whatsapp.updated",
          payload: {
            configured: input.configured,
            hasPhoneNumber: input.phoneE164 !== null,
            templateKeys: Object.keys(input.templates),
          },
        },
        select: { id: true },
      });

      return { ok: true as const };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
