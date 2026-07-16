import { z } from "zod";

const sourcePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(
    /^\/(?:[A-Za-z0-9._~-]+\/?)*$/u,
    "Source path must be a local path without a query or fragment.",
  );
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(220)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const publicIdSchema = z.uuid();

const base = {
  sourcePath: sourcePathSchema,
};

export const whatsappIntentInputSchema = z.discriminatedUnion("templateKey", [
  z.object({ ...base, templateKey: z.literal("global") }).strict(),
  z
    .object({
      ...base,
      templateKey: z.literal("product"),
      productSlug: slugSchema,
    })
    .strict(),
  z
    .object({
      ...base,
      templateKey: z.literal("cart"),
      lines: z
        .array(
          z
            .object({
              productSlug: slugSchema,
              variantPublicId: publicIdSchema,
              quantity: z.number().int().min(1).max(99),
            })
            .strict(),
        )
        .min(1)
        .max(25),
    })
    .strict(),
  z
    .object({
      ...base,
      templateKey: z.literal("order"),
      orderPublicId: publicIdSchema,
    })
    .strict(),
  z
    .object({
      ...base,
      templateKey: z.literal("contact"),
      category: z.string().trim().min(1).max(120),
      requirement: z.string().trim().min(1).max(1_200),
    })
    .strict(),
]);

export type WhatsAppIntentInput = z.infer<typeof whatsappIntentInputSchema>;
