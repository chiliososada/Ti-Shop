"use client";

import Link from "next/link";

import type { StorefrontNavigationLink as NavigationLinkValue } from "@/lib/navigation-url";

export function StorefrontNavigationLink({
  link,
  className,
  onNavigate,
  children,
}: {
  link: NavigationLinkValue;
  className?: string;
  onNavigate?: () => void;
  children?: React.ReactNode;
}) {
  const content = children ?? link.label;
  const newTab = link.openInNewTab;
  const target = newTab ? "_blank" : undefined;
  const rel = link.external || newTab ? "noopener noreferrer" : undefined;

  if (link.external) {
    return (
      <a
        href={link.href}
        target={target}
        rel={rel}
        className={className}
        onClick={onNavigate}
      >
        {content}
      </a>
    );
  }

  return (
    <Link
      href={link.href}
      target={target}
      rel={rel}
      className={className}
      onClick={onNavigate}
    >
      {content}
    </Link>
  );
}
