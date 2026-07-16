import type { ZodError } from "zod";

export type AdminActionState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export const INITIAL_ADMIN_ACTION_STATE: AdminActionState = {
  status: "idle",
  message: "",
};

export function formDataFailure(message: string): AdminActionState {
  return { status: "error", message };
}

export function validationFailure(error: ZodError): AdminActionState {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "form";
    fieldErrors[field] ??= [];
    fieldErrors[field].push(issue.message);
  }

  return {
    status: "error",
    message: "Review the highlighted form errors and try again.",
    fieldErrors,
  };
}

export function actionSuccess(message: string): AdminActionState {
  return { status: "success", message };
}

export function actionFailure(message: string): AdminActionState {
  return { status: "error", message };
}

export function logUnexpectedAdminActionError(scope: string, error: unknown) {
  console.error(`Admin action failed: ${scope}`, {
    errorType: error instanceof Error ? error.name : typeof error,
  });
}
