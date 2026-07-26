"use client";

import { useEffect } from "react";

export default function PublicError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Public storefront rendering failed.", error);
  }, [error]);

  return (
    <section className="section-y">
      <div className="container-x">
        <div className="mx-auto max-w-xl rounded-2xl bg-surface-alt p-8 text-center ring-1 ring-ink-900/[0.08]">
          <h1 className="text-h4 text-strong">Storefront temporarily unavailable</h1>
          <p className="mt-3 text-body">
            We could not load the current published catalog. No cached or
            unverified product data has been substituted.
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="mt-6 rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-cream-50 transition-colors hover:bg-sage-600"
          >
            Try again
          </button>
        </div>
      </div>
    </section>
  );
}
