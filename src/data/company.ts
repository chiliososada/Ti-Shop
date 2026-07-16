export const company = {
  name: "sheng.an",
  tagline: "Research Materials for Laboratory Procurement",
  description:
    "sheng.an lists research-use peptide materials for laboratory procurement, with USD pricing and service for supported United States addresses.",
  email: "sheng.an.peptide@gmail.com",
  supportEmail: "sheng.an.peptide@gmail.com",
  domain: "shengan-peptide.com",
  url: "https://shengan-peptide.com",
  defaultCurrency: "USD",
  displayCurrency: "USD",
  currencies: ["USD"],
  supportedCountries: ["US"],
  purity: "See product specification",
  stats: [
    { value: "USD", label: "Storefront currency" },
    { value: "US", label: "Supported shipping market" },
    { value: "Email", label: "Baseline contact channel" },
    { value: "RUO", label: "Research use only" },
  ],
} as const;

export type Company = typeof company;
