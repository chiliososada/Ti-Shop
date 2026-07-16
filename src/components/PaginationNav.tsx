import Link from "next/link";

export function PaginationNav({
  page,
  pageCount,
  previousHref,
  nextHref,
  label,
}: {
  page: number;
  pageCount: number;
  previousHref: string | null;
  nextHref: string | null;
  label: string;
}) {
  return (
    <nav
      className="mt-8 flex flex-wrap items-center justify-between gap-4"
      aria-label={label}
    >
      {previousHref ? (
        <Link href={previousHref} className="font-semibold text-sage-700">
          ← Previous page
        </Link>
      ) : (
        <span className="text-sm text-muted">First page</span>
      )}
      <span className="text-sm text-muted" aria-live="polite">
        Page {page} of {pageCount}
      </span>
      {nextHref ? (
        <Link href={nextHref} className="font-semibold text-sage-700">
          Next page →
        </Link>
      ) : (
        <span className="text-sm text-muted">Last page</span>
      )}
    </nav>
  );
}
