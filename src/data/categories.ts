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
    name: "Laboratory & Reconstitution Solutions",
    short: "Lab Solutions",
    description:
      "Bacteriostatic water, sterile water, acetic-acid water and related laboratory solution listings. Confirm composition, presentation and handling documentation before ordering.",
    hero: "/categories/bac-water.jpg",
    accent: ["#4fb3c2", "#1a7b97"],
    iconPath: "M12 3c-3 5-6 8-6 11a6 6 0 0 0 12 0c0-3-3-6-6-11z",
  },
  {
    slug: "muscle-growth",
    name: "Tissue Repair & Growth-Factor Research",
    short: "Tissue & Growth",
    description:
      "BPC-157, TB-500, Follistatin, IGF and related listings commonly referenced in tissue-repair and growth-factor research.",
    hero: "/categories/muscle-growth.jpg",
    accent: ["#5ab573", "#287842"],
    iconPath: "M6 10c0-3 3-5 6-5s6 2 6 5-3 5-6 5-6-2-6-5zm3 9l-2 3M15 19l2 3",
  },
  {
    slug: "antibacterial",
    name: "Immune, Inflammation & Cell-Signaling Research",
    short: "Immune & Cell Signaling",
    description:
      "LL-37, KPV, Thymosin α-1 and related listings commonly referenced in immune, antimicrobial, inflammation and cell-signaling research.",
    hero: "/categories/antibacterial.jpg",
    accent: ["#23b0c2", "#0f5871"],
    iconPath: "M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z",
  },
  {
    slug: "growth-energy",
    name: "Growth-Axis, Endocrine & Function Research",
    short: "Growth & Function",
    description:
      "CJC-1295, growth-hormone-axis, endocrine, neuropeptide and organ-function listings grouped for laboratory research discovery.",
    hero: "/categories/growth-energy.jpg",
    accent: ["#f2b64d", "#c77e1a"],
    iconPath: "M13 2 3 14h7l-1 8 10-12h-7l1-8z",
  },
  {
    slug: "metabolic",
    name: "Metabolic, Incretin & Mitochondrial Research",
    short: "Metabolic Research",
    description:
      "Incretin, metabolic-signaling and mitochondrial research listings, including Semaglutide, Tirzepatide, Retatrutide, MOTS-c and SS-31.",
    hero: "/categories/metabolic.jpg",
    accent: ["#8b77d9", "#4a3e8d"],
    iconPath: "M4 12h4l2-7 4 14 2-7h4",
  },
  {
    slug: "skin-aging",
    name: "Skin, Pigmentation & Longevity Research",
    short: "Skin & Longevity",
    description:
      "GHK-Cu, Epitalon, FOXO4, Melanotan, GLOW and related listings for skin, pigmentation and longevity-pathway research.",
    hero: "/categories/skin-aging.jpg",
    accent: ["#e0709e", "#a73a73"],
    iconPath: "M12 3c-1 3-3 5-6 6 3 1 5 3 6 6 1-3 3-5 6-6-3-1-5-3-6-6z",
  },
];

export const getCategory = (slug: string) =>
  categories.find((c) => c.slug === slug);
