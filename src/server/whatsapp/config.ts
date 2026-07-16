import "server-only";

import { cache } from "react";
import { z } from "zod";

import {
  isE164PhoneNumber,
  WHATSAPP_TEMPLATE_KEYS,
  type WhatsAppTemplateKey,
} from "@/lib/whatsapp";
import { getDb } from "@/server/db/client";

export const WHATSAPP_SETTING_KEY = "storefront.whatsapp";

export const DEFAULT_WHATSAPP_TEMPLATES = {
  global:
    "Hello, I'd like to discuss a research-product or order requirement.",
  product:
    "Hello, I'd like to ask about this product.\nProduct: {{productName}}\nSlug: {{productSlug}}\nSKU: {{sku}}\nCAS: {{casNumber}}\nURL: {{productUrl}}",
  cart:
    "Hello, I'd like to ask about this cart.\n{{cartLines}}\nDisplayed product subtotal: {{displayedSubtotal}} USD\nPlease confirm current availability, shipping, and payment options.",
  order: "Hello, I need help with order reference {{orderReference}}.",
  contact:
    "Hello, I'd like to discuss a research-product requirement.\nResearch area: {{category}}\nRequirement: {{requirement}}",
} as const satisfies Record<WhatsAppTemplateKey, string>;

export const DEFAULT_WHATSAPP_SETTING = {
  configured: false,
  phoneE164: null,
  displayValue: null,
  welcomeMessage: "How can we help with a product or order question?",
  businessHours: null,
  templates: DEFAULT_WHATSAPP_TEMPLATES,
} as const;

const TEMPLATE_PLACEHOLDERS: Record<WhatsAppTemplateKey, readonly string[]> = {
  global: [],
  product: [
    "productName",
    "productSlug",
    "sku",
    "casNumber",
    "productUrl",
  ],
  cart: ["cartLines", "displayedSubtotal"],
  order: ["orderReference"],
  contact: ["category", "requirement"],
};

const REQUIRED_TEMPLATE_PLACEHOLDERS = TEMPLATE_PLACEHOLDERS;
const PLACEHOLDER_PATTERN = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/gu;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

export function templateValidationMessage(
  key: WhatsAppTemplateKey,
  template: string,
) {
  if (CONTROL_CHARACTER_PATTERN.test(template)) {
    return "Templates cannot contain control characters.";
  }
  if (template.includes("{{") || template.includes("}}")) {
    const tokens = [...template.matchAll(PLACEHOLDER_PATTERN)].map(
      (match) => match[1] as string,
    );
    const reconstructed = template.replace(PLACEHOLDER_PATTERN, "");
    if (reconstructed.includes("{{") || reconstructed.includes("}}")) {
      return "Template placeholders must use the exact {{placeholder}} form.";
    }
    const allowed = new Set(TEMPLATE_PLACEHOLDERS[key]);
    const unknown = tokens.find((token) => !allowed.has(token));
    if (unknown) return `Unknown placeholder {{${unknown}}}.`;
  }

  for (const required of REQUIRED_TEMPLATE_PLACEHOLDERS[key]) {
    if (!template.includes(`{{${required}}}`)) {
      return `The {{${required}}} placeholder is required.`;
    }
  }
  return null;
}

function templateSchema(key: WhatsAppTemplateKey) {
  return z
    .string()
    .trim()
    .min(1, "A message template is required.")
    .max(2_000)
    .superRefine((value, context) => {
      const message = templateValidationMessage(key, value);
      if (message) context.addIssue({ code: "custom", message });
    });
}

const nullableSingleLine = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .refine(
      (value) => !/[\r\n\u0000-\u001F\u007F]/u.test(value),
      "Use a single line without control characters.",
    )
    .nullable();

const nullableMessage = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .refine(
      (value) => !CONTROL_CHARACTER_PATTERN.test(value),
      "Control characters are not allowed.",
    )
    .nullable();

export const whatsappSettingValueSchema = z
  .object({
    configured: z.boolean(),
    phoneE164: nullableSingleLine(16),
    displayValue: nullableSingleLine(80),
    welcomeMessage: nullableMessage(500),
    businessHours: nullableMessage(500),
    templates: z
      .object({
        global: templateSchema("global"),
        product: templateSchema("product"),
        cart: templateSchema("cart"),
        order: templateSchema("order"),
        contact: templateSchema("contact"),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.configured) return;
    if (!value.phoneE164 || !isE164PhoneNumber(value.phoneE164)) {
      context.addIssue({
        code: "custom",
        path: ["phoneE164"],
        message: "A valid E.164 number is required when WhatsApp is enabled.",
      });
    }
    if (!value.displayValue) {
      context.addIssue({
        code: "custom",
        path: ["displayValue"],
        message: "A public display value is required when WhatsApp is enabled.",
      });
    }
  });

export type WhatsAppSettingValue = z.infer<typeof whatsappSettingValueSchema>;

export function parseOperationalWhatsAppConfig(value: unknown) {
  const parsed = whatsappSettingValueSchema.safeParse(value);
  if (!parsed.success || !parsed.data.configured) return null;
  if (!parsed.data.phoneE164 || !parsed.data.displayValue) return null;
  return {
    ...parsed.data,
    configured: true as const,
    phoneE164: parsed.data.phoneE164,
    displayValue: parsed.data.displayValue,
  };
}

export type OperationalWhatsAppConfig = NonNullable<
  ReturnType<typeof parseOperationalWhatsAppConfig>
>;

export const getPublicWhatsAppPresentation = cache(async () => {
  try {
    const setting = await getDb().siteSetting.findUnique({
      where: { key: WHATSAPP_SETTING_KEY },
      select: { value: true },
    });
    const config = parseOperationalWhatsAppConfig(setting?.value);
    if (!config) return null;

    return {
      enabled: true as const,
      displayValue: config.displayValue,
      welcomeMessage: config.welcomeMessage,
      businessHours: config.businessHours,
    };
  } catch (error) {
    console.error("Public WhatsApp configuration is unavailable.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
});

export { WHATSAPP_TEMPLATE_KEYS };
