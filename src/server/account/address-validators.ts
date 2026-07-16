import { z } from "zod";

import { isUsRegionCode } from "@/domain/us-regions";

const MAX_PG_BIGINT = BigInt("9223372036854775807");

function nullableText(maximum: number) {
  return z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => (value.length > 0 ? value : null));
}

const defaultFlagSchema = z
  .enum(["on", "true"])
  .optional()
  .transform((value) => value !== undefined);

export const addressIdSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{0,18}$/u, "Address identifier is invalid.")
  .transform((value) => BigInt(value))
  .refine((value) => value <= MAX_PG_BIGINT, "Address identifier is invalid.");

const addressFieldsSchema = z
  .object({
    label: nullableText(80),
    recipientName: z
      .string()
      .trim()
      .min(1, "Recipient name is required.")
      .max(255),
    company: nullableText(255),
    line1: z
      .string()
      .trim()
      .min(1, "Street address is required.")
      .max(255),
    line2: nullableText(255),
    city: z.string().trim().min(1, "City is required.").max(120),
    region: z
      .string()
      .trim()
      .toUpperCase()
      .refine(
        // Explicit boolean return: without it TS infers a type predicate
        // (5.5+) and narrows the schema output to the literal union, which
        // would ripple through every downstream address type.
        (value): boolean => isUsRegionCode(value),
        "Use a valid US state, district, or territory code.",
      ),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}(?:-\d{4})?$/u, "Use a valid US ZIP code."),
    countryCode: z.literal("US", {
      error: "Only United States addresses are supported.",
    }),
    phone: z
      .string()
      .trim()
      .max(32)
      .transform((value, context) => {
        if (value.length === 0) return null;
        if (value.length < 7 || !/^[+()0-9 .-]+$/u.test(value)) {
          context.addIssue({ code: "custom", message: "Use a valid phone number." });
          return z.NEVER;
        }
        return value;
      }),
    isDefaultShipping: defaultFlagSchema,
    isDefaultBilling: defaultFlagSchema,
  })
  .strict();

export const createAddressSchema = addressFieldsSchema
  .extend({ submissionId: z.string().uuid() })
  .strict();

export const updateAddressSchema = addressFieldsSchema
  .extend({ addressId: addressIdSchema })
  .strict();

export const deleteAddressSchema = z
  .object({ addressId: addressIdSchema })
  .strict();

export const CREATE_ADDRESS_FIELDS = [
  "submissionId",
  "label",
  "recipientName",
  "company",
  "line1",
  "line2",
  "city",
  "region",
  "postalCode",
  "countryCode",
  "phone",
  "isDefaultShipping",
  "isDefaultBilling",
] as const;

export const UPDATE_ADDRESS_FIELDS = [
  "addressId",
  ...CREATE_ADDRESS_FIELDS,
] as const;

export const DELETE_ADDRESS_FIELDS = ["addressId"] as const;

export type AddressFormInput = z.output<typeof createAddressSchema>;
export type UpdateAddressInput = z.output<typeof updateAddressSchema>;

export type StrictAddressFormDataResult =
  | { success: true; data: Record<string, string> }
  | { success: false; message: string };

export function readStrictAddressFormData(
  formData: FormData,
  allowedFields: readonly string[],
): StrictAddressFormDataResult {
  const allowed = new Set(allowedFields);
  const seen = new Set<string>();
  const data: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION_")) continue;

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
