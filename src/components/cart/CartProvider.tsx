"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  clampDirectCheckoutQuantity,
  MAXIMUM_DIRECT_CHECKOUT_QUANTITY,
} from "@/domain/minimum-order-quantity";

export type CartProductSnapshot = {
  publicId: string;
  variantPublicId: string;
  slug: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  imageAlt: string;
  unitAmountMinor: string;
  currency: "USD";
  minimumOrderQuantity: number;
};

export type CartLine = {
  key: string;
  product: CartProductSnapshot;
  qty: number;
};

type CartContext = {
  items: CartLine[];
  count: number;
  subtotalAmountMinor: string;
  subtotalDisplay: string;
  add: (product: CartProductSnapshot, qty?: number) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  buyNow: (product: CartProductSnapshot, qty?: number) => void;
};

const Ctx = createContext<CartContext | null>(null);
const STORAGE_KEY = "veripep-cart-v2";
const PUBLIC_ID_PATTERN = /^[a-zA-Z0-9_-]{1,160}$/u;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const AMOUNT_PATTERN = /^\d{1,18}$/u;

function normalizeImageUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 2_048) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function normalizeProduct(value: unknown): CartProductSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CartProductSnapshot>;
  const imageUrl = normalizeImageUrl(candidate.imageUrl);
  const variantTitle =
    candidate.variantTitle === undefined ? null : candidate.variantTitle;
  const sku = candidate.sku === undefined ? null : candidate.sku;
  const minimumOrderQuantity =
    candidate.minimumOrderQuantity === undefined
      ? 1
      : candidate.minimumOrderQuantity;

  if (
    typeof candidate.publicId !== "string" ||
    !PUBLIC_ID_PATTERN.test(candidate.publicId) ||
    typeof candidate.variantPublicId !== "string" ||
    !PUBLIC_ID_PATTERN.test(candidate.variantPublicId) ||
    typeof candidate.slug !== "string" ||
    candidate.slug.length > 220 ||
    !SLUG_PATTERN.test(candidate.slug) ||
    typeof candidate.title !== "string" ||
    candidate.title.trim().length === 0 ||
    candidate.title.length > 255 ||
    (variantTitle !== null &&
      (typeof variantTitle !== "string" ||
        variantTitle.trim().length === 0 ||
        variantTitle.length > 255)) ||
    (sku !== null && (typeof sku !== "string" || sku.length > 120)) ||
    typeof candidate.imageAlt !== "string" ||
    candidate.imageAlt.length > 500 ||
    typeof candidate.unitAmountMinor !== "string" ||
    !AMOUNT_PATTERN.test(candidate.unitAmountMinor) ||
    candidate.currency !== "USD" ||
    typeof minimumOrderQuantity !== "number" ||
    !Number.isSafeInteger(minimumOrderQuantity) ||
    minimumOrderQuantity < 1 ||
    minimumOrderQuantity > MAXIMUM_DIRECT_CHECKOUT_QUANTITY ||
    (candidate.imageUrl !== null && imageUrl === null)
  ) {
    return null;
  }

  return {
    publicId: candidate.publicId,
    variantPublicId: candidate.variantPublicId,
    slug: candidate.slug,
    title: candidate.title.trim(),
    variantTitle: variantTitle?.trim() ?? null,
    sku: sku?.trim() || null,
    imageUrl,
    imageAlt: candidate.imageAlt.trim() || candidate.title.trim(),
    unitAmountMinor: candidate.unitAmountMinor,
    currency: "USD",
    minimumOrderQuantity,
  };
}

function lineKey(product: CartProductSnapshot) {
  return `${product.publicId}:${product.variantPublicId}`;
}

function normalizeQuantity(value: unknown, minimumOrderQuantity: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return clampDirectCheckoutQuantity(value, minimumOrderQuantity);
}

function normalizeCart(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return [];

  const lines = new Map<string, CartLine>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const stored = candidate as { product?: unknown; qty?: unknown };
    const product = normalizeProduct(stored.product);
    const qty = product
      ? normalizeQuantity(stored.qty, product.minimumOrderQuantity)
      : null;
    if (!product || qty === null) continue;

    const key = lineKey(product);
    const existing = lines.get(key);
    const minimumOrderQuantity = Math.max(
      existing?.product.minimumOrderQuantity ?? 1,
      product.minimumOrderQuantity,
    );
    const mergedProduct = { ...product, minimumOrderQuantity };
    lines.set(key, {
      key,
      product: mergedProduct,
      qty: clampDirectCheckoutQuantity(
        (existing?.qty ?? 0) + qty,
        minimumOrderQuantity,
      ),
    });
  }

  return [...lines.values()].slice(0, 100);
}

export function formatUsdMinor(amountMinor: string) {
  if (!AMOUNT_PATTERN.test(amountMinor)) return "$0.00";
  const padded = amountMinor.padStart(3, "0");
  const dollars = padded.slice(0, -2).replace(/^0+(?=\d)/u, "");
  return `$${dollars}.${padded.slice(-2)}`;
}

function cartSubtotal(items: readonly CartLine[]) {
  return items
    .reduce(
      (sum, line) =>
        sum + BigInt(line.product.unitAmountMinor) * BigInt(line.qty),
      BigInt(0),
    )
    .toString();
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartLine[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let savedItems: CartLine[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) savedItems = normalizeCart(JSON.parse(raw));
    } catch {
      // Invalid or unavailable local storage fails closed to an empty cart.
    }

    queueMicrotask(() => {
      if (cancelled) return;
      setItems(savedItems);
      setHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // The inquiry cart remains usable for the current page session.
    }
  }, [items, hydrated]);

  const add = useCallback((candidate: CartProductSnapshot, qty = 1) => {
    const product = normalizeProduct(candidate);
    const normalizedQty = product
      ? normalizeQuantity(qty, product.minimumOrderQuantity)
      : null;
    if (!product || normalizedQty === null) return;

    const key = lineKey(product);
    setItems((previous) => {
      const found = previous.find((line) => line.key === key);
      if (found) {
        return previous.map((line) =>
          line.key === key
            ? {
                ...line,
                product,
                qty: clampDirectCheckoutQuantity(
                  line.qty + normalizedQty,
                  product.minimumOrderQuantity,
                ),
              }
            : line,
        );
      }
      return [...previous, { key, product, qty: normalizedQty }];
    });
    setIsOpen(true);
  }, []);

  const buyNow = useCallback(
    (product: CartProductSnapshot, qty = 1) => {
      // This stages an inquiry only; no order or payment is created client-side.
      add(product, qty);
    },
    [add],
  );

  const setQty = useCallback((key: string, qty: number) => {
    setItems((previous) =>
      previous.map((line) =>
        line.key === key
          ? {
              ...line,
              qty: clampDirectCheckoutQuantity(
                qty,
                line.product.minimumOrderQuantity,
              ),
            }
          : line,
      ),
    );
  }, []);

  const remove = useCallback(
    (key: string) =>
      setItems((previous) => previous.filter((line) => line.key !== key)),
    [],
  );
  const clear = useCallback(() => setItems([]), []);

  const count = useMemo(
    () => items.reduce((total, line) => total + line.qty, 0),
    [items],
  );
  const subtotalAmountMinor = useMemo(() => cartSubtotal(items), [items]);
  const subtotalDisplay = useMemo(
    () => formatUsdMinor(subtotalAmountMinor),
    [subtotalAmountMinor],
  );

  const value: CartContext = {
    items,
    count,
    subtotalAmountMinor,
    subtotalDisplay,
    add,
    setQty,
    remove,
    clear,
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    buyNow,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const context = useContext(Ctx);
  if (!context) throw new Error("useCart must be used within CartProvider");
  return context;
}
