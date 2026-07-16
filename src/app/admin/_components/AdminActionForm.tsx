"use client";

import { useActionState, useId, type ReactNode } from "react";

import {
  INITIAL_ADMIN_ACTION_STATE,
  type AdminActionState,
} from "@/server/admin/audit/action-state";

type AdminAction = (
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

type AdminActionFormProps = {
  action: AdminAction;
  children: ReactNode;
  submitLabel?: string;
  className?: string;
};

export function AdminActionForm({
  action,
  children,
  submitLabel = "Save changes",
  className = "space-y-6",
}: AdminActionFormProps) {
  const [state, formAction, pending] = useActionState(
    action,
    INITIAL_ADMIN_ACTION_STATE,
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
        className="rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
