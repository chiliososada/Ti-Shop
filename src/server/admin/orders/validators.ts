import { z } from "zod";

import { publicIdSchema } from "@/server/admin/audit/validation";

export const MANUAL_PAYMENT_REVIEW_FORM_FIELDS = [
  "paymentPublicId",
  "decision",
] as const;

export const manualPaymentReviewSchema = z
  .object({
    paymentPublicId: publicIdSchema,
    decision: z.enum(["CONFIRM", "REJECT"]),
  })
  .strict();

export type ManualPaymentReviewInput = z.output<
  typeof manualPaymentReviewSchema
>;

const externalRefundTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) => !/[\u0000-\u001F\u007F]/u.test(value),
    "Control characters are not allowed.",
  );

export const MANUAL_PAYMENT_REFUND_FORM_FIELDS = [
  "paymentPublicId",
  "refundReference",
  "note",
  "confirmation",
] as const;

export const manualPaymentRefundSchema = z
  .object({
    paymentPublicId: publicIdSchema,
    refundReference: externalRefundTextSchema,
    note: z
      .string()
      .trim()
      .max(2_000)
      .refine(
        (value) => !/[\u0000\u000B\u000C\u007F]/u.test(value),
        "Unsupported control characters are not allowed.",
      )
      .transform((value) => value || null),
    confirmation: z.literal("CONFIRM_EXTERNAL_REFUND_COMPLETED", {
      error:
        "Confirm that the full Wire or Zelle refund was completed outside this site.",
    }),
  })
  .strict();

export type ManualPaymentRefundInput = z.output<
  typeof manualPaymentRefundSchema
>;

const providerPaymentIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/u, "Use the exact NOWPayments payment ID.");

export const NOWPAYMENTS_LINK_FORM_FIELDS = [
  "paymentPublicId",
  "providerPaymentId",
] as const;

export const nowPaymentsLinkSchema = z
  .object({
    paymentPublicId: publicIdSchema,
    providerPaymentId: providerPaymentIdSchema,
  })
  .strict();

export type NowPaymentsLinkInput = z.output<typeof nowPaymentsLinkSchema>;

export const NOWPAYMENTS_CANCEL_UNLINKED_FORM_FIELDS = [
  "paymentPublicId",
  "providerInvoiceId",
  "confirmation",
] as const;

export const nowPaymentsCancelUnlinkedSchema = z
  .object({
    paymentPublicId: publicIdSchema,
    providerInvoiceId: z.string().trim().min(1).max(255),
    confirmation: z.literal("CONFIRM_NO_PROVIDER_PAYMENT", {
      error: "Confirm that the provider dashboard shows no payment for this invoice.",
    }),
  })
  .strict();

export type NowPaymentsCancelUnlinkedInput = z.output<
  typeof nowPaymentsCancelUnlinkedSchema
>;
