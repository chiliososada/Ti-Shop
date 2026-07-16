import type { ZodError } from "zod";

export type ProfileActionState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export const INITIAL_PROFILE_ACTION_STATE: ProfileActionState = {
  status: "idle",
  message: "",
};

export function profileValidationFailure(error: ZodError): ProfileActionState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "form";
    fieldErrors[field] ??= [];
    fieldErrors[field].push(issue.message);
  }
  return {
    status: "error",
    message: "Review the profile fields and try again.",
    fieldErrors,
  };
}
