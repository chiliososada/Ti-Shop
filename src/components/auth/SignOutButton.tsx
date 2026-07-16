"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setPending(true);
    setFailed(false);

    try {
      const result = await authClient.signOut();
      if (result.error) {
        setFailed(true);
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        className="rounded-full border border-ink-900/15 px-5 py-2.5 text-sm font-semibold text-strong transition hover:border-ink-900/30 hover:bg-ink-900/[0.04] disabled:opacity-60"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {failed ? (
        <span className="text-caption text-error" role="alert">
          Sign-out failed. Please try again.
        </span>
      ) : null}
    </div>
  );
}
