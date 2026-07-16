import { z } from "zod";

import type { PublicBlogStructuredContentDto } from "@/domain/content";

const shortText = z.string().trim().min(1).max(2_000);
const paragraphText = z.string().trim().min(1).max(20_000);
const slug = z
  .string()
  .trim()
  .min(1)
  .max(220)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

const paragraphBlock = z
  .object({
    type: z.literal("p"),
    text: paragraphText,
  })
  .strict();

const headingBlock = z
  .object({
    type: z.literal("h2"),
    text: shortText,
  })
  .strict();

const listBlock = z
  .object({
    type: z.literal("ul"),
    items: z.array(shortText).max(100),
  })
  .strict();

const legacyContentSchema = z
  .object({
    schemaVersion: z.literal(1).optional(),
    body: z
      .array(z.discriminatedUnion("type", [paragraphBlock, headingBlock, listBlock]))
      .max(500)
      .optional(),
    takeaways: z.array(shortText).max(100).optional(),
    faqs: z
      .array(
        z
          .object({
            q: shortText,
            a: paragraphText,
          })
          .strict(),
      )
      .max(100)
      .optional(),
    keyword: shortText.nullable().optional(),
    related: z.array(slug).max(100).optional(),
    cover: z.string().trim().min(1).max(2_048).optional(),
    legacyPosition: z.number().int().nonnegative().max(100_000).optional(),
  })
  .strict();

export function parseLegacyBlogContent(
  value: unknown,
): PublicBlogStructuredContentDto | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = legacyContentSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  const content: PublicBlogStructuredContentDto = {
    body: parsed.data.body ?? [],
    takeaways: parsed.data.takeaways ?? [],
    faqs: (parsed.data.faqs ?? []).map((item) => ({
      question: item.q,
      answer: item.a,
    })),
    keyword: parsed.data.keyword ?? null,
    relatedSlugs: parsed.data.related ?? [],
  };

  const hasContent =
    content.body.length > 0 ||
    content.takeaways.length > 0 ||
    content.faqs.length > 0 ||
    content.keyword !== null ||
    content.relatedSlugs.length > 0;

  return hasContent ? content : null;
}
