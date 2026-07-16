import { z } from "zod";

import { accountNameSchema } from "@/server/auth/account-name";

const optionalName = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => (value.length > 0 ? value : null));

const optionalUsPhone = z
  .string()
  .trim()
  .max(32)
  .transform((value, context) => {
    if (value.length === 0) return null;
    if (
      !/^[+()0-9 .-]+$/u.test(value) ||
      value.replace(/\D/gu, "").length < 7
    ) {
      context.addIssue({ code: "custom", message: "Use a valid phone number." });
      return z.NEVER;
    }
    return value;
  });

const consentFlag = z
  .enum(["on", "true"])
  .optional()
  .transform((value) => value !== undefined);

export const CUSTOMER_PROFILE_FIELDS = [
  "name",
  "firstName",
  "lastName",
  "phone",
  "countryCode",
  "preferredCurrency",
  "locale",
  "marketingConsent",
] as const;

export const customerProfileSchema = z
  .object({
    name: accountNameSchema,
    firstName: optionalName(100),
    lastName: optionalName(100),
    phone: optionalUsPhone,
    countryCode: z.literal("US"),
    preferredCurrency: z.literal("USD"),
    locale: z.literal("en-US"),
    marketingConsent: consentFlag,
  })
  .strict();

export type CustomerProfileInput = z.output<typeof customerProfileSchema>;
