import Image from "next/image";
import Link from "next/link";
import type { PublicBlogSummaryDto } from "@/domain/content";
import {
  isRemotePublicAssetUrl,
  sanitizePublicAssetUrl,
} from "@/lib/public-asset-url";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function BlogCard({ post }: { post: PublicBlogSummaryDto }) {
  const heroImageUrl = sanitizePublicAssetUrl(post.heroImage?.url ?? null);

  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl bg-surface-warm ring-1 ring-ink-900/[0.06] transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-surface-alt">
        {post.heroImage && heroImageUrl ? (
          <Image
            src={heroImageUrl}
            alt={post.heroImage.alt}
            unoptimized={isRemotePublicAssetUrl(heroImageUrl)}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full place-items-center text-caption text-muted">
            Research desk
          </div>
        )}
        <span className="absolute left-4 top-4 rounded-full bg-cream-50/90 px-3 py-1 text-caption font-semibold text-sage-700 backdrop-blur-sm">
          {post.category ?? "Research"}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-center gap-2 font-mono text-caption text-muted">
          <span>{formatDate(post.publishedAt)}</span>
          <span aria-hidden>·</span>
          <span>
            {post.readingMinutes ? `${post.readingMinutes} min` : "Article"}
          </span>
        </div>
        <h3 className="mt-2 text-h5 leading-snug text-strong">{post.title}</h3>
        <p className="mt-2 line-clamp-2 flex-1 text-sm leading-relaxed text-muted">
          {post.excerpt}
        </p>
        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-strong">
          Read article
          <span className="transition-transform group-hover:translate-x-1">
            →
          </span>
        </span>
      </div>
    </Link>
  );
}
