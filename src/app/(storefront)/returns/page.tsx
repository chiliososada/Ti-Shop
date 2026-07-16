import type { ManagedPageRouteProps } from "@/app/_lib/managed-page-route";
import {
  generateManagedPageRouteMetadata,
  getManagedPageRouteData,
} from "@/app/_lib/managed-page-route";
import { ManagedPageContent } from "@/components/ManagedPageContent";
import { PolicyPage } from "@/components/PolicyPage";

export function generateMetadata({ searchParams }: ManagedPageRouteProps) {
  return generateManagedPageRouteMetadata("RETURNS_AND_REFUNDS", searchParams);
}

function ReturnsPolicyFallback() {
  return (
    <PolicyPage
      eyebrow="Order policies"
      title="Returns and refunds"
      intro="Research materials can have storage, integrity and traceability constraints, so every request is reviewed against the specific order and product condition."
      path="/returns"
      sections={[
        {
          heading: "Request a review first",
          paragraphs: [
            "Do not send an item back without return instructions. Contact us with the public order reference, affected item, issue description and relevant photos. Do not send account credentials, payment details or sensitive personal information through WhatsApp.",
          ],
        },
        {
          heading: "What we assess",
          items: [
            "Whether the wrong item, quantity or condition was delivered.",
            "Whether damage or a documented quality issue can be verified from the available evidence.",
            "Whether the item has been opened, used, stored incorrectly or otherwise cannot be safely returned to inventory.",
            "Any mandatory rights that apply and cannot lawfully be excluded.",
          ],
        },
        {
          heading: "Approved outcomes",
          paragraphs: [
            "After review, an approved resolution may be a replacement or a full refund. Partial refunds and account credits are not currently offered through the website. A request is not approved merely because a message or parcel was sent.",
          ],
        },
        {
          heading: "Payment timing",
          paragraphs: [
            "For an eligible Wire or Zelle order, an administrator records a full refund only after the external bank transfer has been completed and verified; the website does not move those funds. Other payment methods require provider-specific review before any refund is promised. Processing time depends on the payment method and provider.",
          ],
        },
      ]}
    />
  );
}

export default async function ReturnsPolicyPage() {
  const { definition, page } =
    await getManagedPageRouteData("RETURNS_AND_REFUNDS");
  return page ? (
    <ManagedPageContent definition={definition} page={page} />
  ) : (
    <ReturnsPolicyFallback />
  );
}
