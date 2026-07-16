"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const statuses = [
  ["waiting", "Waiting"],
  ["confirming", "Confirming"],
  ["partially_paid", "Partially paid"],
  ["finished", "Finished"],
  ["failed", "Failed"],
  ["expired", "Expired"],
] as const;

export function MockPaymentControls({
  providerInvoiceId,
}: {
  providerInvoiceId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function simulate(status: (typeof statuses)[number][0]) {
    setPending(status);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/payments/nowpayments/mock/${encodeURIComponent(providerInvoiceId)}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      const result = (await response.json()) as {
        error?: string;
        paymentStatus?: string;
      };
      if (!response.ok) {
        setMessage(result.error ?? "The local simulation failed.");
        return;
      }
      setMessage(
        `Local simulation applied: ${result.paymentStatus ?? status}. No real funds moved.`,
      );
      router.refresh();
    } catch {
      setMessage("The local simulation could not reach the development server.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-6">
      <div className="grid gap-3 sm:grid-cols-2">
        {statuses.map(([status, label]) => (
          <button
            key={status}
            type="button"
            disabled={pending !== null}
            onClick={() => simulate(status)}
            className="rounded-full border border-ink-900/15 px-5 py-3 text-sm font-semibold text-strong transition hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending === status ? "Applying…" : label}
          </button>
        ))}
      </div>
      <p aria-live="polite" className="mt-4 text-sm leading-relaxed text-body">
        {message}
      </p>
    </div>
  );
}
