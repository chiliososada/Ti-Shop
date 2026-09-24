import Link from "next/link";

import { getPublicBlogPosts } from "@/server/content";

/**
 * Links catalog pages to the published guides. Renders only published posts,
 * so withdrawing an article removes these links everywhere at once.
 */
export async function GuideReading() {
  const posts = await getPublicBlogPosts({ limit: 4 });
  if (!posts.length) return null;

  return (
    <aside
      className="border-t border-line bg-surface-alt py-12"
      aria-labelledby="guide-reading-heading"
    >
      <div className="container-x">
        <h2 id="guide-reading-heading" className="text-h4 text-strong">
          Before you order: specification and document guides
        </h2>
        <p className="mt-3 max-w-3xl text-body">
          These guides explain how to read a Certificate of Analysis, compare
          purity methods and handle lyophilized material, so you can confirm
          the details that matter for your laboratory before placing an order.
        </p>
        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {posts.map((post) => (
            <li key={post.slug}>
              <Link
                href={`/blog/${post.slug}`}
                className="block rounded-lg border border-line bg-base p-5 font-medium text-strong hover:underline"
              >
                {post.title} →
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
