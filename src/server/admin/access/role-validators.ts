import { z } from "zod";

import { publicIdSchema } from "@/server/admin/audit/validation";
import { PERMISSION_SLUGS } from "@/server/auth/permissions";

const UNSAFE_TEXT_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

const roleNameSchema = z
  .string()
  .max(120)
  .refine(
    (value) =>
      !UNSAFE_TEXT_CHARACTERS.test(value) && !/[\r\n]/u.test(value),
    "Name must be one line without control characters.",
  )
  .transform((value) => value.trim())
  .pipe(z.string().min(2, "Name must contain at least 2 characters.").max(120));

const roleDescriptionSchema = z
  .string()
  .max(2_000)
  .refine(
    (value) => !UNSAFE_TEXT_CHARACTERS.test(value),
    "Description cannot contain control characters.",
  )
  .transform((value) => value.trim() || null);

const permissionSlugArraySchema = z
  .array(z.enum(PERMISSION_SLUGS))
  .max(PERMISSION_SLUGS.length)
  .refine(
    (values) => new Set(values).size === values.length,
    "Permission identifiers cannot be duplicated.",
  )
  .refine(
    (values) => values.includes("admin.access"),
    "Administrator access is required for an administrator role.",
  )
  .transform((values) => [...values].sort());

const serializedPermissionsSchema = z
  .string()
  .trim()
  .min(2, "Select at least the administrator access permission.")
  .max(4_096)
  .transform((value, context): unknown => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      context.addIssue({
        code: "custom",
        message: "The permission selection is invalid. Refresh and try again.",
      });
      return z.NEVER;
    }
  })
  .pipe(permissionSlugArraySchema);

const roleValues = {
  name: roleNameSchema,
  description: roleDescriptionSchema,
  permissionSlugs: serializedPermissionsSchema,
} as const;

export const CUSTOM_ROLE_CREATE_FIELDS = [
  "submissionId",
  "name",
  "description",
  "permissionSlugs",
] as const;

export const CUSTOM_ROLE_UPDATE_FIELDS = [
  "publicId",
  "name",
  "description",
  "permissionSlugs",
] as const;

export const CUSTOM_ROLE_DELETE_FIELDS = ["publicId"] as const;

export const CUSTOM_ROLE_ASSIGNMENT_FIELDS = [
  "userPublicId",
  "rolePublicId",
] as const;

export const customRoleCreateSchema = z
  .object({ submissionId: publicIdSchema, ...roleValues })
  .strict();

export const customRoleUpdateSchema = z
  .object({ publicId: publicIdSchema, ...roleValues })
  .strict();

export const customRoleDeleteSchema = z
  .object({ publicId: publicIdSchema })
  .strict();

export const customRoleAssignmentSchema = z
  .object({
    userPublicId: publicIdSchema,
    rolePublicId: publicIdSchema,
  })
  .strict();

export type CustomRoleCreateInput = z.output<typeof customRoleCreateSchema>;
export type CustomRoleUpdateInput = z.output<typeof customRoleUpdateSchema>;
export type CustomRoleDeleteInput = z.output<typeof customRoleDeleteSchema>;
export type CustomRoleAssignmentInput = z.output<
  typeof customRoleAssignmentSchema
>;
