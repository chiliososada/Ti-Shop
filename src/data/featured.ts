// Maps the 6 categories to a signature hero product (real sheng.an branded vial)
// and a benefit line for the big numbered category showcase sections.

export type Featured = {
  categorySlug: string;
  index: string;
  productId: string;
  image: string; // real sheng.an product photo
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
    productId: "bpc157-500mcg",
    image: "/products/bpc157-500mcg-1.jpg",
    productName: "BPC-157 500mcg",
    benefit:
      "Browse BPC-157, TB-500, Follistatin and related listings commonly referenced in tissue and growth-pathway research.",
  },
  {
    categorySlug: "growth-energy",
    index: "03",
    productId: "cjc1295-with-dac",
    image: "/products/cjc1295-with-dac-1.jpg",
    productName: "CJC-1295 with DAC",
    benefit:
      "Browse Sermorelin, Tesamorelin, CJC-1295 and GHRP listings for laboratory growth-axis research.",
  },
  {
    categorySlug: "skin-aging",
    index: "04",
    productId: "ghk-cu",
    image: "/products/ghk-cu-1.webp",
    productName: "GHK-Cu 50mg",
    benefit:
      "Browse GHK-Cu, Epithalon, FOXO4-DRI and related listings for dermatology and aging-pathway research.",
  },
  {
    categorySlug: "antibacterial",
    index: "05",
    productId: "ll37",
    image: "/products/ll37-1.jpg",
    productName: "LL-37 5mg",
    benefit:
      "Browse LL-37, KPV, Thymosin α-1 and related listings for antimicrobial, immune and inflammation-pathway research.",
  },
  {
    categorySlug: "bac-water",
    index: "06",
    productId: "bac-water",
    image: "/products/bac-water-1.jpg",
    productName: "Bacteriostatic Water 3ml",
    benefit:
      "Bacteriostatic-water catalog listings for laboratory workflows. Confirm composition, presentation and handling before ordering.",
  },
];
