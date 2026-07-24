export const company = {
  name: "Flintmarrow",
  tagline: "Research Materials for Laboratory Procurement",
  description:
    "Flintmarrow lists research-use peptide materials for laboratory procurement, with USD pricing and service for supported United States addresses.",
  email: "support@flintmarrow.com",
  supportEmail: "support@flintmarrow.com",
  domain: "flintmarrow.com",
  url: "https://flintmarrow.com",
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
