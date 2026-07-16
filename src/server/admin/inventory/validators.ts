import { z } from "zod";

import {
  checkboxSchema,
  nullableText,
  publicIdSchema,
} from "@/server/admin/audit/validation";

export const CREATE_LOCATION_FIELDS = [
  "code",
  "name",
  "countryCode",
  "region",
  "city",
  "isActive",
] as const;

export const UPDATE_LOCATION_FIELDS = [
  "publicId",
  ...CREATE_LOCATION_FIELDS,
] as const;

export const ADJUST_INVENTORY_FIELDS = [
  "idempotencyKey",
  "locationPublicId",
  "variantPublicId",
  "quantityDelta",
  "reason",
] as const;

const locationCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, "Location code is required.")
  .max(80)
  .regex(
    /^[A-Z0-9][A-Z0-9_-]*$/u,
    "Use uppercase letters, numbers, underscores, or hyphens.",
  );

const locationFields = {
  code: locationCodeSchema,
  name: z.string().trim().min(1, "Location name is required.").max(180),
  countryCode: z.literal("US"),
  region: nullableText(120),
  city: nullableText(120),
  isActive: checkboxSchema,
} as const;

export const createLocationSchema = z.object(locationFields).strict();

export const updateLocationSchema = z
  .object({ publicId: publicIdSchema, ...locationFields })
  .strict();

const quantityDeltaSchema = z
  .string()
  .trim()
  .regex(/^-?(?:0|[1-9]\d{0,8})$/u, "Enter a whole-number stock change.")
  .transform(Number)
  .refine(Number.isSafeInteger, "Enter a safe whole number.")
  .refine((value) => value !== 0, "The stock change cannot be zero.");

export const adjustInventorySchema = z
  .object({
    idempotencyKey: z.uuid("Invalid submission identifier."),
    locationPublicId: publicIdSchema,
    variantPublicId: publicIdSchema,
    quantityDelta: quantityDeltaSchema,
    reason: z
      .string()
      .trim()
      .min(3, "Provide a reason for the adjustment.")
      .max(2_000),
  })
  .strict();

export type CreateLocationInput = z.output<typeof createLocationSchema>;
export type UpdateLocationInput = z.output<typeof updateLocationSchema>;
export type AdjustInventoryInput = z.output<typeof adjustInventorySchema>;
