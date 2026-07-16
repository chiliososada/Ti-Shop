"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { EmailField, PasswordField } from "@/components/auth/AuthFormFields";
import { authClient } from "@/lib/auth-client";

type ClientAuthError = {
  code?: string;
};

function registrationErrorMessage(error: ClientAuthError) {
  switch (error.code) {
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "An account already exists for this email address. Sign in instead.";
    case "PASSWORD_TOO_SHORT":
      return "Your password must contain at least 12 characters.";
    case "PASSWORD_TOO_LONG":
      return "Your password must contain no more than 128 characters.";
    case "INVALID_EMAIL":
      return "Enter a valid email address.";
    case "INVALID_NAME":
      return "Your name must contain between 2 and 255 characters.";
    case "TOO_MANY_REQUESTS":
      return "Too many attempts. Please wait a moment and try again.";
    default:
      return "We could not create your account. Review the form and try again.";
  }
}

export function RegisterForm({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");

    try {
      const result = await authClient.signUp.email({ name, email, password });

      if (result.error) {
        setErrorMessage(registrationErrorMessage(result.error));
        return;
      }

      router.replace(callbackUrl);
      router.refresh();
    } catch {
      setErrorMessage(
        "The registration service is unavailable. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <label className="block text-sm font-semibold text-strong">
        Name
        <input
          className="mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 font-normal text-strong outline-none transition focus:border-sage-500 focus:ring-2 focus:ring-sage-200"
          type="text"
          name="name"
          autoComplete="name"
          required
          minLength={2}
          maxLength={255}
        />
      </label>
      <EmailField />
      <PasswordField newPassword />

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
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
