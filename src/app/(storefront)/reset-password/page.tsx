import type { Metadata } from "next";
import Link from "next/link";

import { AuthPageShell } from "@/components/auth/AuthPageShell";

import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Set a new password",
  description: "Choose a new password for your Flintmarrow account.",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : null;

  return (
    <AuthPageShell
      eyebrow="Customer account"
      title="Set a new password"
      description="Choose the new password for your account. The reset link works once and expires after 60 minutes."
      alternateText="Link not working?"
      alternateHref="/forgot-password"
      alternateLabel="Request a new one"
    >
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="space-y-5">
          <p
            className="rounded-xl border border-error/20 bg-error/5 px-4 py-3 text-sm text-error"
            role="alert"
          >
            This reset link is invalid or has expired. Request a new one and
            use it within 60 minutes.
          </p>
          <Link
            href="/forgot-password"
            className="inline-flex w-full items-center justify-center rounded-full bg-ink-900 px-6 py-3.5 text-sm font-semibold text-cream-50 transition hover:bg-sage-600"
          >
            Request a new reset link
          </Link>
        </div>
      )}
    </AuthPageShell>
  );
}
