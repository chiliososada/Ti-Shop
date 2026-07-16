import { z } from "zod";

export const publicIdSchema = z.uuid("Invalid public identifier.");

export function nullableText(maximum: number) {
  return z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => (value.length > 0 ? value : null));
}

export const checkboxSchema = z
  .enum(["on", "true"])
  .optional()
  .transform((value) => value !== undefined);

export const nonNegativePositionSchema = z
  .string()
  .trim()
  .regex(/^\d+$/u, "Position must be a non-negative whole number.")
  .transform(Number)
  .refine(Number.isSafeInteger, "Position is too large.")
  .refine((value) => value <= 1_000_000, "Position is too large.");

const ISO_WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u;

export const publishedAtSchema = z
  .string()
  .trim()
  .max(40)
  .transform((value, context) => {
    if (value.length === 0) {
      return null;
    }

    if (!ISO_WITH_TIMEZONE.test(value)) {
      context.addIssue({
        code: "custom",
        message: "Use an ISO timestamp with a timezone, such as 2026-07-13T12:00:00Z.",
      });
      return z.NEVER;
    }

    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      context.addIssue({ code: "custom", message: "Publish time is invalid." });
      return z.NEVER;
    }
    return parsed;
  });
