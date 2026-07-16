import { z } from "zod";

import {
  checkboxSchema,
  nonNegativePositionSchema,
  publicIdSchema,
} from "@/server/admin/audit/validation";

const CATALOG_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

const normalizedPublicIdSchema = publicIdSchema.transform((value) =>
  value.toLowerCase(),
);

function slug(label: string, maximum: number) {
  return z
    .string()
    .min(1, `${label} is required.`)
    .max(maximum)
    .refine(
      (value) => value === value.trim(),
      `${label} cannot contain surrounding whitespace.`,
    )
    .regex(
      SAFE_SLUG,
      `${label} must use lowercase letters, numbers, and single hyphens only.`,
    );
}

function singleLineName(label: string, maximum: number) {
  return z
    .string()
    .max(maximum)
    .refine(
      (value) =>
        !CONTROL_CHARACTERS.test(value) && !/[\r\n]/u.test(value),
      `${label} must be one line without control characters.`,
    )
    .transform((value) => value.trim())
    .pipe(z.string().min(1, `${label} is required.`).max(maximum));
}

export const merchandisingPlacementKeySchema = slug("Placement key", 100);

export const TAG_CREATE_FORM_FIELDS = [
  "submissionId",
  "slug",
  "name",
  "status",
] as const;

export const TAG_UPDATE_FORM_FIELDS = [
  "publicId",
  "slug",
  "name",
  "status",
] as const;

export const TAG_ARCHIVE_OR_DELETE_FORM_FIELDS = ["publicId"] as const;

export const PRODUCT_TAG_ASSIGNMENT_FORM_FIELDS = [
  "productPublicId",
  "tagPublicIds",
] as const;

export const PLACEMENT_CREATE_FORM_FIELDS = [
  "submissionId",
  "placementKey",
  "productPublicId",
  "position",
  "isActive",
] as const;

export const PLACEMENT_UPDATE_FORM_FIELDS = [
  "placementPublicId",
  "placementKey",
  "position",
  "isActive",
] as const;

export const PLACEMENT_DELETE_FORM_FIELDS = [
  "placementPublicId",
  "placementKey",
] as const;

const tagValues = {
  slug: slug("Tag slug", 180),
  name: singleLineName("Tag name", 160),
  status: z.enum(CATALOG_STATUSES),
} as const;

export const tagCreateFormSchema = z
  .object({ submissionId: normalizedPublicIdSchema, ...tagValues })
  .strict();

export const tagUpdateFormSchema = z
  .object({ publicId: normalizedPublicIdSchema, ...tagValues })
  .strict();

export const tagArchiveOrDeleteFormSchema = z
  .object({ publicId: normalizedPublicIdSchema })
  .strict();

export const productTagAssignmentFormSchema = z
  .object({
    productPublicId: normalizedPublicIdSchema,
    tagPublicIds: z
      .array(normalizedPublicIdSchema)
      .max(100, "A product can have at most 100 tags.")
      .refine(
        (values) => new Set(values).size === values.length,
        "Each tag may be selected only once.",
      )
      .transform((values) => [...values].sort()),
  })
  .strict();

export const placementCreateFormSchema = z
  .object({
    submissionId: normalizedPublicIdSchema,
    placementKey: merchandisingPlacementKeySchema,
    productPublicId: normalizedPublicIdSchema,
    position: nonNegativePositionSchema,
    isActive: checkboxSchema,
  })
  .strict();

export const placementUpdateFormSchema = z
  .object({
    placementPublicId: normalizedPublicIdSchema,
    placementKey: merchandisingPlacementKeySchema,
    position: nonNegativePositionSchema,
    isActive: checkboxSchema,
  })
  .strict();

export const placementDeleteFormSchema = z
  .object({
    placementPublicId: normalizedPublicIdSchema,
    placementKey: merchandisingPlacementKeySchema,
  })
  .strict();

export type TagCreateFormInput = z.output<typeof tagCreateFormSchema>;
export type TagUpdateFormInput = z.output<typeof tagUpdateFormSchema>;
export type TagArchiveOrDeleteFormInput = z.output<
  typeof tagArchiveOrDeleteFormSchema
>;
export type ProductTagAssignmentFormInput = z.output<
  typeof productTagAssignmentFormSchema
>;
export type PlacementCreateFormInput = z.output<
  typeof placementCreateFormSchema
>;
export type PlacementUpdateFormInput = z.output<
  typeof placementUpdateFormSchema
>;
export type PlacementDeleteFormInput = z.output<
  typeof placementDeleteFormSchema
>;

