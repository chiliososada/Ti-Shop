import { z } from "zod";

import { parseDecimal } from "@/server/payments/nowpayments/decimal";

const publicId = z.uuid();

const nonNegativeCnyMinor = z
  .string()
  .trim()
  // An empty input means zero; typed values must look like 1234.56.
  .regex(/^(?:\d{1,13}(?:\.\d{1,2})?)?$/u, "Use a CNY amount like 1234.56")
  .transform((value) => {
    const parsed = parseDecimal(value === "" ? "0" : value);
    return parsed.coefficient * BigInt(10) ** BigInt(2 - parsed.scale);
  });

export const SUPPLIER_FORM_FIELDS = [
  "publicId",
  "name",
  "contactName",
  "contactDetails",
  "notes",
  "isActive",
] as const;

export const supplierFormSchema = z.object({
  publicId: publicId.optional(),
  name: z.string().trim().min(1).max(255),
  contactName: z.string().trim().max(160).optional().default(""),
  contactDetails: z.string().trim().max(4_000).optional().default(""),
  notes: z.string().trim().max(4_000).optional().default(""),
  isActive: z.enum(["true", "false"]).optional().default("true"),
});

export type SupplierFormInput = z.infer<typeof supplierFormSchema>;

export const PROCUREMENT_FORM_FIELDS = [
  "publicId",
  "supplierPublicId",
  "status",
  "domesticShipping",
  "internationalShipping",
  "customs",
  "procurementFee",
  "packaging",
  "otherCost",
  "orderedAt",
  "paidAt",
  "notes",
] as const;

export const procurementFormSchema = z.object({
  publicId: publicId.optional(),
  supplierPublicId: publicId,
  status: z.enum(["DRAFT", "ORDERED", "PAID"]).default("DRAFT"),
  domesticShipping: nonNegativeCnyMinor.default("0" as never),
  internationalShipping: nonNegativeCnyMinor.default("0" as never),
  customs: nonNegativeCnyMinor.default("0" as never),
  procurementFee: nonNegativeCnyMinor.default("0" as never),
  packaging: nonNegativeCnyMinor.default("0" as never),
  otherCost: nonNegativeCnyMinor.default("0" as never),
  orderedAt: z.string().trim().max(40).optional().default(""),
  paidAt: z.string().trim().max(40).optional().default(""),
  notes: z.string().trim().max(4_000).optional().default(""),
});

export type ProcurementFormInput = z.infer<typeof procurementFormSchema>;

export const PROCUREMENT_ITEM_FORM_FIELDS = [
  "procurementPublicId",
  "itemPublicId",
  "variantPublicId",
  "quantity",
  "unitPriceCny",
  "remove",
] as const;

export const procurementItemFormSchema = z.object({
  procurementPublicId: publicId,
  itemPublicId: publicId.optional(),
  variantPublicId: publicId.optional(),
  quantity: z.coerce.number().int().min(1).max(1_000_000).optional(),
  unitPriceCny: nonNegativeCnyMinor.optional(),
  remove: z.enum(["true"]).optional(),
});

export type ProcurementItemFormInput = z.infer<typeof procurementItemFormSchema>;

export const PROCUREMENT_FX_FORM_FIELDS = [
  "procurementPublicId",
  "fxRate",
  "fxRateDate",
  "fxRateSource",
  "fxRateNote",
] as const;

export const procurementFxFormSchema = z.object({
  procurementPublicId: publicId,
  fxRate: z.string().trim().min(1).max(24),
  fxRateDate: z.string().trim().max(40).optional().default(""),
  fxRateSource: z.enum(["MANUAL", "API"]).default("MANUAL"),
  fxRateNote: z.string().trim().max(500).optional().default(""),
});

export type ProcurementFxFormInput = z.infer<typeof procurementFxFormSchema>;

export const PROCUREMENT_RECEIVE_FORM_FIELDS = [
  "procurementPublicId",
  "locationPublicId",
  "receivedAt",
] as const;

export const procurementReceiveFormSchema = z.object({
  procurementPublicId: publicId,
  locationPublicId: publicId,
  receivedAt: z.string().trim().max(40).optional().default(""),
});

export type ProcurementReceiveFormInput = z.infer<typeof procurementReceiveFormSchema>;

export function parseOptionalInstant(value: string, label: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} must be an ISO date-time.`);
  }
  return date;
}
