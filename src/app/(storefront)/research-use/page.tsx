import type { ManagedPageRouteProps } from "@/app/_lib/managed-page-route";
import {
  generateManagedPageRouteMetadata,
  getManagedPageRouteData,
} from "@/app/_lib/managed-page-route";
import { ManagedPageContent } from "@/components/ManagedPageContent";
import { PolicyPage } from "@/components/PolicyPage";

export function generateMetadata({ searchParams }: ManagedPageRouteProps) {
  return generateManagedPageRouteMetadata("RESEARCH_USE_POLICY", searchParams);
}

function ResearchUseFallback() {
  return (
    <PolicyPage
      eyebrow="Compliance"
      title="Research use notice"
      intro="The catalog is intended for qualified laboratory and research procurement. Product listings are not directions for personal or clinical use."
      path="/research-use"
      sections={[
        {
          heading: "Not for human or veterinary use",
          paragraphs: [
            "Products are not offered as medicines, supplements, foods, cosmetics or consumer products. They are not intended for diagnosis, treatment, cure, prevention, self-administration or use in humans or animals.",
          ],
        },
        {
          heading: "Purchaser responsibilities",
          items: [
            "Confirm that purchase, import, possession, storage and intended research are lawful in the relevant jurisdiction.",
            "Use trained personnel, suitable facilities, documented protocols and appropriate protective equipment.",
            "Review the actual label, lot documentation and available safety information rather than relying only on marketing copy.",
            "Maintain traceability and dispose of material according to applicable requirements.",
          ],
        },
        {
          heading: "Product information",
          paragraphs: [
            "Names, CAS references and technical descriptions help identify catalog material but do not establish suitability for a particular experiment. Availability of a specification, COA or SDS must be confirmed for the actual product and lot; the site must not imply that a document exists when none has been uploaded.",
          ],
        },
        {
          heading: "Orders may be declined",
          paragraphs: [
            "We may request clarification or decline an order when the destination, purchaser, requested use, regulatory status, safety concern or available documentation cannot be supported.",
          ],
        },
      ]}
    />
  );
}

export default async function ResearchUsePage() {
  const { definition, page } =
    await getManagedPageRouteData("RESEARCH_USE_POLICY");
  return page ? (
    <ManagedPageContent definition={definition} page={page} />
  ) : (
    <ResearchUseFallback />
  );
}
