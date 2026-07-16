import type { ManagedPageRouteProps } from "@/app/_lib/managed-page-route";
import {
  generateManagedPageRouteMetadata,
  getManagedPageRouteData,
} from "@/app/_lib/managed-page-route";
import { ManagedPageContent } from "@/components/ManagedPageContent";
import { PolicyPage } from "@/components/PolicyPage";

export function generateMetadata({ searchParams }: ManagedPageRouteProps) {
  return generateManagedPageRouteMetadata("TERMS_OF_SERVICE", searchParams);
}

function TermsFallback() {
  return (
    <PolicyPage
      eyebrow="Legal"
      title="Terms of use and sale"
      intro="These terms govern use of this storefront and orders submitted through it. Product-specific and order-specific terms remain visible in the relevant record."
      path="/terms"
      sections={[
        {
          heading: "Eligibility and accounts",
          paragraphs: [
            "You must be able to enter a binding agreement and provide accurate account and order information. Keep account credentials confidential and notify us if you believe an account has been compromised.",
          ],
        },
        {
          heading: "Research use only",
          paragraphs: [
            "Products are supplied for legitimate laboratory and research use only, not for human or veterinary use, food, cosmetics, household use, diagnosis, treatment or self-administration. The purchaser is responsible for qualified handling, storage, approvals and lawful use.",
          ],
        },
        {
          heading: "Orders, pricing and acceptance",
          paragraphs: [
            "Prices are shown in USD unless stated otherwise. An order submission is a request to purchase; acceptance occurs only when the order is confirmed. We may reject or cancel an order for availability, pricing error, unsupported destination, suspected misuse, security review or another legitimate operational reason. Any payment already received for a canceled order will be handled through the applicable payment process.",
          ],
        },
        {
          heading: "Payments and fulfillment",
          paragraphs: [
            "Only payment methods enabled for the order may be used. Manual payments are not considered paid until reviewed and confirmed by an authorized administrator. Shipping and returns are governed by the published policies and the facts recorded on the order.",
          ],
        },
        {
          heading: "Site content and acceptable use",
          paragraphs: [
            "Site content is general product and research information, not medical or professional advice. Do not probe, disrupt, scrape abusively, bypass access controls, impersonate another person or use the site for unlawful activity.",
          ],
        },
      ]}
    />
  );
}

export default async function TermsPage() {
  const { definition, page } =
    await getManagedPageRouteData("TERMS_OF_SERVICE");
  return page ? (
    <ManagedPageContent definition={definition} page={page} />
  ) : (
    <TermsFallback />
  );
}
