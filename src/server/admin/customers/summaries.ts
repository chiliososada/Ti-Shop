const SOURCE_AREA_LABELS: Readonly<Record<string, string>> = {
  "": "Storefront home",
  account: "Customer account",
  blog: "Blog",
  cart: "Cart",
  categories: "Category page",
  checkout: "Checkout",
  contact: "Contact page",
  products: "Product page",
};

/**
 * Reduces a captured storefront path to a coarse route family. Query strings,
 * fragments, slugs, and arbitrary path segments never reach the admin DTO.
 */
export function summarizeWhatsAppSourceArea(sourcePath: string | null) {
  if (!sourcePath) return "Not recorded";

  try {
    const url = new URL(sourcePath, "https://storefront.invalid");
    if (url.origin !== "https://storefront.invalid") return "External source";
    const firstSegment = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return SOURCE_AREA_LABELS[firstSegment] ?? "Other storefront page";
  } catch {
    return "Invalid source path";
  }
}
