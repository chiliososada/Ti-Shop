import { z } from "zod";

const providerIdSchema = z
  .union([z.string().trim().min(1).max(255), z.number().finite()])
  .transform(String);

const providerDecimalSchema = z
  .union([
    z.string().trim().regex(/^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/iu),
    z.number().finite(),
  ])
  .transform(String);

const optionalProviderIdSchema = z
  .union([providerIdSchema, z.null(), z.undefined()])
  .transform((value) => value ?? null);

const optionalDecimalSchema = z
  .union([providerDecimalSchema, z.null(), z.undefined()])
  .transform((value) => value ?? null);

const optionalStringSchema = z
  .union([z.string().trim().max(2_048), z.null(), z.undefined()])
  .transform((value) => value || null);

export const nowPaymentsInvoiceResponseSchema = z
  .object({
    id: providerIdSchema,
    order_id: optionalStringSchema,
    price_amount: providerDecimalSchema,
    price_currency: z.string().trim().min(1).max(20),
    pay_currency: optionalStringSchema,
    invoice_url: z.string().url().max(4_096),
    created_at: z.string().datetime({ offset: true }).optional(),
    updated_at: z.string().datetime({ offset: true }).optional(),
  })
  .passthrough();

export const nowPaymentsPaymentPayloadSchema = z
  .object({
    payment_id: providerIdSchema,
    parent_payment_id: optionalProviderIdSchema,
    invoice_id: optionalProviderIdSchema,
    payment_status: z.string().trim().min(1).max(120),
    price_amount: providerDecimalSchema,
    price_currency: z.string().trim().min(1).max(20),
    pay_amount: optionalDecimalSchema,
    actually_paid: optionalDecimalSchema,
    actually_paid_at_fiat: optionalDecimalSchema,
    pay_currency: optionalStringSchema,
    pay_address: optionalStringSchema,
    payin_extra_id: optionalStringSchema,
    order_id: optionalStringSchema,
    purchase_id: optionalProviderIdSchema,
    outcome_amount: optionalDecimalSchema,
    outcome_currency: optionalStringSchema,
    created_at: z.string().datetime({ offset: true }).optional(),
    updated_at: z.string().datetime({ offset: true }).optional(),
  })
  .passthrough();

export type NowPaymentsPaymentPayload = z.infer<
  typeof nowPaymentsPaymentPayloadSchema
>;
