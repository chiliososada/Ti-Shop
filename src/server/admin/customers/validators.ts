import { z } from "zod";

import { publicIdSchema } from "@/server/admin/audit/validation";
import { accountNameSchema } from "@/server/auth/account-name";

export const UPDATE_CUSTOMER_PROFILE_FIELDS = [
  "publicId",
  "name",
  "firstName",
  "lastName",
  "phone",
  "countryCode",
] as const;

export const DISABLE_CUSTOMER_ACCOUNT_FIELDS = [
  "publicId",
  "reason",
  "confirmationEmail",
  "confirmation",
] as const;

export const RESTORE_CUSTOMER_ACCOUNT_FIELDS = [
  "publicId",
  "confirmationEmail",
  "confirmation",
] as const;

function optionalName(maximum: number) {
  return z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => (value.length > 0 ? value : null));
}

const optionalUsPhone = z
  .string()
  .trim()
  .max(32)
  .refine(
    (value) =>
      value.length === 0 ||
      (/^[+0-9().\-\s]+$/u.test(value) &&
        value.replace(/\D/gu, "").length >= 7),
    "Enter a valid phone number or leave it blank.",
  )
  .transform((value) => (value.length > 0 ? value : null));

export const updateCustomerProfileSchema = z
  .object({
    publicId: publicIdSchema,
    name: accountNameSchema,
    firstName: optionalName(100),
    lastName: optionalName(100),
    phone: optionalUsPhone,
    countryCode: z.literal("US"),
  })
  .strict();

export type UpdateCustomerProfileInput = z.output<
  typeof updateCustomerProfileSchema
>;

const confirmationEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email("Enter the customer's exact email address.")
      .max(320),
  );

export const disableCustomerAccountSchema = z
  .object({
    publicId: publicIdSchema,
    reason: z
      .string()
      .trim()
      .min(10, "Record a reason with at least 10 characters.")
      .max(500),
    confirmationEmail: confirmationEmailSchema,
    confirmation: z.literal("DISABLE_CUSTOMER_ACCOUNT", {
      error: "Confirm that all current sessions will be revoked.",
    }),
  })
  .strict();

export const restoreCustomerAccountSchema = z
  .object({
    publicId: publicIdSchema,
    confirmationEmail: confirmationEmailSchema,
    confirmation: z.literal("RESTORE_CUSTOMER_ACCOUNT", {
      error: "Confirm that the customer may sign in again.",
    }),
  })
  .strict();

export type DisableCustomerAccountInput = z.output<
  typeof disableCustomerAccountSchema
>;

export type RestoreCustomerAccountInput = z.output<
  typeof restoreCustomerAccountSchema
>;
