"use client";

import { useActionState, useId, type ReactNode } from "react";

import {
  INITIAL_ADDRESS_ACTION_STATE,
  type AddressActionState,
} from "@/server/account/address-action-state";

type AddressAction = (
  state: AddressActionState,
  formData: FormData,
) => Promise<AddressActionState>;

export function AddressActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Saving…",
  className = "space-y-6",
  tone = "primary",
}: {
  action: AddressAction;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  tone?: "primary" | "danger";
}) {
  const [state, formAction, pending] = useActionState(
    action,
    INITIAL_ADDRESS_ACTION_STATE,
  );
  const statusId = useId();
  const errors = Object.entries(state.fieldErrors ?? {});

  return (
    <form action={formAction} className={className} aria-busy={pending}>
      {children}

      {state.status !== "idle" ? (
        <div
          id={statusId}
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`rounded-xl border px-4 py-3 text-sm ${
            state.status === "error"
              ? "border-red-700/20 bg-red-50 text-red-800"
              : "border-sage-700/20 bg-sage-50 text-sage-800"
          }`}
        >
          <p className="font-semibold">{state.message}</p>
          {errors.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {errors.flatMap(([field, messages]) =>
                messages.map((message) => (
                  <li key={`${field}:${message}`}>
                    <span className="font-semibold">{field}:</span> {message}
                  </li>
                )),
              )}
            </ul>
          ) : null}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        aria-describedby={state.status === "idle" ? undefined : statusId}
        className={
          tone === "danger"
            ? "rounded-full border border-red-800/25 px-4 py-2 text-sm font-semibold text-red-800 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
            : "rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-cream-50 transition hover:bg-sage-600 disabled:cursor-wait disabled:opacity-60"
        }
      >
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
