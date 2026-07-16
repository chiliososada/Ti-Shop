import { z } from "zod";

import { parseDecimal } from "@/server/payments/nowpayments/decimal";

const publicId = z.uuid();

const usdMinor = z
  .string()
  .trim()
  // An empty input means zero; typed values must look like 12.34.
  .regex(/^(?:\d{1,13}(?:\.\d{1,2})?)?$/u, "Use a USD amount like 12.34")
  .transform((value) => {
    const parsed = parseDecimal(value === "" ? "0" : value);
    return parsed.coefficient * BigInt(10) ** BigInt(2 - parsed.scale);
  });

export const AFTER_SALES_EVENT_FORM_FIELDS = [
  "publicId",
  "orderPublicId",
  "responsibility",
  "reason",
  "refundAmount",
  "shippingRefund",
  "returnShippingCost",
  "compensationShippingCost",
  "evidenceNotes",
] as const;

export const afterSalesEventFormSchema = z.object({
  publicId: publicId.optional(),
  orderPublicId: publicId,
  responsibility: z
    .enum(["MERCHANT", "CARRIER", "SUPPLIER", "CUSTOMER", "OTHER"])
    .default("MERCHANT"),
  reason: z.string().trim().min(1).max(4_000),
  refundAmount: usdMinor.default("0" as never),
  shippingRefund: usdMinor.default("0" as never),
  returnShippingCost: usdMinor.default("0" as never),
  compensationShippingCost: usdMinor.default("0" as never),
  evidenceNotes: z.string().trim().max(8_000).optional().default(""),
});

export type AfterSalesEventFormInput = z.infer<typeof afterSalesEventFormSchema>;

export const AFTER_SALES_ITEM_FORM_FIELDS = [
  "eventPublicId",
  "itemPublicId",
  "kind",
  "orderItemId",
  "variantPublicId",
  "quantity",
  "disposition",
  "compensationDelivery",
  "remove",
] as const;

export const afterSalesItemFormSchema = z.object({
  eventPublicId: publicId,
  itemPublicId: publicId.optional(),
  kind: z.enum(["RETURN", "COMPENSATION"]).optional(),
  orderItemId: z.string().trim().regex(/^\d+$/u).optional().or(z.literal("")),
  variantPublicId: publicId.optional(),
  quantity: z.coerce.number().int().min(1).max(100_000).optional(),
  disposition: z
    .enum(["RESALABLE", "DAMAGED", "LOST", "DESTROYED"])
    .optional()
    .or(z.literal("")),
  compensationDelivery: z
    .enum(["DEDICATED_SHIPMENT", "NEXT_ORDER"])
    .optional()
    .or(z.literal("")),
  remove: z.enum(["true"]).optional(),
});

export type AfterSalesItemFormInput = z.infer<typeof afterSalesItemFormSchema>;

export const AFTER_SALES_COMPLETE_FORM_FIELDS = [
  "eventPublicId",
  "locationPublicId",
] as const;

export const afterSalesCompleteFormSchema = z.object({
  eventPublicId: publicId,
  locationPublicId: publicId.optional().or(z.literal("")),
});

export type AfterSalesCompleteFormInput = z.infer<typeof afterSalesCompleteFormSchema>;

export const AFTER_SALES_ATTACH_FORM_FIELDS = [
  "eventPublicId",
  "itemPublicId",
  "targetOrderPublicId",
] as const;

export const afterSalesAttachFormSchema = z.object({
  eventPublicId: publicId,
  itemPublicId: publicId,
  targetOrderPublicId: publicId,
});

export type AfterSalesAttachFormInput = z.infer<typeof afterSalesAttachFormSchema>;
