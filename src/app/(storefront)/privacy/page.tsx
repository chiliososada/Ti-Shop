import type { ManagedPageRouteProps } from "@/app/_lib/managed-page-route";
import {
  generateManagedPageRouteMetadata,
  getManagedPageRouteData,
} from "@/app/_lib/managed-page-route";
import { ManagedPageContent } from "@/components/ManagedPageContent";
import { PolicyPage } from "@/components/PolicyPage";

export function generateMetadata({ searchParams }: ManagedPageRouteProps) {
  return generateManagedPageRouteMetadata("PRIVACY_POLICY", searchParams);
}

function PrivacyPolicyFallback() {
  return (
    <PolicyPage
      eyebrow="Legal"
      title="Privacy policy"
      intro="This notice explains the information needed to operate accounts, orders, payments, fulfillment, security and customer support."
      path="/privacy"
      sections={[
        {
          heading: "Information we process",
          items: [
            "Account information such as name, email address, password credentials stored as protected authentication records, and session data.",
            "Order and fulfillment information such as products, delivery address, status, carrier and tracking events.",
            "Payment records such as method, amount, provider reference and status. We do not ask customers to place passwords or full financial credentials in WhatsApp messages.",
            "Support messages, operational notes, security logs and consent or preference records.",
          ],
        },
        {
          heading: "Why it is used",
          paragraphs: [
            "Information is used to provide requested services, authenticate users, create and fulfill orders, reconcile payments, respond to support requests, prevent abuse, keep audit records and meet applicable obligations.",
          ],
        },
        {
          heading: "Service providers and disclosure",
          paragraphs: [
            "Relevant data may be shared with infrastructure, payment, storage, communications and delivery providers only as needed for their role. Information may also be preserved or disclosed when reasonably necessary for security, disputes or legal requirements. We do not describe WhatsApp conversations as synchronized into this site unless a real integration is explicitly enabled.",
          ],
        },
        {
          heading: "Retention and protection",
          paragraphs: [
            "The system can contain account, order, payment, fulfillment, support, security and audit records. This notice does not claim that an automatic deletion or de-identification schedule is active. Access to administrative records is limited by role, sensitive configuration is not intended for public pages, and no internet service can promise absolute security.",
          ],
        },
        {
          heading: "Your choices",
          paragraphs: [
            "You may contact us to request access, correction or deletion where applicable. Some order, payment, security or audit records may need to be retained. Marketing preferences are separate from messages required to service an account or order.",
          ],
        },
      ]}
    />
  );
}

export default async function PrivacyPolicyPage() {
  const { definition, page } =
    await getManagedPageRouteData("PRIVACY_POLICY");
  return page ? (
    <ManagedPageContent definition={definition} page={page} />
  ) : (
    <PrivacyPolicyFallback />
  );
}
