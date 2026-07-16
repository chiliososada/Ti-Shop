import { z } from "zod";

import { normalizeCanonicalUrl } from "@/lib/canonical-url";
import {
  checkboxSchema,
  nullableText,
  publicIdSchema,
} from "@/server/admin/audit/validation";
import {
  isRedirectablePublicPath,
  isSafeRootRelativePath,
} from "@/server/seo/redirect-policy";

export const SEO_ENTITY_TYPES = ["product", "category", "blog", "page"] as const;
export type SeoEntityType = (typeof SEO_ENTITY_TYPES)[number];

export const SEO_FORM_FIELDS = [
  "entityType",
  "targetPublicId",
  "title",
  "description",
  "canonicalUrl",
  "openGraphMediaPublicId",
  "noIndex",
] as const;

const canonicalSchema = z
  .string()
  .max(2_048)
  .transform((value, context) => {
    if (value.trim().length === 0) return null;
    const normalized = normalizeCanonicalUrl(value);
    if (!normalized) {
      context.addIssue({
        code: "custom",
        message:
          "Use a public root-relative path or credential-free HTTPS URL without query parameters or a fragment.",
      });
      return z.NEVER;
    }
    return normalized;
  });

const optionalMediaPublicIdSchema = z
  .union([z.literal(""), publicIdSchema])
  .transform((value) => (value.length > 0 ? value : null));

export const seoFormSchema = z
  .object({
    entityType: z.enum(SEO_ENTITY_TYPES),
    targetPublicId: publicIdSchema,
    title: nullableText(255),
    description: nullableText(500),
    canonicalUrl: canonicalSchema,
    openGraphMediaPublicId: optionalMediaPublicIdSchema,
    noIndex: checkboxSchema,
  })
  .strict();

export const seoRouteSchema = z.object({
  entityType: z.enum(SEO_ENTITY_TYPES),
  publicId: publicIdSchema,
});

export type SeoFormInput = z.output<typeof seoFormSchema>;

export const REDIRECT_CREATE_FORM_FIELDS = [
  "sourcePath",
  "destinationPath",
  "statusCode",
  "preserveQuery",
  "isActive",
  "startsAt",
  "endsAt",
] as const;

export const REDIRECT_UPDATE_FORM_FIELDS = [
  "publicId",
  ...REDIRECT_CREATE_FORM_FIELDS,
] as const;

const redirectPathSchema = z
  .string()
  .trim()
  .min(1, "Path is required.")
  .max(2_048)
  .refine(
    isSafeRootRelativePath,
    "Use a root-relative path without a host, scheme, query, fragment, control character, or backslash.",
  );

const redirectSourcePathSchema = redirectPathSchema.refine(
  isRedirectablePublicPath,
  "Redirect sources cannot target private, API, checkout, account, admin, static, or file paths.",
);

const redirectStatusSchema = z
  .enum(["301", "308"])
  .transform((value) => Number(value) as 301 | 308);

const optionalRedirectTimeSchema = z
  .string()
  .trim()
  .max(40)
  .transform((value, context) => {
    if (!value) return null;
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
        value,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Use an ISO timestamp with an explicit timezone.",
      });
      return z.NEVER;
    }
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      context.addIssue({ code: "custom", message: "Timestamp is invalid." });
      return z.NEVER;
    }
    return parsed;
  });

const redirectValues = {
  sourcePath: redirectSourcePathSchema,
  destinationPath: redirectPathSchema,
  statusCode: redirectStatusSchema,
  preserveQuery: checkboxSchema,
  isActive: checkboxSchema,
  startsAt: optionalRedirectTimeSchema,
  endsAt: optionalRedirectTimeSchema,
} as const;

function validateRedirectWindow(
  data: { sourcePath: string; destinationPath: string; startsAt: Date | null; endsAt: Date | null },
  context: z.RefinementCtx,
) {
  if (data.sourcePath === data.destinationPath) {
    context.addIssue({
      code: "custom",
      path: ["destinationPath"],
      message: "Source and destination must be different.",
    });
  }
  if (data.startsAt && data.endsAt && data.startsAt >= data.endsAt) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "End time must be later than start time.",
    });
  }
}

export const redirectCreateFormSchema = z
  .object(redirectValues)
  .strict()
  .superRefine(validateRedirectWindow);

export const redirectUpdateFormSchema = z
  .object({ publicId: publicIdSchema, ...redirectValues })
  .strict()
  .superRefine(validateRedirectWindow);

export type RedirectCreateFormInput = z.output<typeof redirectCreateFormSchema>;
export type RedirectUpdateFormInput = z.output<typeof redirectUpdateFormSchema>;
