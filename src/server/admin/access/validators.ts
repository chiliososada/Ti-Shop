import { z } from "zod";

import { publicIdSchema } from "@/server/admin/audit/validation";

export const ROLE_ASSIGNMENT_FIELDS = ["userPublicId", "roleSlug"] as const;
export const ADMIN_STATUS_FIELDS = ["userPublicId", "isActive"] as const;

const systemRoleSlugSchema = z
  .string()
  .trim()
  .min(1, "Select a system role.")
  .max(80)
  .regex(
    /^[a-z][a-z0-9_]*$/u,
    "The system role identifier is invalid.",
  );

export const roleAssignmentSchema = z
  .object({
    userPublicId: publicIdSchema,
    roleSlug: systemRoleSlugSchema,
  })
  .strict();

export const adminStatusSchema = z
  .object({
    userPublicId: publicIdSchema,
    isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
  })
  .strict();

const auditDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "Use a date in YYYY-MM-DD format.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value);
  }, "The date is invalid.");

const optionalFilterText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined));

const optionalPublicId = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined))
  .pipe(publicIdSchema.optional());

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined))
  .pipe(auditDateSchema.optional());

export const auditFilterSchema = z
  .object({
    action: optionalFilterText(160),
    resourceType: optionalFilterText(120),
    actorPublicId: optionalPublicId,
    from: optionalDate,
    to: optionalDate,
    page: z
      .string()
      .trim()
      .regex(/^\d+$/u)
      .transform(Number)
      .refine((value) => Number.isSafeInteger(value) && value >= 1 && value <= 10_000)
      .default(1),
    pageSize: z
      .enum(["25", "50", "100"])
      .transform(Number)
      .default(50),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "The end date must be on or after the start date.",
      });
    }
  });

export type RoleAssignmentInput = z.output<typeof roleAssignmentSchema>;
export type AdminStatusInput = z.output<typeof adminStatusSchema>;
export type AuditFilters = z.output<typeof auditFilterSchema>;

export const DEFAULT_AUDIT_FILTERS: AuditFilters = {
  action: undefined,
  resourceType: undefined,
  actorPublicId: undefined,
  from: undefined,
  to: undefined,
  page: 1,
  pageSize: 50,
};
