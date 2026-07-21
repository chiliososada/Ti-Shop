export const productCategorySlugs = [
  "bac-water",
  "muscle-growth",
  "antibacterial",
  "growth-energy",
  "metabolic",
  "skin-aging",
] as const;

export type ProductCategorySlug = (typeof productCategorySlugs)[number];

// Product families are intentionally classified before dosage or presentation.
// This keeps every strength and blend led by the same product in one category.
export const productCategoryFamilies: Record<
  ProductCategorySlug,
  readonly string[]
> = {
  "bac-water": [
    "Acetic Acid Water",
    "Bacteriostatic Water",
    "Large Bottle",
    "Sterile Water",
  ],
  "muscle-growth": [
    "ACE-031",
    "BPC-157",
    "Follistatin-344",
    "Fragment 17-23",
    "GDF-8",
    "IGF-1 LR3",
    "IGF-DES",
    "KLOW Blend",
    "MGF",
    "PEG-MGF",
    "TB-500",
  ],
  antibacterial: [
    "ARA-290",
    "KPV",
    "LL-37",
    "PNC-27",
    "Thymalin",
    "Thymosin α-1",
    "Vilon",
    "VIP",
  ],
  "growth-energy": [
    "Adamax",
    "B7-33",
    "Bronchogen",
    "Cardiogen",
    "Cartalax",
    "Cerebrolysin",
    "Chonluten",
    "CJC-1295",
    "Cortagen",
    "Crystagen",
    "Dermorphin",
    "Dihexa",
    "DSIP",
    "EPO",
    "GHRP-2",
    "GHRP-6",
    "Gonadorelin Acetate",
    "HCG",
    "Hexarelin Acetate",
    "HGH",
    "HMG",
    "Ipamorelin",
    "Kisspeptin-10",
    "Livagen",
    "MK-677",
    "Oxytocin",
    "P21",
    "Pancragen",
    "PE-22-28",
    "Pinealon",
    "PT-141",
    "Selank",
    "Semax",
    "Sermorelin Acetate",
    "Teriparatide",
    "Tesamorelin",
  ],
  metabolic: [
    "5-Amino-1MQ",
    "AICAR",
    "AOD9604",
    "Cagrilintide",
    "CagriSema",
    "CBL-514",
    "Dulaglutide",
    "FTPP",
    "HGH Fragment 176-191",
    "Humanin",
    "Insulin",
    "L-Carnitine",
    "LC120",
    "Lemon Bottle",
    "Lipo-C",
    "Liraglutide",
    "Mazdutide",
    "MIC Lipo-C with B12",
    "MOTS-c",
    "NAD+",
    "Retatrutide",
    "Semaglutide",
    "SLU-PP-332",
    "SS-31",
    "Survodutide",
    "Tesofensine",
    "Tirzepatide",
  ],
  "skin-aging": [
    "AHK-CU",
    "Botulinum Toxin",
    "Epitalon",
    "FOXO4",
    "GHK-Cu",
    "GLOW Blend",
    "Glutathione",
    "Melanotan",
    "OS-01",
    "SNAP-8",
  ],
};

export type ProductCategoryAssignment = {
  category: ProductCategorySlug;
  family: string;
};

const categoryAssignments: ProductCategoryAssignment[] = Object.entries(
  productCategoryFamilies,
)
  .flatMap(([category, families]) =>
    families.map((family) => ({
      category: category as ProductCategorySlug,
      family,
    })),
  )
  .sort((left, right) => right.family.length - left.family.length);

function belongsToFamily(productName: string, family: string): boolean {
  return (
    productName === family ||
    productName.startsWith(`${family} `) ||
    productName.startsWith(`${family}-`)
  );
}

export function expectedCategoryAssignment(
  productName: string,
): ProductCategoryAssignment | null {
  return (
    categoryAssignments.find(({ family }) =>
      belongsToFamily(productName, family),
    ) ?? null
  );
}

export function expectedCategoryForProductName(
  productName: string,
): ProductCategorySlug | null {
  return expectedCategoryAssignment(productName)?.category ?? null;
}
