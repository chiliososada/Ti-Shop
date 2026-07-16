export const WHATSAPP_TEMPLATE_KEYS = [
  "global",
  "product",
  "cart",
  "order",
  "contact",
] as const;

export type WhatsAppTemplateKey = (typeof WHATSAPP_TEMPLATE_KEYS)[number];

const E164_PATTERN = /^\+[1-9]\d{7,14}$/u;
const WHATSAPP_PATH_PATTERN = /^\/[1-9]\d{7,14}$/u;

export function isE164PhoneNumber(value: string) {
  return E164_PATTERN.test(value);
}

export function buildWhatsAppDestinationUrl(
  phoneE164: string,
  message: string,
) {
  if (!isE164PhoneNumber(phoneE164)) {
    throw new TypeError("A valid E.164 WhatsApp number is required.");
  }
  if (!message.trim()) {
    throw new TypeError("A WhatsApp message is required.");
  }

  const url = new URL(`https://wa.me/${phoneE164.slice(1)}`);
  url.searchParams.set("text", message);
  return url.toString();
}

export function isTrustedWhatsAppUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 16_384) return false;

  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "wa.me" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      WHATSAPP_PATH_PATTERN.test(url.pathname) &&
      url.searchParams.has("text") &&
      [...url.searchParams.keys()].every((key) => key === "text")
    );
  } catch {
    return false;
  }
}
