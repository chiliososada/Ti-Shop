export type StrictFormDataResult =
  | { success: true; data: Record<string, string> }
  | { success: false; message: string };

export function readStrictFormData(
  formData: FormData,
  allowedFields: readonly string[],
): StrictFormDataResult {
  const allowed = new Set(allowedFields);
  const seen = new Set<string>();
  const data: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION_")) {
      continue;
    }

    if (!allowed.has(key)) {
      return {
        success: false,
        message: "The form contained unexpected fields. Refresh and try again.",
      };
    }

    if (seen.has(key)) {
      return {
        success: false,
        message: "The form contained duplicate fields. Refresh and try again.",
      };
    }

    if (typeof value !== "string") {
      return {
        success: false,
        message: "File uploads are not supported by this form.",
      };
    }

    seen.add(key);
    data[key] = value;
  }

  return { success: true, data };
}
