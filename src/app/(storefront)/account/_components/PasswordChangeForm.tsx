"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

type AuthError = { code?: string };

function passwordChangeError(error: AuthError) {
  switch (error.code) {
    case "INVALID_PASSWORD":
      return "The current password was not accepted.";
    case "PASSWORD_TOO_SHORT":
      return "The new password must contain at least 12 characters.";
    case "PASSWORD_TOO_LONG":
      return "The new password must contain no more than 128 characters.";
    case "TOO_MANY_REQUESTS":
      return "Too many attempts. Wait a moment before trying again.";
    default:
      return "The password could not be changed. Review the form and try again.";
  }
}

export function PasswordChangeForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<
    { tone: "error" | "success"; text: string } | undefined
  >();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmPassword = String(data.get("confirmPassword") ?? "");

    if (newPassword !== confirmPassword) {
      setMessage({ tone: "error", text: "The new passwords do not match." });
      return;
    }

    setPending(true);
    setMessage(undefined);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setMessage({ tone: "error", text: passwordChangeError(result.error) });
        return;
      }
      form.reset();
      setMessage({
        tone: "success",
        text: "Password changed. Other signed-in sessions were revoked.",
      });
      router.refresh();
    } catch {
      setMessage({
        tone: "error",
        text: "The password service is temporarily unavailable. Try again.",
      });
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    "mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 font-normal text-strong outline-none transition focus:border-sage-500 focus:ring-2 focus:ring-sage-200";

  return (
    <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
      <label className="block text-sm font-semibold text-strong">
        Current password
        <input
          className={inputClass}
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          required
          maxLength={128}
        />
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-strong">
          New password
          <input
            className={inputClass}
            type="password"
            name="newPassword"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        <label className="block text-sm font-semibold text-strong">
          Confirm new password
          <input
            className={inputClass}
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </label>
      </div>
      <p className="text-caption leading-relaxed text-muted">
        Use 12–128 characters and a password manager. Changing the password
        signs this account out on other devices.
      </p>
      {message ? (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`rounded-xl px-4 py-3 text-sm ${
            message.tone === "error"
              ? "border border-error/20 bg-error/5 text-error"
              : "border border-sage-700/20 bg-sage-50 text-sage-900"
          }`}
        >
          {message.text}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex rounded-full border border-ink-900/15 px-6 py-3 text-sm font-semibold text-strong transition hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Changing password…" : "Change password"}
      </button>
    </form>
  );
}
