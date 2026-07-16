import Link from "next/link";
import { Eyebrow } from "@/components/ui";

export function PageHero({
  eyebrow,
  title,
  intro,
  breadcrumbs,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  breadcrumbs?: { name: string; url: string }[];
}) {
  return (
    <section className="border-b border-ink-900/[0.06] bg-surface-alt">
      <div className="container-x py-16 md:py-24">
        {breadcrumbs ? (
          <nav
            aria-label="Breadcrumb"
            className="mb-7 flex flex-wrap items-center gap-2 text-caption text-muted"
          >
            {breadcrumbs.map((b, i) => (
              <span key={b.url} className="flex items-center gap-2">
                {i > 0 ? <span className="text-ink-200">/</span> : null}
                {i === breadcrumbs.length - 1 ? (
                  <span className="text-body">{b.name}</span>
                ) : (
                  <Link href={b.url} className="hover:text-strong">
                    {b.name}
                  </Link>
                )}
              </span>
            ))}
          </nav>
        ) : null}
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="mt-5 max-w-3xl text-h2 text-strong md:text-h1">
          {title}
        </h1>
        {intro ? (
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-body">
            {intro}
          </p>
        ) : null}
      </div>
    </section>
  );
}
