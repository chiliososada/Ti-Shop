export const MANAGED_PAGE_ROUTES = [
  "ABOUT",
  "SHIPPING",
  "RETURNS_AND_REFUNDS",
  "PRIVACY_POLICY",
  "TERMS_OF_SERVICE",
  "PAYMENT_POLICY",
  "RESEARCH_USE_POLICY",
] as const;

export type ManagedPageRouteKey = (typeof MANAGED_PAGE_ROUTES)[number];

export type ManagedPageDefinition = {
  routeKey: ManagedPageRouteKey;
  adminSlug: string;
  internalSlug: string;
  path: string;
  label: string;
  eyebrow: string;
  fallbackTitle: string;
  fallbackSeoTitle: string;
  fallbackDescription: string;
  complianceNotice: string;
};

export const MANAGED_PAGE_DEFINITIONS = [
  {
    routeKey: "ABOUT",
    adminSlug: "about",
    internalSlug: "managed-route-about",
    path: "/about",
    label: "About",
    eyebrow: "About sheng.an",
    fallbackTitle: "Research-use catalog and ordering for the United States",
    fallbackSeoTitle: "About sheng.an — Research-Use Catalog and Ordering",
    fallbackDescription:
      "How sheng.an presents research-use catalog information, confirms product and lot details, and supports eligible United States orders.",
    complianceNotice:
      "Catalog information does not establish product, lot, document, shipping, or payment availability. Those details are confirmed for the actual request or order.",
  },
  {
    routeKey: "SHIPPING",
    adminSlug: "shipping",
    internalSlug: "managed-route-shipping",
    path: "/shipping",
    label: "Shipping policy",
    eyebrow: "Order policies",
    fallbackTitle: "Shipping policy",
    fallbackSeoTitle: "Shipping Policy — United States Orders",
    fallbackDescription:
      "How supported US destinations, address checks, dispatch updates, tracking and delivery issues are handled for sheng.an research orders.",
    complianceNotice:
      "The storefront supports only eligible United States destinations. A displayed estimate or merchant-entered tracking update is not a carrier guarantee.",
  },
  {
    routeKey: "RETURNS_AND_REFUNDS",
    adminSlug: "returns-and-refunds",
    internalSlug: "managed-route-returns-and-refunds",
    path: "/returns",
    label: "Returns and refunds",
    eyebrow: "Order policies",
    fallbackTitle: "Returns and refunds",
    fallbackSeoTitle: "Returns and Refunds Policy",
    fallbackDescription:
      "Return authorization, issue reporting, review and refund handling for sheng.an research-product orders.",
    complianceNotice:
      "Do not return an item without written authorization. Research-material integrity, traceability, applicable rights, and the recorded order facts are reviewed before any resolution is approved.",
  },
  {
    routeKey: "PRIVACY_POLICY",
    adminSlug: "privacy-policy",
    internalSlug: "managed-route-privacy-policy",
    path: "/privacy",
    label: "Privacy policy",
    eyebrow: "Legal",
    fallbackTitle: "Privacy policy",
    fallbackSeoTitle: "Privacy Policy",
    fallbackDescription:
      "What information sheng.an uses for accounts, orders, payment records, fulfillment, security and customer support.",
    complianceNotice:
      "Never submit passwords, private keys, recovery phrases, full financial credentials, or unnecessary sensitive personal information through public content or WhatsApp.",
  },
  {
    routeKey: "TERMS_OF_SERVICE",
    adminSlug: "terms-of-service",
    internalSlug: "managed-route-terms-of-service",
    path: "/terms",
    label: "Terms of service",
    eyebrow: "Legal",
    fallbackTitle: "Terms of use and sale",
    fallbackSeoTitle: "Terms of Use and Sale",
    fallbackDescription:
      "Account, ordering, payment, research-use, fulfillment and acceptable-use terms for the sheng.an United States storefront.",
    complianceNotice:
      "Products are supplied only for legitimate laboratory and research use, not for human or veterinary use, diagnosis, treatment, self-administration, food, cosmetics, or household use.",
  },
  {
    routeKey: "PAYMENT_POLICY",
    adminSlug: "payment-policy",
    internalSlug: "managed-route-payment-policy",
    path: "/payment-policy",
    label: "Payment policy",
    eyebrow: "Order policies",
    fallbackTitle: "Payment policy",
    fallbackSeoTitle: "Payment Policy — NOWPayments, Wire and Zelle",
    fallbackDescription:
      "How enabled online and manual payment methods, status verification and payment instructions are handled for sheng.an orders.",
    complianceNotice:
      "A redirect, screenshot, message, or browser return never proves payment. NOWPayments is live only when enabled server credentials and verification are configured; Wire and Zelle remain pending until an authorized administrator verifies the funds.",
  },
  {
    routeKey: "RESEARCH_USE_POLICY",
    adminSlug: "research-use-policy",
    internalSlug: "managed-route-research-use-policy",
    path: "/research-use",
    label: "Research-use policy",
    eyebrow: "Compliance",
    fallbackTitle: "Research use notice",
    fallbackSeoTitle: "Research Use and Compliance Notice",
    fallbackDescription:
      "Research-use restrictions, purchaser responsibilities and prohibited uses for products listed by sheng.an.",
    complianceNotice:
      "Products are for qualified laboratory and research use only. They are not medicines, supplements, foods, cosmetics, consumer products, or intended for use in humans or animals.",
  },
] as const satisfies readonly ManagedPageDefinition[];

const byRouteKey: ReadonlyMap<ManagedPageRouteKey, ManagedPageDefinition> = new Map(
  MANAGED_PAGE_DEFINITIONS.map((definition) => [
    definition.routeKey,
    definition,
  ]),
);
const byAdminSlug: ReadonlyMap<string, ManagedPageDefinition> = new Map(
  MANAGED_PAGE_DEFINITIONS.map((definition) => [
    definition.adminSlug,
    definition,
  ]),
);

export function getManagedPageDefinition(routeKey: string) {
  return byRouteKey.get(routeKey as ManagedPageRouteKey) ?? null;
}

export function getManagedPageDefinitionByAdminSlug(adminSlug: string) {
  return byAdminSlug.get(adminSlug) ?? null;
}

export function managedPagePublicPath(
  routeKey: string | null | undefined,
  fallbackSlug: string,
) {
  const definition = routeKey ? getManagedPageDefinition(routeKey) : null;
  return definition?.path ?? `/pages/${fallbackSlug}`;
}

export function isReservedManagedPageSlug(slug: string) {
  return MANAGED_PAGE_DEFINITIONS.some(
    (definition) => definition.internalSlug === slug,
  );
}
