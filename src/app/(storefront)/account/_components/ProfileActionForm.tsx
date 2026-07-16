"use client";

import { useActionState, useId, type ReactNode } from "react";

import {
  INITIAL_PROFILE_ACTION_STATE,
  type ProfileActionState,
} from "@/server/account/profile-action-state";

type ProfileAction = (
  state: ProfileActionState,
  formData: FormData,
) => Promise<ProfileActionState>;

export function ProfileActionForm({
  action,
  children,
}: {
  action: ProfileAction;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    INITIAL_PROFILE_ACTION_STATE,
  );
  const statusId = useId();
  const errors = Object.entries(state.fieldErrors ?? {});

  return (
    <form action={formAction} className="mt-6 space-y-5" aria-busy={pending}>
      {children}
      {state.status !== "idle" ? (
        <div
          id={statusId}
          role={state.status === "error" ? "alert" : "status"}
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
                  <li key={`${field}:${message}`}>{message}</li>
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
        className="rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-cream-50 transition hover:bg-sage-600 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
