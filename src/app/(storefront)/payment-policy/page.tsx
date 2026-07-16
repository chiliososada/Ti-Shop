import type { ManagedPageRouteProps } from "@/app/_lib/managed-page-route";
import {
  generateManagedPageRouteMetadata,
  getManagedPageRouteData,
} from "@/app/_lib/managed-page-route";
import { ManagedPageContent } from "@/components/ManagedPageContent";
import { PolicyPage } from "@/components/PolicyPage";

export function generateMetadata({ searchParams }: ManagedPageRouteProps) {
  return generateManagedPageRouteMetadata("PAYMENT_POLICY", searchParams);
}

function PaymentPolicyFallback() {
  return (
    <PolicyPage
      eyebrow="Order policies"
      title="Payment policy"
      intro="A method is available only when it is enabled and shown for the specific order. A redirect or screenshot alone never proves that payment completed."
      path="/payment-policy"
      sections={[
        {
          heading: "NOWPayments",
          paragraphs: [
            "When online payment is enabled, the site first creates a local order and then requests a hosted payment from NOWPayments. Final status is based on a verified server event or reconciliation query, not the browser return page. Until enabled credentials and server verification are configured, the storefront must not represent NOWPayments as live.",
          ],
        },
        {
          heading: "Wire transfer and Zelle",
          paragraphs: [
            "Manual-payment instructions are provided only for an eligible order after the method is configured. Do not send funds to details copied from an unrelated message or public page. A submitted reference or proof remains pending review until an authorized administrator confirms the amount and payment.",
          ],
        },
        {
          heading: "Statuses and order handling",
          items: [
            "Pending or confirming means funds have not yet been accepted as fully paid.",
            "Partial, excess, failed, expired, reversed and refunded outcomes are recorded separately from the order and fulfillment status.",
            "Products are not released for fulfillment merely because the customer returns from a payment provider or uploads evidence.",
          ],
        },
        {
          heading: "Protecting payment information",
          paragraphs: [
            "Never send account passwords, private keys, recovery phrases or full bank-login credentials to us. Report any conflicting payment instructions before paying. Sensitive merchant payment configuration is not published unconditionally on the storefront.",
          ],
        },
      ]}
    />
  );
}

export default async function PaymentPolicyPage() {
  const { definition, page } =
    await getManagedPageRouteData("PAYMENT_POLICY");
  return page ? (
    <ManagedPageContent definition={definition} page={page} />
  ) : (
    <PaymentPolicyFallback />
  );
}
