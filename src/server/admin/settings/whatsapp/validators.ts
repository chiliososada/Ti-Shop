import { z } from "zod";

import { checkboxSchema } from "@/server/admin/audit/validation";
import { whatsappSettingValueSchema } from "@/server/whatsapp/config";

export const WHATSAPP_SETTINGS_FORM_FIELDS = [
  "configured",
  "phoneE164",
  "displayValue",
  "welcomeMessage",
  "businessHours",
  "templateGlobal",
  "templateProduct",
  "templateCart",
  "templateOrder",
  "templateContact",
] as const;

function nullableText(maximum: number, singleLine = false) {
  return z
    .string()
    .trim()
    .max(maximum)
    .refine(
      (value) =>
        !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value) &&
        (!singleLine || !/[\r\n]/u.test(value)),
      singleLine
        ? "Use a single line without control characters."
        : "Control characters are not allowed.",
    )
    .transform((value) => value || null);
}

export const adminWhatsAppSettingsSchema = z
  .object({
    configured: checkboxSchema,
    phoneE164: nullableText(16, true),
    displayValue: nullableText(80, true),
    welcomeMessage: nullableText(500),
    businessHours: nullableText(500),
    templateGlobal: z.string().trim().min(1).max(2_000),
    templateProduct: z.string().trim().min(1).max(2_000),
    templateCart: z.string().trim().min(1).max(2_000),
    templateOrder: z.string().trim().min(1).max(2_000),
    templateContact: z.string().trim().min(1).max(2_000),
  })
  .strict()
  .transform((value) => ({
    configured: value.configured,
    phoneE164: value.phoneE164,
    displayValue: value.displayValue,
    welcomeMessage: value.welcomeMessage,
    businessHours: value.businessHours,
    templates: {
      global: value.templateGlobal,
      product: value.templateProduct,
      cart: value.templateCart,
      order: value.templateOrder,
      contact: value.templateContact,
    },
  }))
  .pipe(whatsappSettingValueSchema);

export type AdminWhatsAppSettingsInput = z.output<
  typeof adminWhatsAppSettingsSchema
>;
