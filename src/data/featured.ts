// Maps the 6 categories to a signature hero product (real Veripep branded vial)
// and a benefit line for the big numbered category showcase sections.

export type Featured = {
  categorySlug: string;
  index: string;
  productId: string;
  image: string; // real Veripep product photo
  productName: string;
  benefit: string;
};

export const featured: Featured[] = [
  {
    categorySlug: "metabolic",
    index: "01",
    productId: "tirzepatide",
    image: "/products/tirzepatide-1.webp",
    productName: "Tirzepatide 5mg",
    benefit:
      "Browse Tirzepatide, Semaglutide, Retatrutide and related catalog listings commonly used in metabolic-pathway research.",
  },
  {
    categorySlug: "muscle-growth",
    index: "02",
    productId: "bpc-157",
    image: "/products/bpc-157-1.webp",
    productName: "BPC-157 2mg",
    benefit:
      "Browse BPC-157, TB-500, Follistatin and related listings commonly referenced in tissue-repair and growth-factor research.",
  },
  {
    categorySlug: "growth-energy",
    index: "03",
    productId: "cjc1295-with-dac",
    image: "/products/cjc1295-with-dac-1.jpg",
    productName: "CJC-1295 with DAC",
    benefit:
      "Browse Sermorelin, Tesamorelin, CJC-1295 and GHRP listings for growth-axis, endocrine and function research.",
  },
  {
    categorySlug: "skin-aging",
    index: "04",
    productId: "ghk-cu",
    image: "/products/ghk-cu-1.webp",
    productName: "GHK-Cu 50mg",
    benefit:
      "Browse GHK-Cu, Epitalon, FOXO4, Melanotan and related listings for skin, pigmentation and longevity-pathway research.",
  },
  {
    categorySlug: "antibacterial",
    index: "05",
    productId: "ll37",
    image: "/products/ll37-1.jpg",
    productName: "LL-37 5mg",
    benefit:
      "Browse LL-37, KPV, Thymosin α-1 and related listings for antimicrobial, immune, inflammation and cell-signaling research.",
  },
  {
    categorySlug: "bac-water",
    index: "06",
    productId: "bac-water",
    image: "/products/bac-water-1.jpg",
    productName: "Bacteriostatic Water 3ml",
    benefit:
      "Browse bacteriostatic water, sterile water and related laboratory solution listings. Confirm composition, presentation and handling before ordering.",
  },
];
