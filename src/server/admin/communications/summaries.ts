const SAFE_TEMPLATE_KEYS = new Set([
  "global",
  "product",
  "cart",
  "order",
  "contact",
]);

export function summarizeWhatsAppTemplateKey(value: string | null) {
  return value && SAFE_TEMPLATE_KEYS.has(value) ? value : "not recorded";
}

export function buildWhatsAppFollowUpSubject(context: {
  orderNumber: string | null;
  productTitle: string | null;
}) {
  const value = context.orderNumber
    ? `WhatsApp follow-up for order ${context.orderNumber}`
    : context.productTitle
      ? `WhatsApp follow-up for ${context.productTitle}`
      : "WhatsApp contact follow-up";

  return value.slice(0, 255);
}

export const WHATSAPP_FOLLOW_UP_NOTICE =
  "Administrative follow-up created from a recorded WhatsApp contact intent. The site did not retain a free-form WhatsApp requirement or import any WhatsApp conversation messages.";
