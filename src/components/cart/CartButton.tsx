"use client";

import { useCart } from "./CartProvider";

export function CartButton() {
  const { count, open } = useCart();
  return (
    <button
      onClick={open}
      aria-label={`Open cart (${count} items)`}
      className="relative grid h-10 w-10 place-items-center rounded-full text-strong transition-colors hover:bg-surface-alt"
    >
      <svg
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden
      >
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <path d="M3 6h18M16 10a4 4 0 0 1-8 0" />
      </svg>
      {count > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-sage-600 px-1 text-[0.65rem] font-bold text-cream-50">
          {count}
        </span>
      ) : null}
    </button>
  );
}
