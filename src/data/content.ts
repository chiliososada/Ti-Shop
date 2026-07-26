import { categories } from "./categories";
import { products } from "./products";

// Public marketing copy must stay within facts the storefront can demonstrate.
// Lot documents, availability, handling and delivery details are confirmed per order.

export const hero = {
  h1: "Research Materials for Laboratory Procurement",
  subhead:
    "Browse research-use materials with USD pricing where published. Availability, lot-specific specifications, documentation and shipping eligibility are confirmed before fulfillment. Not for human or veterinary use.",
  ctaPrimary: { label: "Browse the Catalog", href: "/products" },
  ctaSecondary: { label: "Discuss Your Requirements", href: "/contact" },
};

export const homeSections = {
  documentation: {
    eyebrow: "Specifications & Documentation",
    heading: "Confirm the Current Product and Lot Details",
    intro:
      "Catalog details help identify a material, but they do not replace the documents for the product and lot you may receive. Ask us to confirm the current specification and the availability of a COA, SDS or other requested document before ordering.",
  },
  catalogue: {
    eyebrow: "Research Catalog",
    heading: `${products.length} Catalog Listings Across ${categories.length} Categories`,
    intro:
      `Explore ${products.length} research-use listings across ${categories.length} categories. Each listing is grouped by research area to support catalog discovery; suitability for a particular experiment remains the purchaser's responsibility.`,
  },
  shipping: {
    eyebrow: "United States Orders",
    heading: "Shipping Details Confirmed Per Order",
    intro:
      "The storefront supports eligible United States addresses. Product availability, carrier, service level, cost, handling requirements and estimated timing are confirmed for the specific order; estimates are not delivery guarantees.",
  },
  process: {
    eyebrow: "Ordering Process",
    heading: "From Catalog Review to Customer Order Record",
    intro:
      "Choose a catalog item, confirm its current details, submit an order and use your customer account to follow the recorded payment and fulfillment status. A tracked WhatsApp handoff is shown only when an administrator has configured it.",
  },
  why: {
    eyebrow: "Why Flintmarrow",
    heading: "A Clearer Procurement Conversation",
    intro:
      "Flintmarrow combines a research-use catalog, USD order records and administrator-managed contact options. Product, documentation, payment and shipping details are confirmed against the actual request instead of being presented as universal guarantees.",
  },
};

export const processSteps = [
  {
    title: "Identify the Material",
    body: "Use the product name, presentation and CAS reference, where shown, to identify the catalog item you want to discuss.",
  },
  {
    title: "Confirm Current Details",
    body: "Ask about availability, lot-specific specifications, requested documents and any handling requirements before relying on catalog copy.",
  },
  {
    title: "Create an Order Record",
    body: "The server confirms current USD pricing and creates an order before an enabled payment method is used.",
  },
  {
    title: "Follow Recorded Updates",
    body: "Payment, fulfillment, shipment and tracking details appear only when the relevant status or event has been recorded.",
  },
];

export const guarantees = [
  {
    title: "Product-specific details",
    body: "Specifications and lot documents are described only when available for the relevant product; confirm them before ordering.",
  },
  {
    title: "Clear USD pricing",
    body: "Published fixed prices are displayed in USD. Products without a current fixed price are clearly marked for a quote.",
  },
  {
    title: "Visible order records",
    body: "Signed-in customers can review recorded order, payment, fulfillment and shipment information in their account.",
  },
  {
    title: "Direct conversation",
    body: "Use the contact options currently shown by the storefront to discuss product requirements, documentation and order questions before making a manual payment.",
  },
];

export const about = {
  intro:
    "A research-use catalog and order service for supported United States procurement.",
  paragraphs: [
    "Flintmarrow lists peptide-related research materials for laboratory procurement. The storefront is organized around clear catalog discovery, USD pricing where a current fixed price is available, and customer order records.",
    "Product names, CAS references and catalog descriptions help identify materials, but they do not prove the specification of a particular lot. Current availability, presentation, analytical documentation and handling information must be confirmed for the product and lot under discussion.",
    "Customers can discuss requirements through the contact options currently enabled on the storefront before or after placing an order. Shipping is limited to eligible United States addresses, and carrier, timing, handling and documentation are confirmed for each order. Products are for laboratory research only and are not for human or veterinary use.",
  ],
  principles: [
    {
      title: "Catalog clarity",
      body: "Product identity, presentation and current price mode are separated from claims that require lot-specific evidence.",
    },
    {
      title: "Order-level confirmation",
      body: "Availability, documents, shipping and payment instructions are confirmed for the actual customer request.",
    },
    {
      title: "Customer visibility",
      body: "Recorded order, payment, fulfillment and shipment information is available through the signed-in customer account.",
    },
    {
      title: "Research-use boundaries",
      body: "Catalog content supports laboratory procurement and is not medical advice or a direction for personal use.",
    },
  ],
};

export const categoryIntros: Record<string, string> = {
  "bac-water":
    "Browse bacteriostatic water, sterile water, acetic-acid water and related laboratory solution listings. Confirm the exact presentation, composition, documentation and handling instructions for the item before ordering. Not for human or veterinary use.",
  "muscle-growth":
    "Explore catalog listings commonly grouped with tissue-repair and growth-factor research, including BPC-157, TB-500, Follistatin, IGF and MGF families. Confirm current product and lot details before ordering. Research use only.",
  antibacterial:
    "Explore listings commonly referenced in antimicrobial, immune, inflammation and cell-signaling research, including LL-37, KPV and Thymosin α-1. Confirm current product and lot details before ordering. Research use only.",
  "growth-energy":
    "Browse CJC-1295, Sermorelin, Tesamorelin, GHRP-2/6 and related growth-axis, endocrine, neuropeptide and organ-function listings. Confirm the current presentation, specification and available documentation for the requested material. Not for human or veterinary use.",
  metabolic:
    "Browse incretin, metabolic-signaling and mitochondrial research listings including Semaglutide, Tirzepatide, Retatrutide, MOTS-c and SS-31. Catalog grouping does not establish suitability for a particular experiment; confirm current product and lot details before ordering. Research use only.",
  "skin-aging":
    "Explore catalog listings commonly referenced in skin, pigmentation and longevity-pathway research, including GHK-Cu, Epitalon, FOXO4, Melanotan and GLOW families. Confirm current product and lot details before ordering. Research use only.",
};

export const faqs = [
  {
    q: "Are Flintmarrow products intended for human use?",
    a: "No. Products are listed strictly for laboratory and research use. They are not offered as drugs, dietary supplements, foods, cosmetics or medical products and are not intended for human or veterinary consumption, diagnosis, treatment or self-administration.",
  },
  {
    q: "How can I confirm a product's current specification?",
    a: "Ask us to confirm the current product and lot details before ordering. A catalog value is not a substitute for lot-specific documentation, and the storefront does not present a purity or test result unless supporting information has been made available for that product.",
  },
  {
    q: "Is a Certificate of Analysis (COA) available?",
    a: "COA availability must be confirmed for the specific product and lot. Request the document before ordering if it is required for your procurement process; a general catalog page does not prove that a lot-specific document exists.",
  },
  {
    q: "Which countries do you ship to, and how?",
    a: "The storefront currently accepts eligible United States addresses only. Carrier, service level, charges, handling requirements and estimated timing are confirmed for each order. An estimate is not a delivery guarantee.",
  },
  {
    q: "How should research materials be stored?",
    a: "Follow the actual label, lot documentation and your laboratory's qualified procedures. Catalog handling notes are general information and should not be used when they conflict with the documentation for the material received.",
  },
  {
    q: "Can I discuss a custom requirement?",
    a: "Yes. Send the requested sequence or material, quantity, presentation, documentation needs and destination through a contact option currently enabled on the storefront. We will confirm what can be supported and provide any lead-time estimate in writing.",
  },
  {
    q: "What payment methods do you accept?",
    a: "Only methods enabled for the specific order may be used. NOWPayments may be offered for direct online payment when live configuration is enabled. Electronic bank transfer or Zelle instructions are provided only after order details are confirmed. Do not send funds to details copied from an unrelated message or public page.",
  },
  {
    q: "What is your returns and support policy?",
    a: "Contact us with the order reference and available evidence if an issue arises. Requests are reviewed case by case under the published returns policy; contacting support does not by itself approve a return, replacement or refund.",
  },
];
