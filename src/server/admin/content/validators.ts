import { z } from "zod";

import {
  inspectManagedPageBody,
  MANAGED_PAGE_BODY_MAX_LENGTH,
} from "@/lib/managed-page-content";
import {
  isReservedManagedPageSlug,
  MANAGED_PAGE_ROUTES,
} from "@/lib/managed-page-routes";
import {
  nonNegativePositionSchema,
  nullableText,
  publicIdSchema,
  publishedAtSchema,
} from "@/server/admin/audit/validation";

const CONTENT_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
const CONTENT_FORMATS = ["MARKDOWN", "RICH_TEXT", "HTML"] as const;

const contentSlugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required.")
  .max(220)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
    "Use lowercase letters, numbers, and single hyphens only.",
  )
  .refine(
    (slug) => !isReservedManagedPageSlug(slug),
    "That slug is reserved for a managed storefront route.",
  );

function requirePublishedAt(
  data: { status: (typeof CONTENT_STATUSES)[number]; publishedAt: Date | null },
  context: z.RefinementCtx,
) {
  if (data.status === "PUBLISHED" && data.publishedAt === null) {
    context.addIssue({
      code: "custom",
      path: ["publishedAt"],
      message: "Published content requires a publish time.",
    });
  }
}

const BLOG_VALUE_FIELDS = [
  "title",
  "category",
  "authorDisplayName",
  "readingMinutes",
  "excerpt",
  "body",
  "format",
  "status",
  "publishedAt",
] as const;

export const BLOG_CREATE_FORM_FIELDS = [
  "slug",
  ...BLOG_VALUE_FIELDS,
] as const;

export const BLOG_FORM_FIELDS = ["publicId", ...BLOG_VALUE_FIELDS] as const;

const readingMinutesSchema = z
  .string()
  .trim()
  .transform((value, context) => {
    if (value.length === 0) {
      return null;
    }
    if (!/^\d+$/u.test(value)) {
      context.addIssue({ code: "custom", message: "Reading time must be a whole number." });
      return z.NEVER;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) {
      context.addIssue({ code: "custom", message: "Reading time must be between 1 and 1000 minutes." });
      return z.NEVER;
    }
    return parsed;
  });

const blogValues = {
  title: z.string().trim().min(1, "Title is required.").max(255),
  category: nullableText(160),
  authorDisplayName: nullableText(255),
  readingMinutes: readingMinutesSchema,
  excerpt: nullableText(10_000),
  body: z
    .string()
    .max(500_000)
    .refine((value) => value.trim().length > 0, "Body is required."),
  format: z.enum(CONTENT_FORMATS),
  status: z.enum(CONTENT_STATUSES),
  publishedAt: publishedAtSchema,
} as const;

export const blogCreateFormSchema = z
  .object({ slug: contentSlugSchema, ...blogValues })
  .strict()
  .superRefine(requirePublishedAt);

export const blogFormSchema = z
  .object({ publicId: publicIdSchema, ...blogValues })
  .strict()
  .superRefine(requirePublishedAt);

export type BlogCreateFormInput = z.output<typeof blogCreateFormSchema>;
export type BlogFormInput = z.output<typeof blogFormSchema>;

export const PAGE_CREATE_FORM_FIELDS = [
  "slug",
  "title",
  "body",
  "format",
  "status",
  "publishedAt",
] as const;

export const PAGE_UPDATE_FORM_FIELDS = [
  "publicId",
  ...PAGE_CREATE_FORM_FIELDS,
] as const;

const pageValuesSchema = z
  .object({
    slug: contentSlugSchema,
    title: z.string().trim().min(1, "Title is required.").max(255),
    body: z
      .string()
      .max(500_000)
      .refine((value) => value.trim().length > 0, "Body is required."),
    format: z.enum(CONTENT_FORMATS),
    status: z.enum(CONTENT_STATUSES),
    publishedAt: publishedAtSchema,
  })
  .strict()
  .superRefine(requirePublishedAt);

export const pageCreateFormSchema = pageValuesSchema;
export const pageUpdateFormSchema = z
  .object({
    publicId: publicIdSchema,
    slug: contentSlugSchema,
    title: z.string().trim().min(1, "Title is required.").max(255),
    body: z
      .string()
      .max(500_000)
      .refine((value) => value.trim().length > 0, "Body is required."),
    format: z.enum(CONTENT_FORMATS),
    status: z.enum(CONTENT_STATUSES),
    publishedAt: publishedAtSchema,
  })
  .strict()
  .superRefine(requirePublishedAt);

export type PageCreateFormInput = z.output<typeof pageCreateFormSchema>;
export type PageUpdateFormInput = z.output<typeof pageUpdateFormSchema>;

export const MANAGED_PAGE_FORM_FIELDS = [
  "routeKey",
  "title",
  "body",
  "status",
  "publishedAt",
] as const;

function managedPageBodyMessage(value: string) {
  const issue = inspectManagedPageBody(value);
  if (issue === null) return null;
  if (issue === "empty") return "Body is required.";
  if (issue === "too_long") return "Body is too long.";
  if (issue === "control_character") {
    return "Body contains an unsupported control character.";
  }
  if (issue === "html") {
    return "HTML and angle-bracket markup are not allowed. Use plain text, headings, and lists.";
  }
  if (issue === "personal_information") {
    return "Do not publish email addresses, phone numbers, government identifiers, or other personal information here.";
  }
  return "Do not publish payment destinations, bank details, API/IPN secrets, passwords, tokens, private keys, recovery phrases, or wallet addresses here.";
}

export const managedPageFormSchema = z
  .object({
    routeKey: z.enum(MANAGED_PAGE_ROUTES),
    title: z.string().trim().min(1, "Title is required.").max(255),
    body: z.string().max(MANAGED_PAGE_BODY_MAX_LENGTH),
    status: z.enum(CONTENT_STATUSES),
    publishedAt: publishedAtSchema,
  })
  .strict()
  .superRefine((data, context) => {
    requirePublishedAt(data, context);
    const titleIssue = managedPageBodyMessage(data.title);
    if (titleIssue) {
      context.addIssue({ code: "custom", path: ["title"], message: titleIssue });
    }
    const bodyIssue = managedPageBodyMessage(data.body);
    if (bodyIssue) {
      context.addIssue({ code: "custom", path: ["body"], message: bodyIssue });
    }
  });

export type ManagedPageFormInput = z.output<typeof managedPageFormSchema>;

export const FAQ_CREATE_FORM_FIELDS = [
  "slug",
  "question",
  "answer",
  "category",
  "position",
  "status",
  "publishedAt",
] as const;

export const FAQ_UPDATE_FORM_FIELDS = [
  "publicId",
  ...FAQ_CREATE_FORM_FIELDS,
] as const;

const faqValues = {
  slug: contentSlugSchema,
  question: z.string().trim().min(1, "Question is required.").max(500),
  answer: z
    .string()
    .max(100_000)
    .refine((value) => value.trim().length > 0, "Answer is required."),
  category: nullableText(160),
  position: nonNegativePositionSchema,
  status: z.enum(CONTENT_STATUSES),
  publishedAt: publishedAtSchema,
} as const;

export const faqCreateFormSchema = z
  .object(faqValues)
  .strict()
  .superRefine(requirePublishedAt);

export const faqUpdateFormSchema = z
  .object({ publicId: publicIdSchema, ...faqValues })
  .strict()
  .superRefine(requirePublishedAt);

export type FaqCreateFormInput = z.output<typeof faqCreateFormSchema>;
export type FaqUpdateFormInput = z.output<typeof faqUpdateFormSchema>;
