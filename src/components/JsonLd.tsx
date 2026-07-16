import { company } from "@/data/company";
import type { PublicProductDetailDto } from "@/domain/catalog";
import type { PublicBlogPostDto } from "@/domain/content";
import { preparePublicProductGallery } from "@/components/product-image-gallery";
import { sanitizePublicAssetUrl } from "@/lib/public-asset-url";
import { resolvePublicSiteOrigin } from "@/lib/site-url";

const publicSiteOrigin = resolvePublicSiteOrigin();

export function serializeJsonLd(data: object) {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function absolutePublicUrl(value: string) {
  return new URL(value, publicSiteOrigin).toString();
}

function absolutePublicAssetUrl(value: string) {
  const sanitized = sanitizePublicAssetUrl(value);
  return sanitized ? absolutePublicUrl(sanitized) : null;
}

function usdMinorToDecimal(amountMinor: string) {
  if (!/^\d+$/u.test(amountMinor)) return null;
  const padded = amountMinor.padStart(3, "0");
  return `${padded.slice(0, -2).replace(/^0+(?=\d)/u, "")}.${padded.slice(-2)}`;
}

function Script({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}

export function OrganizationJsonLd() {
  return (
    <Script
      data={{
        "@context": "https://schema.org",
        "@type": "Organization",
        "@id": `${publicSiteOrigin}/#organization`,
        name: company.name,
        alternateName: "shengan",
        url: publicSiteOrigin,
        slogan: company.tagline,
        description: company.description,
        email: company.email,
        contactPoint: [
          {
            "@type": "ContactPoint",
            contactType: "customer support",
            email: company.email,
            areaServed: company.supportedCountries[0],
          },
        ],
      }}
    />
  );
}

export function WebSiteJsonLd() {
  return (
    <Script
      data={{
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": `${publicSiteOrigin}/#website`,
        url: publicSiteOrigin,
        name: company.name,
        alternateName: "shengan",
        description: company.description,
        inLanguage: "en-US",
        publisher: { "@id": `${publicSiteOrigin}/#organization` },
      }}
    />
  );
}

export function BreadcrumbJsonLd({
  items,
}: {
  items: { name: string; url: string }[];
}) {
  return (
    <Script
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map((it, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: it.name,
          item: absolutePublicUrl(it.url),
        })),
      }}
    />
  );
}

export function ProductJsonLd({
  product,
}: {
  product: PublicProductDetailDto;
}) {
  const canonicalUrl = absolutePublicUrl(
    product.seo?.canonicalUrl ?? `/products/${product.slug}`,
  );
  const offers = product.variants.flatMap((variant) => {
    const price = usdMinorToDecimal(variant.price.amountMinor);
    return price === null
      ? []
      : [
          {
            "@type": "Offer",
            name: variant.title,
            url: canonicalUrl,
            ...(variant.sku ? { sku: variant.sku } : {}),
            priceCurrency: variant.price.currency,
            price,
            availability: variant.directPurchaseAvailable
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
            eligibleQuantity: {
              "@type": "QuantitativeValue",
              minValue: variant.minimumOrderQuantity,
              unitCode: "EA",
            },
            itemCondition: "https://schema.org/NewCondition",
            seller: { "@id": `${publicSiteOrigin}/#organization` },
          },
        ];
  });
  const images = preparePublicProductGallery(
    product.primaryImage,
    product.gallery,
  )
    .flatMap((image) => {
      const url = absolutePublicAssetUrl(image.url);
      return url ? [url] : [];
    })
    .filter((url, index, all) => all.indexOf(url) === index);
  const additionalProperty = [
    product.purity
      ? {
          "@type": "PropertyValue",
          name: "Catalog purity field",
          value: product.purity,
        }
      : null,
    product.casNumber
      ? {
          "@type": "PropertyValue",
          name: "CAS Number",
          value: product.casNumber,
        }
      : null,
    {
      "@type": "PropertyValue",
      name: "Intended Use",
      value: "Laboratory and research use only",
    },
  ].filter((property) => property !== null);

  return (
    <Script
      data={{
        "@context": "https://schema.org",
        "@type": "Product",
        "@id": `${canonicalUrl}#product`,
        name: product.title,
        brand: {
          "@type": "Brand",
          name: product.brand ?? company.name,
        },
        description: `${product.description ?? product.shortDescription ?? product.title} For laboratory and research use only. Not for human consumption.`,
        ...(images.length > 0 ? { image: images } : {}),
        additionalProperty,
        ...(offers.length > 0
          ? { offers: offers.length === 1 ? offers[0] : offers }
          : {}),
      }}
    />
  );
}

export function ArticleJsonLd({ post }: { post: PublicBlogPostDto }) {
  const canonicalUrl = absolutePublicUrl(
    post.seo?.canonicalUrl ?? `/blog/${post.slug}`,
  );
  const description = post.seo?.description ?? post.excerpt ?? post.title;
  const heroImageUrl = post.heroImage
    ? absolutePublicAssetUrl(post.heroImage.url)
    : null;

  return (
    <Script
      data={{
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "@id": `${canonicalUrl}#article`,
        headline: post.title,
        description,
        ...(heroImageUrl
          ? { image: [heroImageUrl] }
          : {}),
        datePublished: post.publishedAt,
        dateModified: post.updatedAt,
        author: {
          "@type": "Organization",
          name: post.author ?? company.name,
        },
        publisher: {
          "@type": "Organization",
          name: company.name,
          "@id": `${publicSiteOrigin}/#organization`,
        },
        mainEntityOfPage: {
          "@type": "WebPage",
          "@id": canonicalUrl,
        },
        ...(post.structuredContent?.keyword
          ? { keywords: post.structuredContent.keyword }
          : {}),
      }}
    />
  );
}

export function FaqJsonLd({
  faqs,
}: {
  faqs: Array<
    { question: string; answer: string } | { q: string; a: string }
  >;
}) {
  return (
    <Script
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map((faq) => {
          const question = "question" in faq ? faq.question : faq.q;
          const answer = "answer" in faq ? faq.answer : faq.a;
          return {
            "@type": "Question",
            name: question,
            acceptedAnswer: { "@type": "Answer", text: answer },
          };
        }),
      }}
    />
  );
}

export function WebPageJsonLd({
  title,
  description,
  url,
  datePublished,
  dateModified,
}: {
  title: string;
  description: string;
  url: string;
  datePublished: string;
  dateModified: string;
}) {
  const canonicalUrl = absolutePublicUrl(url);
  return (
    <Script
      data={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        "@id": `${canonicalUrl}#webpage`,
        url: canonicalUrl,
        name: title,
        description,
        datePublished,
        dateModified,
        isPartOf: { "@id": `${publicSiteOrigin}/#website` },
        publisher: { "@id": `${publicSiteOrigin}/#organization` },
      }}
    />
  );
}
