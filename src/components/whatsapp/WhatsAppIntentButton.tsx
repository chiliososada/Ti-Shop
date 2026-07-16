"use client";

import { useState, type ReactNode } from "react";

import {
  openWhatsAppIntent,
  type WhatsAppIntentClientInput,
} from "@/lib/whatsapp-client";

export function WhatsAppIntentButton({
  intent,
  children,
  className,
  fallbackClassName,
}: {
  intent: WhatsAppIntentClientInput;
  children: ReactNode;
  className: string;
  fallbackClassName?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  async function handleClick() {
    if (pending) return;
    setPending(true);
    setError(null);
    setFallbackUrl(null);
    try {
      const result = await openWhatsAppIntent(intent);
      if (!result.opened) setFallbackUrl(result.url);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "WhatsApp contact is temporarily unavailable.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="contents">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={className}
      >
        {pending ? "Preparing WhatsApp…" : children}
      </button>
      {fallbackUrl ? (
        <a
          href={fallbackUrl}
          target="_blank"
          rel="noreferrer"
          className={fallbackClassName ?? "text-sm font-semibold underline"}
        >
          Open the prepared WhatsApp conversation
        </a>
      ) : null}
      {error ? (
        <span role="alert" className="text-caption text-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
