"use client";

import type { FormEvent } from "react";
import { useState } from "react";

import { EmailField } from "@/components/auth/AuthFormFields";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();

    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });
      if (result.error) {
        setErrorMessage(
          result.error.code === "TOO_MANY_REQUESTS"
            ? "Too many attempts. Please wait a moment and try again."
            : "The email could not be sent right now. Please try again shortly.",
        );
        return;
      }
      setSent(true);
    } catch {
      setErrorMessage(
        "The email could not be sent right now. Please try again shortly.",
      );
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <p
        className="rounded-xl border border-sage-700/20 bg-sage-50 px-4 py-3 text-sm text-sage-900"
        role="status"
      >
        If an account exists for that email address, a reset link is on its
        way. The link stays valid for 60 minutes — check your spam folder if
        it does not arrive within a few minutes.
      </p>
    );
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <EmailField />
      {errorMessage ? (
        <p
          className="rounded-xl border border-error/20 bg-error/5 px-4 py-3 text-sm text-error"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center rounded-full bg-ink-900 px-6 py-3.5 text-sm font-semibold text-cream-50 transition hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a reset link"}
      </button>
    </form>
  );
}
