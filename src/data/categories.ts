export type Category = {
  slug: string;
  name: string;
  short: string;
  description: string;
  hero: string;
  accent: [string, string];
  iconPath: string;
};

export const categories: Category[] = [
  {
    slug: "bac-water",
    name: "Bacteriostatic Water",
    short: "Bacteriostatic Water",
    description:
      "Bacteriostatic-water catalog listings for laboratory workflows. Confirm composition, presentation and handling documentation before ordering.",
    hero: "/categories/bac-water.jpg",
    accent: ["#4fb3c2", "#1a7b97"],
    iconPath: "M12 3c-3 5-6 8-6 11a6 6 0 0 0 12 0c0-3-3-6-6-11z",
  },
  {
    slug: "muscle-growth",
    name: "Tissue & Growth-Pathway Research",
    short: "Tissue Research",
    description:
      "Catalog listings commonly referenced in tissue and growth-pathway research, including BPC-157, TB-500 and Follistatin.",
    hero: "/categories/muscle-growth.jpg",
    accent: ["#5ab573", "#287842"],
    iconPath: "M6 10c0-3 3-5 6-5s6 2 6 5-3 5-6 5-6-2-6-5zm3 9l-2 3M15 19l2 3",
  },
  {
    slug: "antibacterial",
    name: "Immune & Inflammation-Pathway Research",
    short: "Immune-Pathway Research",
    description:
      "LL-37, KPV, Thymosin α-1 and related listings commonly referenced in immune, antimicrobial and inflammation-pathway research.",
    hero: "/categories/antibacterial.jpg",
    accent: ["#23b0c2", "#0f5871"],
    iconPath: "M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z",
  },
  {
    slug: "growth-energy",
    name: "Growth-Axis & Function Research",
    short: "Growth-Axis Research",
    description:
      "Sermorelin, CJC-1295, Tesamorelin, GHRP-2/6 and related catalog listings for laboratory growth-axis research.",
    hero: "/categories/growth-energy.jpg",
    accent: ["#f2b64d", "#c77e1a"],
    iconPath: "M13 2 3 14h7l-1 8 10-12h-7l1-8z",
  },
  {
    slug: "metabolic",
    name: "Metabolic & Incretin Research",
    short: "Metabolic Research",
    description:
      "GLP-1-related, dual- and triple-agonist catalog listings, including Tirzepatide, Semaglutide and Retatrutide, for metabolic research.",
    hero: "/categories/metabolic.jpg",
    accent: ["#8b77d9", "#4a3e8d"],
    iconPath: "M4 12h4l2-7 4 14 2-7h4",
  },
  {
    slug: "skin-aging",
    name: "Skin & Aging-Pathway Research",
    short: "Skin Research",
    description:
      "GHK-Cu, Epithalon, FOXO4-DRI, Melanotan II and related catalog listings for dermatology and aging-pathway research.",
    hero: "/categories/skin-aging.jpg",
    accent: ["#e0709e", "#a73a73"],
    iconPath: "M12 3c-1 3-3 5-6 6 3 1 5 3 6 6 1-3 3-5 6-6-3-1-5-3-6-6z",
  },
];

export const getCategory = (slug: string) =>
  categories.find((c) => c.slug === slug);
