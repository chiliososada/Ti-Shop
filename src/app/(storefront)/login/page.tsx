import type { Metadata } from "next";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeCallbackPath } from "@/server/auth/callback-url";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Veripep customer account.",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallbackPath(params.callbackUrl);
  const registerHref = `/register?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  return (
    <AuthPageShell
      eyebrow="Customer account"
      title="Welcome back"
      description="Sign in with the email address and password used for your account."
      alternateText="New to Veripep?"
      alternateHref={registerHref}
      alternateLabel="Create an account"
    >
      <LoginForm callbackUrl={callbackUrl} />
    </AuthPageShell>
  );
}
