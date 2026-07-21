import raw from "./products.json";

export type Product = {
  id: string;
  name: string;
  category: string;
  price: number | null;
  purity: string;
  cas?: string;
  appearance: string;
  storage: string;
  image: string;
  gallery: string[];
  presentation?: string;
  catalogNumber?: string | null;
  shortDescription: string;
  description: string;
  featured?: boolean;
};

type ProductSource = Omit<Product, "gallery"> & { gallery?: string[] };

export const products: Product[] = (raw as ProductSource[]).map((product) => ({
  ...product,
  gallery: product.gallery ?? [],
}));

export const getProduct = (id: string) => products.find((p) => p.id === id);

export const productsByCategory = (slug: string) =>
  products.filter((p) => p.category === slug);

// A curated set of recognizable bestsellers for the homepage grid.
const bestsellerIds = [
  "bpc-157",
  "cjc-1295-without-dac-5mg-ipa-5mg",
  "follistatin-344-10mg",
  "ghrp-2",
];

export const bestsellers = (() => {
  const picked = products.filter((p) => bestsellerIds.includes(p.id));
  if (picked.length >= 8) return picked.slice(0, 8);
  // Fill up to 8 with priced products for a full grid.
  const extras = products.filter(
    (p) => p.price !== null && !bestsellerIds.includes(p.id),
  );
  return [...picked, ...extras].slice(0, 8);
})();
