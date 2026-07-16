import type { ManagedPageRouteProps } from "@/app/_lib/managed-page-route";
import {
  generateManagedPageRouteMetadata,
  getManagedPageRouteData,
} from "@/app/_lib/managed-page-route";
import { ManagedPageContent } from "@/components/ManagedPageContent";
import { PolicyPage } from "@/components/PolicyPage";

export function generateMetadata({ searchParams }: ManagedPageRouteProps) {
  return generateManagedPageRouteMetadata("SHIPPING", searchParams);
}

function ShippingPolicyFallback() {
  return (
    <PolicyPage
      eyebrow="Order policies"
      title="Shipping policy"
      intro="The current storefront supports delivery to eligible addresses in the United States. Actual service and timing are confirmed for each order."
      path="/shipping"
      sections={[
        {
          heading: "Supported destinations",
          paragraphs: [
            "Orders are currently limited to supported United States addresses. Submitting an address does not guarantee that a product or route is eligible; the order is reviewed before fulfillment.",
          ],
        },
        {
          heading: "Address and dispatch",
          items: [
            "Customers are responsible for providing a complete deliverable address and a reachable contact method.",
            "Carrier, service level, shipping charge and any special handling are shown on the order or confirmed before dispatch.",
            "An order is not marked shipped until the merchant records an actual dispatch and, when available, a carrier and tracking number.",
          ],
        },
        {
          heading: "Tracking and estimates",
          paragraphs: [
            "Tracking displayed in the customer account may be entered by the merchant. Unless the page explicitly says that a carrier integration is active, it should not be treated as a live carrier feed. Estimated dates are estimates, not delivery guarantees.",
          ],
        },
        {
          heading: "Delivery issues",
          paragraphs: [
            "Contact us promptly if a parcel is damaged, missing items, materially delayed or marked delivered but cannot be found. Keep the packaging, label and product condition available for review. We will assess the available order and carrier records before proposing a resolution.",
          ],
        },
      ]}
    />
  );
}

export default async function ShippingPolicyPage() {
  const { definition, page } = await getManagedPageRouteData("SHIPPING");
  return page ? (
    <ManagedPageContent definition={definition} page={page} />
  ) : (
    <ShippingPolicyFallback />
  );
}
