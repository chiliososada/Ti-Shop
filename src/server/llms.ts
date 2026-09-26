import "server-only";

import type { LlmsBlogPost, LlmsInput } from "@/lib/llms-text";
import { resolvePublicSiteOrigin } from "@/lib/site-url";
import { getPublicMaterialListings } from "@/server/catalog/material-listings";
import { getOrderMode } from "@/server/commerce/order-mode";
import {
  getPublicBlogPostBySlug,
  getPublicBlogPosts,
  getPublicFaqs,
} from "@/server/content";

/** Published catalog, guides and FAQs for /llms.txt and /llms-full.txt. */
export async function getLlmsInput({ full }: { full: boolean }): Promise<LlmsInput> {
  const [listings, summaries, faqs, orderMode] = await Promise.all([
    getPublicMaterialListings(),
    getPublicBlogPosts({ limit: 100 }),
    getPublicFaqs(),
    getOrderMode(),
  ]);
  const posts: LlmsBlogPost[] = full
    ? (
        await Promise.all(
          summaries.map(async (summary) => {
            const post = await getPublicBlogPostBySlug(summary.slug);
            return post
              ? {
                  slug: post.slug,
                  title: post.title,
                  excerpt: post.excerpt,
                  updatedAt: post.updatedAt,
                  body: post.structuredContent?.body ?? [],
                  takeaways: post.structuredContent?.takeaways ?? [],
                  faqs: post.structuredContent?.faqs ?? [],
                }
              : null;
          }),
        )
      ).filter((post) => post !== null)
    : summaries.map((summary) => ({
        slug: summary.slug,
        title: summary.title,
        excerpt: summary.excerpt,
      }));
  return {
    origin: resolvePublicSiteOrigin(),
    listings,
    posts,
    faqs: faqs.map((faq) => ({ question: faq.question, answer: faq.answer })),
    orderMode,
    generatedOn: new Date().toISOString().slice(0, 10),
  };
}

export function llmsTextResponse(body: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      // The pages themselves are the search results; these files are a map
      // for assistants and must not compete with them as duplicates.
      "X-Robots-Tag": "noindex",
    },
  });
}
