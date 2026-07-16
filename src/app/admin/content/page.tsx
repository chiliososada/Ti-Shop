import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { PaginationNav } from "@/components/PaginationNav";
import { buildQueryHref, type SearchParameter } from "@/lib/pagination";
import type { AdminContentFilters } from "@/server/admin/content/filters";
import { getAdminContentIndex } from "@/server/admin/content/queries";

export const metadata: Metadata = {
  title: "Content administration",
  robots: { index: false, follow: false },
};

type ContentRow = {
  publicId: string;
  slug: string;
  label: string;
  detail: string | null;
  status: string;
  format?: string;
  editHref: string;
};

type ContentSectionKey = "blog" | "page" | "faq";

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";

function adminContentHref(
  filters: AdminContentFilters,
  overrides: Partial<AdminContentFilters> = {},
) {
  const next = { ...filters, ...overrides };
  return buildQueryHref("/admin/content", {
    blogPage: next.blogPage > 1 ? next.blogPage : undefined,
    blogQ: next.blogQuery || undefined,
    faqPage: next.faqPage > 1 ? next.faqPage : undefined,
    faqQ: next.faqQuery || undefined,
    pagePage: next.pagePage > 1 ? next.pagePage : undefined,
    pageQ: next.pageQuery || undefined,
  });
}

function pageOverride(section: ContentSectionKey, page: number) {
  if (section === "blog") return { blogPage: page };
  if (section === "faq") return { faqPage: page };
  return { pagePage: page };
}

function resetOverride(section: ContentSectionKey) {
  if (section === "blog") return { blogQuery: "", blogPage: 1 };
  if (section === "faq") return { faqQuery: "", faqPage: 1 };
  return { pageQuery: "", pagePage: 1 };
}

function PreservedContentFilters({
  filters,
  current,
}: {
  filters: AdminContentFilters;
  current: ContentSectionKey;
}) {
  return (
    <>
      {current !== "blog" && filters.blogQuery ? (
        <input type="hidden" name="blogQ" value={filters.blogQuery} />
      ) : null}
      {current !== "blog" && filters.blogPage > 1 ? (
        <input type="hidden" name="blogPage" value={filters.blogPage} />
      ) : null}
      {current !== "page" && filters.pageQuery ? (
        <input type="hidden" name="pageQ" value={filters.pageQuery} />
      ) : null}
      {current !== "page" && filters.pagePage > 1 ? (
        <input type="hidden" name="pagePage" value={filters.pagePage} />
      ) : null}
      {current !== "faq" && filters.faqQuery ? (
        <input type="hidden" name="faqQ" value={filters.faqQuery} />
      ) : null}
      {current !== "faq" && filters.faqPage > 1 ? (
        <input type="hidden" name="faqPage" value={filters.faqPage} />
      ) : null}
    </>
  );
}

function ContentTable({ rows }: { rows: readonly ContentRow[] }) {
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-line text-muted">
          <tr>
            <th className="py-3 pr-4">Content</th>
            <th className="py-3 pr-4">Details</th>
            <th className="py-3 pr-4">Status</th>
            <th className="py-3">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.publicId}>
              <td className="py-4 pr-4">
                <p className="font-semibold text-strong">{row.label}</p>
                <p className="mt-1 font-mono text-xs text-muted">{row.slug}</p>
              </td>
              <td className="py-4 pr-4">
                {[row.detail, row.format].filter(Boolean).join(" · ") || "—"}
              </td>
              <td className="py-4 pr-4">{row.status}</td>
              <td className="py-4">
                <Link className="font-semibold text-sage-700" href={row.editHref}>
                  Edit
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? (
        <p className="py-8 text-body">No records are available in this section.</p>
      ) : null}
    </div>
  );
}

export default async function AdminContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const content = await getAdminContentIndex(await searchParams);

  const sections = [
    {
      key: "page" as const,
      title: "Pages",
      description:
        "Manage standalone content under /pages without replacing the reviewed legal pages.",
      createHref: "/admin/content/pages/new",
      query: content.filters.pageQuery,
      queryName: "pageQ",
      placeholder: "Page title or slug",
      pagination: content.pagePagination,
      rows: content.pages.map((page) => ({
        publicId: page.publicId,
        slug: `/pages/${page.slug}`,
        label: page.title,
        detail: null,
        status: page.status,
        format: page.format,
        editHref: `/admin/content/pages/${page.publicId}`,
      })),
    },
    {
      key: "faq" as const,
      title: "Frequently asked questions",
      description:
        "Published entries appear on /faq in the configured display order.",
      createHref: "/admin/content/faq/new",
      query: content.filters.faqQuery,
      queryName: "faqQ",
      placeholder: "Question, slug, or category",
      pagination: content.faqPagination,
      rows: content.faqs.map((faq) => ({
        publicId: faq.publicId,
        slug: faq.slug,
        label: faq.question,
        detail: [faq.category, `Position ${faq.position}`]
          .filter(Boolean)
          .join(" · "),
        status: faq.status,
        editHref: `/admin/content/faq/${faq.publicId}`,
      })),
    },
    {
      key: "blog" as const,
      title: "Blog articles",
      description:
        "Create articles as drafts; after creation, article slugs remain protected from edits.",
      createHref: "/admin/content/blog/new",
      query: content.filters.blogQuery,
      queryName: "blogQ",
      placeholder: "Article title, slug, category, or author",
      pagination: content.postPagination,
      rows: content.posts.map((post) => ({
        publicId: post.publicId,
        slug: `/blog/${post.slug}`,
        label: post.title,
        detail: post.category,
        status: post.status,
        format: post.format,
        editHref: `/admin/content/blog/${post.publicId}`,
      })),
    },
  ] satisfies Array<{
    key: ContentSectionKey;
    title: string;
    description: string;
    createHref: string | null;
    query: string;
    queryName: "blogQ" | "pageQ" | "faqQ";
    placeholder: string;
    pagination: {
      page: number;
      pageSize: number;
      pageCount: number;
      total: number;
    };
    rows: ContentRow[];
  }>;

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header>
          <Link href="/admin" className="text-sm font-semibold text-sage-700">
            ← Administration
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Content
          </p>
          <h1 className="mt-3 text-h2 text-strong">Content administration</h1>
          <p className="mt-3 max-w-3xl text-body">
            Create, review, publish, or archive articles, FAQ entries, and
            standalone pages.
          </p>
          {content.validationError ? (
            <p
              role="alert"
              className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800"
            >
              One or more content filters were invalid, so safe defaults were
              used.
            </p>
          ) : null}
        </header>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <h2 className="text-h4 text-strong">Header and footer navigation</h2>
              <p className="mt-2 max-w-3xl text-sm text-muted">
                Manage named, first-level menus and publish reviewed links for the
                storefront header or footer. Unsafe or empty configurations fall
                back to the fixed site navigation.
              </p>
            </div>
            <Link
              href="/admin/content/navigation"
              className="shrink-0 rounded-full bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white"
            >
              Manage navigation
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <h2 className="text-h4 text-strong">
                Fixed policy and information pages
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-muted">
                Manage reviewed content for the established About, shipping,
                returns, privacy, terms, payment, and research-use URLs. Drafts
                and invalid records keep the reviewed hard-coded fallback.
              </p>
            </div>
            <Link
              href="/admin/content/managed-pages"
              className="shrink-0 rounded-full bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white"
            >
              Manage fixed pages
            </Link>
          </div>
        </section>

        {sections.map((section) => (
          <section
            key={section.title}
            className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6"
          >
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <h2 className="text-h4 text-strong">
                  {section.title} ({section.pagination.total})
                </h2>
                <p className="mt-2 text-sm text-muted">{section.description}</p>
              </div>
              {section.createHref ? (
                <Link
                  href={section.createHref}
                  className="shrink-0 rounded-full bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Create
                </Link>
              ) : null}
            </div>
            <form
              action="/admin/content"
              method="get"
              className="mt-5 flex flex-wrap items-end gap-3"
            >
              <PreservedContentFilters
                filters={content.filters}
                current={section.key}
              />
              <label className="min-w-64 flex-1 text-sm font-semibold text-strong">
                Search {section.title.toLowerCase()}
                <input
                  className={inputClass}
                  name={section.queryName}
                  type="search"
                  maxLength={120}
                  defaultValue={section.query}
                  placeholder={section.placeholder}
                />
              </label>
              <button
                type="submit"
                className="rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-white"
              >
                Search
              </button>
              <Link
                href={adminContentHref(
                  content.filters,
                  resetOverride(section.key),
                )}
                className="rounded-full border border-ink-900/15 px-5 py-3 text-sm font-semibold text-strong"
              >
                Reset
              </Link>
            </form>
            <ContentTable rows={section.rows} />
            <PaginationNav
              page={section.pagination.page}
              pageCount={section.pagination.pageCount}
              previousHref={
                section.pagination.page > 1
                  ? adminContentHref(
                      content.filters,
                      pageOverride(section.key, section.pagination.page - 1),
                    )
                  : null
              }
              nextHref={
                section.pagination.page < section.pagination.pageCount
                  ? adminContentHref(
                      content.filters,
                      pageOverride(section.key, section.pagination.page + 1),
                    )
                  : null
              }
              label={`Admin ${section.title.toLowerCase()} pagination`}
            />
          </section>
        ))}
      </div>
    </section>
  );
}
