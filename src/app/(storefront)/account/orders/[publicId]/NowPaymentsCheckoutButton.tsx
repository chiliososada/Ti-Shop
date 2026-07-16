"use client";

import { useRef, useState } from "react";

type InitializationResponse = {
  checkoutUrl?: string;
  error?: string;
};

export function NowPaymentsCheckoutButton({
  orderPublicId,
  paymentPublicId,
}: {
  orderPublicId: string;
  paymentPublicId: string;
}) {
  const idempotencyKey = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function initialize() {
    setPending(true);
    setError(null);
    idempotencyKey.current ??= crypto.randomUUID();

    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(orderPublicId)}/payments/${encodeURIComponent(paymentPublicId)}/nowpayments`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idempotencyKey: idempotencyKey.current }),
        },
      );
      const result = (await response.json()) as InitializationResponse;
      if (!response.ok || !result.checkoutUrl) {
        setError(
          result.error ??
            "NOWPayments checkout could not be initialized. No payment was confirmed.",
        );
        return;
      }
      window.location.assign(result.checkoutUrl);
    } catch {
      setError(
        "The payment service could not be reached. Check this order before trying again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={pending}
        onClick={initialize}
        className="inline-flex rounded-full bg-ink-900 px-5 py-2.5 text-sm font-semibold text-cream-50 transition hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Opening secure checkout…" : "Continue with NOWPayments"}
      </button>
      {error ? (
        <p className="mt-3 text-sm leading-relaxed text-clay-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
