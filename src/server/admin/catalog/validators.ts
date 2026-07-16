import { z } from "zod";

import {
  checkboxSchema,
  nonNegativePositionSchema,
  nullableText,
  publicIdSchema,
  publishedAtSchema,
} from "@/server/admin/audit/validation";

const PRODUCT_STATUS_SCHEMA = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
const PRICE_MODE_SCHEMA = z.enum(["FIXED", "ON_REQUEST"]);
const PRODUCT_MEDIA_ROLE_SCHEMA = z.enum([
  "PRIMARY",
  "GALLERY",
  "SWATCH",
  "VIDEO",
  "DOCUMENT",
]);
const MEDIA_KIND_SCHEMA = z.enum(["IMAGE", "VIDEO", "DOCUMENT"]);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/u;
const OPTION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u;
const BLOCKED_OPTION_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "minimumOrderQuantity",
]);

export const PRODUCT_FORM_FIELDS = [
  "publicId",
  "title",
  "subtitle",
  "shortDescription",
  "description",
  "brand",
  "purity",
  "casNumber",
  "appearance",
  "storageInstructions",
  "status",
  "publishedAt",
  "isFeatured",
  "position",
] as const;

export const CREATE_PRODUCT_FORM_FIELDS = ["slug", "title", "position"] as const;

export const CATEGORY_FORM_FIELDS = [
  "publicId",
  "name",
  "description",
  "status",
  "publishedAt",
  "position",
] as const;

export const CREATE_CATEGORY_FORM_FIELDS = ["slug", "name", "position"] as const;

export const VARIANT_FORM_FIELDS = [
  "productPublicId",
  "variantPublicId",
  "title",
  "sku",
  "status",
  "priceMode",
  "usdPrice",
  "minimumOrderQuantity",
  "position",
  "publishedAt",
  "trackInventory",
  "optionValues",
] as const;

export const CREATE_VARIANT_FORM_FIELDS = VARIANT_FORM_FIELDS.filter(
  (field) => field !== "variantPublicId",
);

export const VARIANT_PRICE_FORM_FIELDS = [
  "productPublicId",
  "variantPublicId",
  "priceMode",
  "usdPrice",
] as const;

export const CATEGORY_ASSIGNMENT_FORM_FIELDS = [
  "productPublicId",
  "primaryCategoryPublicId",
  "categoryPublicIds",
] as const;

export const CREATE_PRODUCT_MEDIA_FORM_FIELDS = [
  "productPublicId",
  "existingMediaPublicId",
  "sourceUrl",
  "kind",
  "variantPublicId",
  "role",
  "altText",
  "position",
] as const;

export const UPDATE_PRODUCT_MEDIA_FORM_FIELDS = [
  "productPublicId",
  "mediaPublicId",
  "variantPublicId",
  "role",
  "altText",
  "position",
] as const;

export const DETACH_PRODUCT_MEDIA_FORM_FIELDS = [
  "productPublicId",
  "mediaPublicId",
] as const;

function slugSchema(maximum: number) {
  return z
    .string()
    .min(1, "Slug is required.")
    .max(maximum)
    .refine((value) => value === value.trim(), "Slug cannot contain surrounding whitespace.")
    .regex(
      SLUG_PATTERN,
      "Use lowercase letters, numbers, and single hyphens only.",
    );
}

const nullablePublicIdSchema = z
  .string()
  .trim()
  .transform((value) => (value.length ? value : null))
  .pipe(publicIdSchema.nullable());

const nullableSkuSchema = z
  .string()
  .trim()
  .transform((value) => (value.length ? value : null))
  .refine(
    (value) => value === null || SKU_PATTERN.test(value),
    "SKU must start with a letter or number and use only letters, numbers, dot, underscore, slash, or hyphen.",
  );

const positiveQuantitySchema = z
  .string()
  .trim()
  .regex(/^\d+$/u, "Minimum order quantity must be a whole number.")
  .transform(Number)
  .refine(Number.isSafeInteger, "Minimum order quantity is too large.")
  .refine(
    (value) => value >= 1 && value <= 99,
    "Minimum order quantity must be between 1 and 99 for direct checkout.",
  );

export type VariantOptionPrimitive = string | number | boolean | null;
export type VariantOptionValues = Record<string, VariantOptionPrimitive>;

function parseOptionValues(value: string): VariantOptionValues | null {
  const normalized = value.trim();
  if (!normalized) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    return null;
  }

  const entries = Object.entries(parsed);
  if (entries.length > 40) return null;
  const result: VariantOptionValues = {};
  for (const [key, item] of entries) {
    if (
      !OPTION_KEY_PATTERN.test(key) ||
      BLOCKED_OPTION_KEYS.has(key) ||
      (typeof item !== "string" &&
        typeof item !== "number" &&
        typeof item !== "boolean" &&
        item !== null) ||
      (typeof item === "number" && !Number.isFinite(item)) ||
      (typeof item === "string" && item.length > 500)
    ) {
      return null;
    }
    result[key] = item;
  }
  return result;
}

const optionValuesSchema = z
  .string()
  .max(10_000)
  .transform((value, context) => {
    const parsed = parseOptionValues(value);
    if (parsed === null) {
      context.addIssue({
        code: "custom",
        message:
          "Option values must be a JSON object with primitive values and safe keys.",
      });
      return z.NEVER;
    }
    return parsed;
  });

export const productFormSchema = z
  .object({
    publicId: publicIdSchema,
    title: z.string().trim().min(1, "Title is required.").max(255),
    subtitle: nullableText(255),
    shortDescription: nullableText(10_000),
    description: nullableText(100_000),
    brand: nullableText(160),
    purity: nullableText(80),
    casNumber: nullableText(160),
    appearance: nullableText(10_000),
    storageInstructions: nullableText(10_000),
    status: PRODUCT_STATUS_SCHEMA,
    publishedAt: publishedAtSchema,
    isFeatured: checkboxSchema,
    position: nonNegativePositionSchema,
  })
  .strict()
  .superRefine((data, context) => {
    if (data.status === "ACTIVE" && data.publishedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["publishedAt"],
        message: "An active product requires a publish time.",
      });
    }
  });

export const createProductFormSchema = z
  .object({
    slug: slugSchema(220),
    title: z.string().trim().min(1, "Title is required.").max(255),
    position: nonNegativePositionSchema,
  })
  .strict();

export const categoryFormSchema = z
  .object({
    publicId: publicIdSchema,
    name: z.string().trim().min(1, "Name is required.").max(255),
    description: nullableText(20_000),
    status: PRODUCT_STATUS_SCHEMA,
    publishedAt: publishedAtSchema,
    position: nonNegativePositionSchema,
  })
  .strict()
  .superRefine((data, context) => {
    if (data.status === "ACTIVE" && data.publishedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["publishedAt"],
        message: "An active category requires a publish time.",
      });
    }
  });

export const createCategoryFormSchema = z
  .object({
    slug: slugSchema(180),
    name: z.string().trim().min(1, "Name is required.").max(255),
    position: nonNegativePositionSchema,
  })
  .strict();

const USD_PATTERN = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u;
const MAX_PG_BIGINT = BigInt("9223372036854775807");

export function usdPriceToMinor(value: string): bigint | null {
  const normalized = value.trim();
  if (!USD_PATTERN.test(normalized)) return null;
  const [whole, fractional = ""] = normalized.split(".");
  const amount =
    BigInt(whole) * BigInt(100) + BigInt(fractional.padEnd(2, "0") || "0");
  return amount <= MAX_PG_BIGINT ? amount : null;
}

function validatePrice(
  data: { priceMode: "FIXED" | "ON_REQUEST"; usdPrice: string },
  context: z.RefinementCtx,
) {
  const amount = usdPriceToMinor(data.usdPrice);
  if (data.priceMode === "FIXED" && amount === null) {
    context.addIssue({
      code: "custom",
      path: ["usdPrice"],
      message: "Enter a valid USD amount with no more than two decimal places.",
    });
  }
  if (data.priceMode === "ON_REQUEST" && data.usdPrice.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["usdPrice"],
      message: "Clear the USD amount when pricing is on request.",
    });
  }
}

export const variantPriceFormSchema = z
  .object({
    productPublicId: publicIdSchema,
    variantPublicId: publicIdSchema,
    priceMode: PRICE_MODE_SCHEMA,
    usdPrice: z.string().trim().max(64),
  })
  .strict()
  .superRefine(validatePrice)
  .transform((data) => ({
    ...data,
    amountMinor:
      data.priceMode === "FIXED" ? usdPriceToMinor(data.usdPrice) : null,
  }));

const variantSharedFields = {
  productPublicId: publicIdSchema,
  title: z.string().trim().min(1, "Variant title is required.").max(255),
  sku: nullableSkuSchema,
  status: PRODUCT_STATUS_SCHEMA,
  priceMode: PRICE_MODE_SCHEMA,
  usdPrice: z.string().trim().max(64),
  minimumOrderQuantity: positiveQuantitySchema,
  position: nonNegativePositionSchema,
  publishedAt: publishedAtSchema,
  trackInventory: checkboxSchema,
  optionValues: optionValuesSchema,
};

function refineVariant(
  data: {
    priceMode: "FIXED" | "ON_REQUEST";
    usdPrice: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
    publishedAt: Date | null;
  },
  context: z.RefinementCtx,
) {
  validatePrice(data, context);
  if (data.status === "ACTIVE" && data.publishedAt === null) {
    context.addIssue({
      code: "custom",
      path: ["publishedAt"],
      message: "An active variant requires a publish time.",
    });
  }
}

function withVariantDerivedFields<
  T extends {
    priceMode: "FIXED" | "ON_REQUEST";
    usdPrice: string;
    minimumOrderQuantity: number;
    optionValues: VariantOptionValues;
  },
>(data: T) {
  return {
    ...data,
    amountMinor:
      data.priceMode === "FIXED" ? usdPriceToMinor(data.usdPrice) : null,
    optionValues: {
      ...data.optionValues,
      minimumOrderQuantity: data.minimumOrderQuantity,
    },
  };
}

export const variantFormSchema = z
  .object({ ...variantSharedFields, variantPublicId: publicIdSchema })
  .strict()
  .superRefine(refineVariant)
  .transform(withVariantDerivedFields);

export const createVariantFormSchema = z
  .object(variantSharedFields)
  .strict()
  .superRefine(refineVariant)
  .transform(withVariantDerivedFields);

export const categoryAssignmentFormSchema = z
  .object({
    productPublicId: publicIdSchema,
    primaryCategoryPublicId: nullablePublicIdSchema,
    categoryPublicIds: z.array(publicIdSchema).max(200),
  })
  .strict()
  .superRefine((data, context) => {
    const unique = new Set(data.categoryPublicIds);
    if (unique.size !== data.categoryPublicIds.length) {
      context.addIssue({
        code: "custom",
        path: ["categoryPublicIds"],
        message: "A category was selected more than once.",
      });
    }
    if (unique.size > 0 && data.primaryCategoryPublicId === null) {
      context.addIssue({
        code: "custom",
        path: ["primaryCategoryPublicId"],
        message: "Choose one selected category as primary.",
      });
    }
    if (
      data.primaryCategoryPublicId !== null &&
      !unique.has(data.primaryCategoryPublicId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["primaryCategoryPublicId"],
        message: "The primary category must also be selected.",
      });
    }
  });

function isPrivateHttpsHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  ) {
    return true;
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(
    normalized,
  );
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((value) => value > 255)) return true;
  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function normalizeCatalogMediaSource(value: string): string | null {
  if (
    value.length === 0 ||
    value.length > 2_048 ||
    value !== value.trim() ||
    /[\u0000-\u0020\\]/u.test(value) ||
    /(?:^|\/)\.\.?(?:\/|$)/u.test(value) ||
    /%(?:2e|2f|5c)/iu.test(value)
  ) {
    return null;
  }

  if (value.startsWith("/")) {
    if (
      value.startsWith("//") ||
      value.includes("//") ||
      !/^\/[A-Za-z0-9][A-Za-z0-9._~/-]*$/u.test(value)
    ) {
      return null;
    }
    return value;
  }

  if (!value.startsWith("https://")) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !url.hostname ||
      (url.port && url.port !== "443") ||
      isPrivateHttpsHostname(url.hostname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function validateMediaRole(
  kind: z.infer<typeof MEDIA_KIND_SCHEMA>,
  role: z.infer<typeof PRODUCT_MEDIA_ROLE_SCHEMA>,
  context: z.RefinementCtx,
) {
  const valid =
    (kind === "IMAGE" && ["PRIMARY", "GALLERY", "SWATCH"].includes(role)) ||
    (kind === "VIDEO" && role === "VIDEO") ||
    (kind === "DOCUMENT" && role === "DOCUMENT");
  if (!valid) {
    context.addIssue({
      code: "custom",
      path: ["role"],
      message: "The media role does not match the media kind.",
    });
  }
}

export const createProductMediaFormSchema = z
  .object({
    productPublicId: publicIdSchema,
    existingMediaPublicId: nullablePublicIdSchema,
    sourceUrl: z
      .string()
      .max(2_048)
      .transform((value) => (value.length ? value : null)),
    kind: MEDIA_KIND_SCHEMA,
    variantPublicId: nullablePublicIdSchema,
    role: PRODUCT_MEDIA_ROLE_SCHEMA,
    altText: nullableText(500),
    position: nonNegativePositionSchema,
  })
  .strict()
  .superRefine((data, context) => {
    if ((data.existingMediaPublicId === null) === (data.sourceUrl === null)) {
      context.addIssue({
        code: "custom",
        path: ["sourceUrl"],
        message: "Choose an existing media item or enter one source URL, not both.",
      });
    }
    if (data.sourceUrl && normalizeCatalogMediaSource(data.sourceUrl) === null) {
      context.addIssue({
        code: "custom",
        path: ["sourceUrl"],
        message: "Use an existing /public path or a public HTTPS URL.",
      });
    }
    validateMediaRole(data.kind, data.role, context);
  })
  .transform((data) => ({
    ...data,
    sourceUrl: data.sourceUrl
      ? normalizeCatalogMediaSource(data.sourceUrl)
      : null,
  }));

export const updateProductMediaFormSchema = z
  .object({
    productPublicId: publicIdSchema,
    mediaPublicId: publicIdSchema,
    variantPublicId: nullablePublicIdSchema,
    role: PRODUCT_MEDIA_ROLE_SCHEMA,
    altText: nullableText(500),
    position: nonNegativePositionSchema,
  })
  .strict();

export const detachProductMediaFormSchema = z
  .object({
    productPublicId: publicIdSchema,
    mediaPublicId: publicIdSchema,
  })
  .strict();

export type ProductFormInput = z.output<typeof productFormSchema>;
export type CreateProductFormInput = z.output<typeof createProductFormSchema>;
export type CategoryFormInput = z.output<typeof categoryFormSchema>;
export type CreateCategoryFormInput = z.output<typeof createCategoryFormSchema>;
export type VariantPriceFormInput = z.output<typeof variantPriceFormSchema>;
export type VariantFormInput = z.output<typeof variantFormSchema>;
export type CreateVariantFormInput = z.output<typeof createVariantFormSchema>;
export type CategoryAssignmentFormInput = z.output<
  typeof categoryAssignmentFormSchema
>;
export type CreateProductMediaFormInput = z.output<
  typeof createProductMediaFormSchema
>;
export type UpdateProductMediaFormInput = z.output<
  typeof updateProductMediaFormSchema
>;
export type DetachProductMediaFormInput = z.output<
  typeof detachProductMediaFormSchema
>;
