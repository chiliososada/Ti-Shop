import type { Metadata } from "next";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { safeCallbackPath } from "@/server/auth/callback-url";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a Veripep customer account with email and password.",
  robots: { index: false, follow: false },
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallbackPath(params.callbackUrl);
  const loginHref = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  return (
    <AuthPageShell
      eyebrow="Customer account"
      title="Create your account"
      description="Use an email address and password to prepare for saved addresses, orders, and shipment updates."
      alternateText="Already have an account?"
      alternateHref={loginHref}
      alternateLabel="Sign in"
    >
      <RegisterForm callbackUrl={callbackUrl} />
    </AuthPageShell>
  );
}
