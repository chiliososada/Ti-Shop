import type {
  PublicImageDto,
  PublicSeoDto,
  PublicSitemapEntryDto,
} from "@/domain/public";

export type PublicBlogBlockDto =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "ul"; items: string[] };

export type PublicBlogStructuredContentDto = {
  body: PublicBlogBlockDto[];
  takeaways: string[];
  faqs: { question: string; answer: string }[];
  keyword: string | null;
  relatedSlugs: string[];
};

export type PublicBlogSummaryDto = {
  publicId: string;
  slug: string;
  title: string;
  category: string | null;
  author: string | null;
  readingMinutes: number | null;
  excerpt: string | null;
  heroImage: PublicImageDto | null;
  publishedAt: string;
};

export type PublicBlogPostDto = PublicBlogSummaryDto & {
  body: string;
  format: "markdown" | "rich-text" | "html";
  structuredContent: PublicBlogStructuredContentDto | null;
  updatedAt: string;
  seo: PublicSeoDto | null;
};

export type PublicBlogSitemapEntryDto = PublicSitemapEntryDto & {
  kind: "blog";
};

export type PublicFaqDto = {
  publicId: string;
  slug: string;
  question: string;
  answer: string;
  category: string | null;
  position: number;
  publishedAt: string;
  updatedAt: string;
};

export type PublicPageDto = {
  publicId: string;
  slug: string;
  title: string;
  body: string;
  format: "markdown" | "rich-text" | "html";
  publishedAt: string;
  updatedAt: string;
  seo: PublicSeoDto | null;
};

export type PublicPageSitemapEntryDto = PublicSitemapEntryDto & {
  kind: "page";
};
