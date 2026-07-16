import Link from "next/link";

export function AuthPageShell({
  eyebrow,
  title,
  description,
  children,
  alternateText,
  alternateHref,
  alternateLabel,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  alternateText: string;
  alternateHref: string;
  alternateLabel: string;
}) {
  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x">
        <div className="mx-auto max-w-md rounded-3xl border border-ink-900/[0.08] bg-surface p-7 shadow-sm md:p-10">
          <p className="font-mono text-eyebrow uppercase text-sage-600">
            {eyebrow}
          </p>
          <h1 className="mt-4 text-h3 text-strong">{title}</h1>
          <p className="mt-3 leading-relaxed text-body">{description}</p>

          <div className="mt-8">{children}</div>

          <p className="mt-7 border-t border-line pt-6 text-center text-sm text-muted">
            {alternateText}{" "}
            <Link
              href={alternateHref}
              className="font-semibold text-sage-700 underline decoration-sage-300 underline-offset-4 hover:text-sage-600"
            >
              {alternateLabel}
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
