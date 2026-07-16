import type { WhatsAppTemplateKey } from "@/lib/whatsapp";
import type { OperationalWhatsAppConfig } from "@/server/whatsapp/config";

const UNSAFE_CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const MAX_RENDERED_MESSAGE_LENGTH = 4_096;

export function normalizeWhatsAppMessageValue(value: string) {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(UNSAFE_CONTROL_CHARACTERS, "")
    .trim();
}

export function normalizeWhatsAppSingleLine(value: string) {
  return normalizeWhatsAppMessageValue(value).replace(/\s+/gu, " ");
}

export function renderWhatsAppTemplate(
  config: OperationalWhatsAppConfig,
  key: WhatsAppTemplateKey,
  values: Readonly<Record<string, string>>,
) {
  const rendered = config.templates[key].replace(
    /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/gu,
    (_match, token: string) => normalizeWhatsAppMessageValue(values[token] ?? ""),
  );
  const normalized = normalizeWhatsAppMessageValue(rendered)
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n");

  if (!normalized || normalized.length > MAX_RENDERED_MESSAGE_LENGTH) {
    throw new TypeError("The prepared WhatsApp message is invalid or too long.");
  }
  return normalized;
}
