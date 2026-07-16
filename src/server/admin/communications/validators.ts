import { z } from "zod";

import { publicIdSchema } from "@/server/admin/audit/validation";

const ISO_WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u;
const DISALLOWED_NOTE_CHARACTER =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

const expectedUpdatedAtSchema = z
  .string()
  .trim()
  .max(40)
  .transform((value, context) => {
    if (!ISO_WITH_TIMEZONE.test(value)) {
      context.addIssue({
        code: "custom",
        message: "The inquiry version is invalid. Refresh and try again.",
      });
      return z.NEVER;
    }
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      context.addIssue({
        code: "custom",
        message: "The inquiry version is invalid. Refresh and try again.",
      });
      return z.NEVER;
    }
    return parsed;
  });

export const UPDATE_INQUIRY_STATUS_FORM_FIELDS = [
  "inquiryPublicId",
  "status",
  "expectedUpdatedAt",
] as const;

export const updateInquiryStatusSchema = z
  .object({
    inquiryPublicId: publicIdSchema,
    status: z.enum([
      "OPEN",
      "IN_PROGRESS",
      "WAITING_CUSTOMER",
      "RESOLVED",
      "CLOSED",
    ]),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .strict();

export const ASSIGN_INQUIRY_FORM_FIELDS = [
  "inquiryPublicId",
  "assignedToUserId",
  "expectedUpdatedAt",
] as const;

export const assignInquirySchema = z
  .object({
    inquiryPublicId: publicIdSchema,
    assignedToUserId: z
      .string()
      .trim()
      .transform((value) => (value.length > 0 ? value : null))
      .pipe(publicIdSchema.nullable()),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .strict();

export const ADD_INQUIRY_NOTE_FORM_FIELDS = [
  "inquiryPublicId",
  "body",
] as const;

export const addInquiryNoteSchema = z
  .object({
    inquiryPublicId: publicIdSchema,
    body: z
      .string()
      .trim()
      .min(1, "Enter an internal note.")
      .max(10_000, "Internal notes are limited to 10,000 characters.")
      .refine(
        (value) => !DISALLOWED_NOTE_CHARACTER.test(value),
        "The note contains unsupported control characters.",
      ),
  })
  .strict();

export const CREATE_WHATSAPP_FOLLOW_UP_FORM_FIELDS = [
  "intentPublicId",
] as const;

export const createWhatsAppFollowUpSchema = z
  .object({ intentPublicId: publicIdSchema })
  .strict();

export type UpdateInquiryStatusInput = z.output<
  typeof updateInquiryStatusSchema
>;
export type AssignInquiryInput = z.output<typeof assignInquirySchema>;
export type AddInquiryNoteInput = z.output<typeof addInquiryNoteSchema>;
export type CreateWhatsAppFollowUpInput = z.output<
  typeof createWhatsAppFollowUpSchema
>;
