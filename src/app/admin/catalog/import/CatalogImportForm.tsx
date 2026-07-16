"use client";

import { useActionState, useId } from "react";

import {
  catalogImportAction,
  INITIAL_CATALOG_IMPORT_ACTION_STATE,
} from "@/app/admin/catalog/import/actions";
import { CATALOG_IMPORT_CONFIRMATION } from "@/server/admin/catalog/catalog-import-constants";

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";

export function CatalogImportForm() {
  const [state, formAction, pending] = useActionState(
    catalogImportAction,
    INITIAL_CATALOG_IMPORT_ACTION_STATE,
  );
  const statusId = useId();
  const errors = Object.entries(state.fieldErrors ?? {});

  return (
    <form action={formAction} className="space-y-6" aria-busy={pending}>
      <label className="block text-sm font-semibold text-strong">
        Catalog CSV
        <input
          className={inputClass}
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
        />
        <span className="mt-2 block text-xs font-normal text-muted">
          UTF-8, exact current export columns, at most 2 MiB and 1,000 data rows. The file is read in memory and is not retained.
        </span>
      </label>

      <label className="block text-sm font-semibold text-strong">
        Apply confirmation
        <input
          className={inputClass}
          name="confirmation"
          autoComplete="off"
          maxLength={64}
          placeholder={CATALOG_IMPORT_CONFIRMATION}
        />
        <span className="mt-2 block text-xs font-normal text-muted">
          Preview first. Then type <span className="font-mono">{CATALOG_IMPORT_CONFIRMATION}</span> and submit the exact same file within 15 minutes.
        </span>
      </label>

      {state.status !== "idle" ? (
        <div
          id={statusId}
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`rounded-xl border px-4 py-3 text-sm ${
            state.status === "error"
              ? "border-red-700/20 bg-red-50 text-red-800"
              : state.refreshPending
                ? "border-amber-700/20 bg-amber-50 text-amber-900"
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

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          name="mode"
          value="preview"
          disabled={pending}
          aria-describedby={state.status === "idle" ? undefined : statusId}
          className="rounded-full border border-ink-900/15 bg-white px-6 py-3 text-sm font-semibold text-strong disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Checking…" : "Preview and validate"}
        </button>
        <button
          type="submit"
          name="mode"
          value="apply"
          disabled={pending || !state.previewToken}
          aria-describedby={state.status === "idle" ? undefined : statusId}
          className="rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Applying…" : "Apply validated import"}
        </button>
      </div>
    </form>
  );
}
