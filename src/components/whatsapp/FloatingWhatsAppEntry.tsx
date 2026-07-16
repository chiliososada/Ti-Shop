"use client";

import { WhatsAppIntentButton } from "@/components/whatsapp/WhatsAppIntentButton";

export function FloatingWhatsAppEntry({
  welcomeMessage,
}: {
  welcomeMessage: string | null;
}) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex max-w-[min(20rem,calc(100vw-2.5rem))] flex-col items-end gap-2">
      {welcomeMessage ? (
        <span className="rounded-xl border border-ink-900/10 bg-cream-50/95 px-4 py-2 text-caption text-body shadow-lg backdrop-blur">
          {welcomeMessage}
        </span>
      ) : null}
      <WhatsAppIntentButton
        intent={{ templateKey: "global" }}
        className="inline-flex items-center gap-2 rounded-full bg-[#176b4d] px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-[#12563e] disabled:cursor-wait disabled:opacity-70"
        fallbackClassName="rounded-lg bg-cream-50 px-3 py-2 text-caption font-semibold text-strong shadow"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4.1A8 8 0 1 1 20 11.5Z" />
          <path d="M9.2 8.4c.4 2.4 2 4 4.4 4.8l1.2-1.1 1.8.9c.2.1.3.4.2.7-.4 1.1-1.5 1.7-2.7 1.5-3.8-.7-6.6-3.5-7.3-7.3-.2-1.2.4-2.3 1.5-2.7.3-.1.6 0 .7.2l.9 1.8-1 1.2Z" />
        </svg>
        WhatsApp
      </WhatsAppIntentButton>
    </div>
  );
}
