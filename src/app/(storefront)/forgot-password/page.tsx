import type { Metadata } from "next";

import { AuthPageShell } from "@/components/auth/AuthPageShell";

import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Request a password reset link for your Flintmarrow account.",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <AuthPageShell
      eyebrow="Customer account"
      title="Forgot your password?"
      description="Enter the email address you registered with and we will email you a link to set a new password."
      alternateText="Remembered it after all?"
      alternateHref="/login"
      alternateLabel="Back to sign in"
    >
      <ForgotPasswordForm />
    </AuthPageShell>
  );
}
