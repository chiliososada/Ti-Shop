import { z } from "zod";

import {
  checkboxSchema,
  nullableText,
} from "@/server/admin/audit/validation";

export const ADMIN_PAYMENT_METHODS = [
  "NOWPAYMENTS",
  "WIRE_TRANSFER",
  "ZELLE",
  "OTHER_MANUAL",
] as const;

export const PAYMENT_METHOD_CONFIG_FORM_FIELDS = [
  "method",
  "displayName",
  "publicInstructions",
  "isEnabled",
] as const;

export const ONLINE_PAYMENT_SWITCH_FORM_FIELDS = ["isEnabled"] as const;
export const CHECKOUT_CHARGES_FORM_FIELDS = [
  "configured",
  "shippingFirstBlockMinor",
  "shippingBlockUnits",
  "shippingAdditionalBlockMinor",
  "taxRateBps",
] as const;

const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");
const MANUAL_METHODS = new Set(["WIRE_TRANSFER", "ZELLE", "OTHER_MANUAL"]);
const EMAIL_ADDRESS_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const LONG_PAYMENT_NUMBER_PATTERN = /(?:\+?\d[\s().-]*){7,}/u;
const IBAN_PATTERN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/iu;
const SWIFT_BIC_PATTERN =
  /\b(?:swift|bic)\b[^\r\n]{0,32}\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/iu;
const CREDENTIAL_PATTERN =
  /\b(?:api[\s_-]*key|ipn[\s_-]*secret|private[\s_-]*key|seed[\s_-]*phrase|password|access[\s_-]*token)\b/iu;

function appearsToContainSensitivePaymentMaterial(
  method: string,
  instructions: string | null,
) {
  if (!instructions) return false;
  if (CREDENTIAL_PATTERN.test(instructions)) return true;
  return (
    MANUAL_METHODS.has(method) &&
    (EMAIL_ADDRESS_PATTERN.test(instructions) ||
      LONG_PAYMENT_NUMBER_PATTERN.test(instructions) ||
      IBAN_PATTERN.test(instructions) ||
      SWIFT_BIC_PATTERN.test(instructions))
  );
}

export function isSafePublicPaymentInstructions(
  method: string,
  instructions: string | null,
) {
  return !appearsToContainSensitivePaymentMaterial(method, instructions);
}

const nullableMinorAmountSchema = z
  .string()
  .trim()
  .max(19)
  .transform((value, context) => {
    if (value.length === 0) return null;
    if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
      context.addIssue({
        code: "custom",
        message: "Shipping must be a non-negative whole number of cents.",
      });
      return z.NEVER;
    }
    if (BigInt(value) > MAX_POSTGRES_BIGINT) {
      context.addIssue({ code: "custom", message: "Shipping is too large." });
      return z.NEVER;
    }
    return value;
  });

const nullableTaxRateSchema = z
  .string()
  .trim()
  .max(5)
  .transform((value, context) => {
    if (value.length === 0) return null;
    if (!/^\d+$/u.test(value)) {
      context.addIssue({
        code: "custom",
        message: "Tax rate must be a whole number of basis points.",
      });
      return z.NEVER;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10_000) {
      context.addIssue({
        code: "custom",
        message: "Tax rate must be between 0 and 10000 basis points.",
      });
      return z.NEVER;
    }
    return parsed;
  });

// Boxes per shipping block: a small positive integer (empty → null).
const nullableBlockUnitsSchema = z
  .string()
  .trim()
  .max(6)
  .transform((value, context) => {
    if (value.length === 0) return null;
    const parsed = Number(value);
    if (
      !/^[1-9]\d*$/u.test(value) ||
      !Number.isSafeInteger(parsed) ||
      parsed > 100_000
    ) {
      context.addIssue({
        code: "custom",
        message: "Boxes per block must be a whole number from 1 to 100000.",
      });
      return z.NEVER;
    }
    return parsed;
  });

export const paymentMethodConfigSchema = z
  .object({
    method: z.enum(ADMIN_PAYMENT_METHODS),
    displayName: z
      .string()
      .trim()
      .min(1, "Display name is required.")
      .max(160),
    publicInstructions: nullableText(20_000),
    isEnabled: checkboxSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !isSafePublicPaymentInstructions(
        value.method,
        value.publicInstructions,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["publicInstructions"],
        message:
          "Public instructions cannot contain credentials, recipient email/phone, or bank/payment numbers. Keep sensitive settlement details in the approved external process.",
      });
    }
  });

export const onlinePaymentSwitchSchema = z
  .object({
    isEnabled: checkboxSchema,
  })
  .strict();

const REQUIRED_CHARGE_FIELDS = [
  "shippingFirstBlockMinor",
  "shippingBlockUnits",
  "shippingAdditionalBlockMinor",
  "taxRateBps",
] as const;

export const checkoutChargesSchema = z
  .object({
    configured: checkboxSchema,
    shippingFirstBlockMinor: nullableMinorAmountSchema,
    shippingBlockUnits: nullableBlockUnitsSchema,
    shippingAdditionalBlockMinor: nullableMinorAmountSchema,
    taxRateBps: nullableTaxRateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.configured) return;
    for (const field of REQUIRED_CHARGE_FIELDS) {
      if (value[field] === null) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "This field is required when checkout charges are configured.",
        });
      }
    }
  });

const minorStringOrNull = z
  .string()
  .refine(
    (value) =>
      /^(?:0|[1-9]\d*)$/u.test(value) && BigInt(value) <= MAX_POSTGRES_BIGINT,
  )
  .nullable();

export const checkoutChargesValueSchema = z
  .object({
    configured: z.boolean(),
    shippingFirstBlockMinor: minorStringOrNull,
    shippingBlockUnits: z.number().int().min(1).max(100_000).nullable(),
    shippingAdditionalBlockMinor: minorStringOrNull,
    taxRateBps: z.number().int().min(0).max(10_000).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.configured) return;
    for (const field of REQUIRED_CHARGE_FIELDS) {
      if (value[field] === null) {
        context.addIssue({ code: "custom", path: [field] });
      }
    }
  });

export type PaymentMethodConfigInput = z.output<
  typeof paymentMethodConfigSchema
>;
export type OnlinePaymentSwitchInput = z.output<
  typeof onlinePaymentSwitchSchema
>;
export type CheckoutChargesInput = z.output<typeof checkoutChargesSchema>;
