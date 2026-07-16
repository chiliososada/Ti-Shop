import Link from "next/link";

export function Eyebrow({
  children,
  invert = false,
}: {
  children: React.ReactNode;
  invert?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2.5 font-mono text-eyebrow uppercase ${
        invert ? "text-sage-200" : "text-sage-600"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${invert ? "bg-sage-300" : "bg-sage-500"}`}
        aria-hidden
      />
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  intro,
  invert = false,
  align = "left",
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  invert?: boolean;
  align?: "left" | "center";
}) {
  return (
    <div
      className={`max-w-2xl ${align === "center" ? "mx-auto text-center" : ""}`}
    >
      {eyebrow ? (
        <div className={align === "center" ? "flex justify-center" : ""}>
          <Eyebrow invert={invert}>{eyebrow}</Eyebrow>
        </div>
      ) : null}
      <h2
        className={`mt-5 text-h3 md:text-h2 ${invert ? "text-cream-50" : "text-strong"}`}
      >
        {title}
      </h2>
      {intro ? (
        <p
          className={`mt-5 text-lg leading-relaxed ${invert ? "text-cream-200/80" : "text-body"}`}
        >
          {intro}
        </p>
      ) : null}
    </div>
  );
}

type ButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "outline" | "outline-invert";
  size?: "md" | "lg";
  className?: string;
};

export function Button({
  href,
  children,
  variant = "primary",
  size = "md",
  className = "",
}: ButtonProps) {
  const base =
    "group inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-base focus-visible:ring-sage-400";
  const sizes = {
    md: "px-6 py-3 text-sm",
    lg: "px-8 py-4 text-[0.95rem]",
  };
  const variants = {
    primary:
      "bg-ink-900 text-cream-50 shadow-sm hover:bg-sage-600 hover:shadow-md hover:-translate-y-0.5",
    secondary:
      "bg-sage-500 text-white shadow-sm hover:bg-sage-600 hover:-translate-y-0.5",
    outline:
      "border border-ink-900/15 bg-transparent text-strong hover:border-ink-900/30 hover:bg-ink-900/[0.04]",
    "outline-invert":
      "border border-cream-50/30 text-cream-50 hover:border-cream-50/60 hover:bg-cream-50/10",
  };
  return (
    <Link
      href={href}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Pill({
  children,
  tone = "sage",
}: {
  children: React.ReactNode;
  tone?: "sage" | "clay" | "cream";
}) {
  const tones = {
    sage: "bg-sage-100 text-sage-700",
    clay: "bg-clay-100 text-clay-600",
    cream: "bg-cream-50 text-ink-500 ring-1 ring-ink-900/10",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-caption font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
