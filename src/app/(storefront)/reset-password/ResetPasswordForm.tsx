"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";

import { authClient } from "@/lib/auth-client";

type ClientAuthError = { code?: string };

function resetErrorMessage(error: ClientAuthError) {
  switch (error.code) {
    case "INVALID_TOKEN":
      return "This reset link is invalid or has expired. Request a new one.";
    case "PASSWORD_TOO_SHORT":
      return "The new password must contain at least 6 characters.";
    case "PASSWORD_TOO_LONG":
      return "The new password must contain no more than 128 characters.";
    case "TOO_MANY_REQUESTS":
      return "Too many attempts. Please wait a moment and try again.";
    default:
      return "The password could not be changed. Request a new reset link and try again.";
  }
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    if (newPassword !== confirmPassword) {
      setErrorMessage("The new passwords do not match.");
      setPending(false);
      return;
    }

    try {
      const result = await authClient.resetPassword({ newPassword, token });
      if (result.error) {
        setErrorMessage(resetErrorMessage(result.error));
        return;
      }
      setDone(true);
    } catch {
      setErrorMessage(
        "The password service is temporarily unavailable. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    "mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 font-normal text-strong outline-none transition focus:border-sage-500 focus:ring-2 focus:ring-sage-200";

  if (done) {
    return (
      <div className="space-y-5">
        <p
          className="rounded-xl border border-sage-700/20 bg-sage-50 px-4 py-3 text-sm text-sage-900"
          role="status"
        >
          Your password has been changed. Sign in with the new password.
        </p>
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center rounded-full bg-ink-900 px-6 py-3.5 text-sm font-semibold text-cream-50 transition hover:bg-sage-600"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <label className="block text-sm font-semibold text-strong">
        New password
        <input
          className={inputClass}
          type="password"
          name="newPassword"
          autoComplete="new-password"
          required
          minLength={6}
          maxLength={128}
        />
        <span className="mt-2 block text-caption font-normal text-muted">
          Use 6–128 characters. A password manager is recommended.
        </span>
      </label>
      <label className="block text-sm font-semibold text-strong">
        Confirm new password
        <input
          className={inputClass}
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          required
          minLength={6}
          maxLength={128}
        />
      </label>
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
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
