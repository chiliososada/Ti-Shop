"use client";

import { isTrustedWhatsAppUrl } from "@/lib/whatsapp";

export type WhatsAppIntentClientInput =
  | { templateKey: "global" }
  | { templateKey: "product"; productSlug: string }
  | {
      templateKey: "cart";
      lines: Array<{
        productSlug: string;
        variantPublicId: string;
        quantity: number;
      }>;
    }
  | { templateKey: "order"; orderPublicId: string }
  | {
      templateKey: "contact";
      category: string;
      requirement: string;
    };

type WhatsAppIntentResponse = {
  url?: unknown;
  error?: unknown;
};

export class WhatsAppClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppClientError";
  }
}

export async function requestWhatsAppIntent(
  input: WhatsAppIntentClientInput,
) {
  const response = await fetch("/api/whatsapp/intents", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      sourcePath: window.location.pathname,
    }),
  });
  let result: WhatsAppIntentResponse;
  try {
    result = (await response.json()) as WhatsAppIntentResponse;
  } catch {
    throw new WhatsAppClientError(
      "WhatsApp contact is temporarily unavailable.",
    );
  }

  if (!response.ok || !isTrustedWhatsAppUrl(result.url)) {
    throw new WhatsAppClientError(
      typeof result.error === "string"
        ? result.error
        : "WhatsApp contact is temporarily unavailable.",
    );
  }
  return result.url;
}

export async function openWhatsAppIntent(input: WhatsAppIntentClientInput) {
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;

  try {
    const url = await requestWhatsAppIntent(input);
    if (popup) popup.location.replace(url);
    return { url, opened: Boolean(popup) };
  } catch (error) {
    popup?.close();
    throw error;
  }
}
