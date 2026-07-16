import type { ZodError } from "zod";

export type AddressActionState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export const INITIAL_ADDRESS_ACTION_STATE: AddressActionState = {
  status: "idle",
  message: "",
};

export function addressActionSuccess(message: string): AddressActionState {
  return { status: "success", message };
}

export function addressActionFailure(message: string): AddressActionState {
  return { status: "error", message };
}

export function addressValidationFailure(
  error: ZodError,
): AddressActionState {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "form";
    fieldErrors[field] ??= [];
    fieldErrors[field].push(issue.message);
  }

  return {
    status: "error",
    message: "Review the highlighted address fields and try again.",
    fieldErrors,
  };
}

export function logUnexpectedAddressActionError(
  scope: string,
  error: unknown,
) {
  console.error(`Customer address action failed: ${scope}`, {
    errorType: error instanceof Error ? error.name : typeof error,
  });
}
