"use client";

import type { FormEvent } from "react";
import { useState } from "react";

import { openWhatsAppIntent } from "@/lib/whatsapp-client";

export function ContactForm({
  whatsappEnabled,
  categories,
}: {
  whatsappEnabled: boolean;
  categories: ReadonlyArray<{ slug: string; name: string }>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!whatsappEnabled || pending) return;
    const formData = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    setFallbackUrl(null);
    try {
      const result = await openWhatsAppIntent({
        templateKey: "contact",
        category: String(formData.get("category") ?? "").trim(),
        requirement: String(formData.get("requirement") ?? "").trim(),
      });
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
    <form
      onSubmit={handleSubmit}
      className="grid gap-5 rounded-xl border border-line bg-surface p-8 shadow-sm"
    >
      <div>
        <label
          htmlFor="contact-category"
          className="mb-1.5 block text-sm font-medium text-strong"
        >
          Research area <span className="text-error">*</span>
        </label>
        <select
          id="contact-category"
          name="category"
          required
          disabled={!whatsappEnabled}
          className="w-full rounded-xl border border-ink-900/15 bg-cream-50 px-4 py-2.5 text-sm outline-none transition-colors focus:border-sage-500 focus:ring-2 focus:ring-sage-400/30 disabled:opacity-60"
        >
          <option value="">Select…</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
          <option value="custom">Custom / OEM synthesis</option>
          <option value="order-support">Existing order support</option>
        </select>
      </div>
      <div>
        <label
          htmlFor="contact-requirement"
          className="mb-1.5 block text-sm font-medium text-strong"
        >
          Requirement <span className="text-error">*</span>
        </label>
        <textarea
          id="contact-requirement"
          name="requirement"
          rows={6}
          required
          disabled={!whatsappEnabled}
          maxLength={1_200}
          placeholder="Material, quantity, presentation, documentation, or public order reference…"
          className="w-full rounded-xl border border-ink-900/15 bg-cream-50 px-4 py-2.5 text-sm outline-none transition-colors focus:border-sage-500 focus:ring-2 focus:ring-sage-400/30 disabled:opacity-60"
        />
      </div>
      <button
        type="submit"
        disabled={!whatsappEnabled || pending}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-ink-900 px-7 py-3.5 text-sm font-semibold text-cream-50 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-sage-600 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Preparing WhatsApp…" : "Continue in WhatsApp"}
      </button>
      <p className="text-caption text-muted">
        {whatsappEnabled
          ? "A validated template is prepared after the click is recorded. You review and send the message in WhatsApp. Do not include passwords, payment credentials, medical details, or other sensitive information."
          : "WhatsApp contact has not been enabled by an administrator. Email remains available on this page."}
      </p>
      {fallbackUrl ? (
        <p className="text-sm text-body" role="status">
          WhatsApp did not open?{" "}
          <a
            href={fallbackUrl}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-strong underline underline-offset-4"
          >
            Open the prepared conversation
          </a>
          .
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
