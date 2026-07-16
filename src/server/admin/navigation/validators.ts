import { z } from "zod";

import { safeNavigationUrlSchema } from "@/lib/navigation-url";
import {
  checkboxSchema,
  nonNegativePositionSchema,
  publicIdSchema,
} from "@/server/admin/audit/validation";

const NAVIGATION_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
const UNSAFE_SINGLE_LINE_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

const submissionIdSchema = publicIdSchema.transform((value) =>
  value.toLowerCase(),
);

export const navigationKeySchema = z
  .string()
  .max(100)
  .refine(
    (value) => !UNSAFE_SINGLE_LINE_CHARACTERS.test(value) && !/[\r\n]/u.test(value),
    "Key must be one line without control characters.",
  )
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, "Key is required.")
      .max(100)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
        "Use lowercase letters, numbers, and single hyphens only.",
      ),
  );

function singleLineText(label: string, maximum: number) {
  return z
    .string()
    .max(maximum)
    .refine(
      (value) =>
        !UNSAFE_SINGLE_LINE_CHARACTERS.test(value) && !/[\r\n]/u.test(value),
      `${label} must be one line without control characters.`,
    )
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1, `${label} is required.`)
        .max(maximum),
    );
}

const navigationValues = {
  key: navigationKeySchema,
  name: singleLineText("Name", 160),
  status: z.enum(NAVIGATION_STATUSES),
} as const;

const itemValues = {
  label: singleLineText("Label", 160),
  url: safeNavigationUrlSchema,
  position: nonNegativePositionSchema,
  isVisible: checkboxSchema,
  openInNewTab: checkboxSchema,
} as const;

export const NAVIGATION_CREATE_FORM_FIELDS = [
  "submissionId",
  "key",
  "name",
  "status",
] as const;

export const NAVIGATION_UPDATE_FORM_FIELDS = [
  "publicId",
  "key",
  "name",
  "status",
] as const;

export const NAVIGATION_ITEM_CREATE_FORM_FIELDS = [
  "submissionId",
  "navigationPublicId",
  "label",
  "url",
  "position",
  "isVisible",
  "openInNewTab",
] as const;

export const NAVIGATION_ITEM_UPDATE_FORM_FIELDS = [
  "publicId",
  "navigationPublicId",
  "label",
  "url",
  "position",
  "isVisible",
  "openInNewTab",
] as const;

export const navigationCreateFormSchema = z
  .object({ submissionId: submissionIdSchema, ...navigationValues })
  .strict();

export const navigationUpdateFormSchema = z
  .object({ publicId: publicIdSchema, ...navigationValues })
  .strict();

export const navigationItemCreateFormSchema = z
  .object({
    submissionId: submissionIdSchema,
    navigationPublicId: publicIdSchema,
    ...itemValues,
  })
  .strict();

export const navigationItemUpdateFormSchema = z
  .object({
    publicId: publicIdSchema,
    navigationPublicId: publicIdSchema,
    ...itemValues,
  })
  .strict();

export type NavigationCreateFormInput = z.output<
  typeof navigationCreateFormSchema
>;
export type NavigationUpdateFormInput = z.output<
  typeof navigationUpdateFormSchema
>;
export type NavigationItemCreateFormInput = z.output<
  typeof navigationItemCreateFormSchema
>;
export type NavigationItemUpdateFormInput = z.output<
  typeof navigationItemUpdateFormSchema
>;
