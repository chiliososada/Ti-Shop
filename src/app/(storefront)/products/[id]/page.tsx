import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  publicRobots,
  type PublicSearchParams,
} from "@/app/_lib/public-seo";
import {
  BreadcrumbJsonLd,
  ProductJsonLd,
} from "@/components/JsonLd";
import { ProductCard } from "@/components/ProductCard";
import { ProductImageGallery } from "@/components/ProductImageGallery";
import { ProductPurchasePanel } from "@/components/cart/ProductPurchasePanel";
import { preparePublicProductGallery } from "@/components/product-image-gallery";
import { Pill } from "@/components/ui";
import {
  getPublicProductBySlug,
  getPublicProductList,
} from "@/server/catalog";
import { getPublicWhatsAppPresentation } from "@/server/whatsapp/config";

type ProductPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<PublicSearchParams>;
};

export async function generateMetadata({
  params,
  searchParams,
}: ProductPageProps): Promise<Metadata> {
  await connection();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const product = await getPublicProductBySlug(id);
  if (!product) notFound();

  const title =
    product.seo?.title ??
    `${product.title} — Research-Use Catalog`;
  const description =
    product.seo?.description ??
    product.shortDescription ??
    product.description ??
    product.title;
  const image = product.seo?.openGraphImage ?? product.primaryImage;
  const canonical = product.seo?.canonicalUrl ?? `/products/${product.slug}`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    robots: publicRobots(query, {
      noIndex: product.seo?.noIndex,
      noFollow: product.seo?.noFollow,
    }),
    openGraph: {
      type: "website",
      title,
      description,
      url: canonical,
      ...(image
        ? {
            images: [
              {
                url: image.url,
                alt: image.alt,
                ...(image.width ? { width: image.width } : {}),
                ...(image.height ? { height: image.height } : {}),
              },
            ],
          }
        : {}),
    },
  };
}

export default async function ProductDetail({ params }: ProductPageProps) {
  await connection();
  const { id } = await params;
  const [product, whatsapp] = await Promise.all([
    getPublicProductBySlug(id),
    getPublicWhatsAppPresentation(),
  ]);
  if (!product) notFound();

  const category = product.primaryCategory ?? product.categories[0] ?? null;
  const related = category
    ? (
        await getPublicProductList({
          categorySlug: category.slug,
          limit: 5,
        })
      )
        .filter((candidate) => candidate.publicId !== product.publicId)
        .slice(0, 4)
    : [];
  const galleryImages = preparePublicProductGallery(
    product.primaryImage,
    product.gallery,
  );
  const primaryImage = galleryImages[0] ?? null;

  const crumbs = [
    { name: "Home", url: "/" },
    { name: "Products", url: "/products" },
    ...(category
      ? [{ name: category.name, url: `/categories/${category.slug}` }]
      : []),
    {
      name: product.title,
      url: product.seo?.canonicalUrl ?? `/products/${product.slug}`,
    },
  ];
  const specs: [string, string | null][] = [
    ["Supplier presentation", product.subtitle],
    ["CAS Number", product.casNumber],
    ["Catalog purity field", product.purity],
    ["Catalog appearance", product.appearance],
    ["Catalog handling note", product.storageInstructions],
    ["Intended use", "Laboratory research only"],
  ];

  return (
    <>
      <ProductJsonLd product={product} />
      <BreadcrumbJsonLd items={crumbs} />

      <div className="border-b border-line bg-surface-alt">
        <nav
          aria-label="Breadcrumb"
          className="container-x flex flex-wrap items-center gap-2 py-4 text-caption text-muted"
        >
          {crumbs.map((breadcrumb, index) => (
            <span key={breadcrumb.url} className="flex items-center gap-2">
              {index > 0 ? <span className="text-line">/</span> : null}
              {index === crumbs.length - 1 ? (
                <span className="text-body">{breadcrumb.name}</span>
              ) : (
                <Link href={breadcrumb.url} className="hover:text-strong">
                  {breadcrumb.name}
                </Link>
              )}
            </span>
          ))}
        </nav>
      </div>

      <section className="section-y">
        <div className="container-x grid gap-12 lg:grid-cols-2">
          <div>
            <div className="relative">
              <ProductImageGallery
                key={product.publicId}
                images={galleryImages}
                productTitle={product.title}
              />
              <div className="absolute left-4 top-4 flex gap-2">
                {product.purity ? (
                  <Pill tone="sage">Catalog: {product.purity}</Pill>
                ) : null}
                <Pill tone="clay">Ask about lot documents</Pill>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center text-caption">
              {[
                ["Presentation", product.subtitle ?? "Confirm current"],
                ["Documents", "Ask before order"],
                ["Shipping", "Order-specific"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-line bg-surface-alt py-3"
                >
                  <div className="font-semibold text-strong">{label}</div>
                  <div className="text-muted">{value}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            {category ? (
              <Link
                href={`/categories/${category.slug}`}
                className="font-mono text-eyebrow uppercase text-sage-600"
              >
                {category.name}
              </Link>
            ) : null}
            <h1 className="mt-3 text-h2 text-strong">{product.title}</h1>
            <p className="mt-4 text-lg text-body">
              {product.description ?? product.shortDescription}
            </p>

            <div className="mt-6">
              <ProductPurchasePanel
                product={{
                  publicId: product.publicId,
                  slug: product.slug,
                  title: product.title,
                  subtitle: product.subtitle,
                  variants: product.variants,
                }}
                primaryImage={primaryImage}
                whatsappEnabled={whatsapp !== null}
              />
              <Link
                href="/faq"
                className="mt-4 inline-block text-sm font-semibold text-strong underline-offset-4 hover:underline"
              >
                Product documentation &amp; ordering FAQ →
              </Link>
            </div>

            <div className="mt-8 overflow-hidden rounded-lg ring-1 ring-line">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <tbody>
                  {specs
                    .filter((spec): spec is [string, string] => Boolean(spec[1]))
                    .map(([label, value], index, rows) => (
                      <tr key={label} className="even:bg-surface-alt">
                        <th
                          scope="row"
                          className={`w-2/5 px-5 py-3.5 text-left align-top font-medium text-muted ${
                            index < rows.length - 1
                              ? "border-b border-line"
                              : ""
                          }`}
                        >
                          {label}
                        </th>
                        <td
                          className={`px-5 py-3.5 font-mono text-strong ${
                            index < rows.length - 1
                              ? "border-b border-line"
                              : ""
                          }`}
                        >
                          {value}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {product.documents.length > 0 ? (
              <section
                className="mt-6 rounded-xl border border-line bg-surface-alt p-4"
                aria-labelledby="product-documents-heading"
              >
                <h2
                  id="product-documents-heading"
                  className="text-sm font-semibold text-strong"
                >
                  Public product documents
                </h2>
                <ul className="mt-3 space-y-2">
                  {product.documents.map((document) => (
                    <li key={document.publicId}>
                      <a
                        href={document.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm font-semibold text-sage-700 underline underline-offset-4"
                      >
                        {document.label}
                        <span aria-hidden>↗</span>
                      </a>
                      {document.mimeType ? (
                        <span className="ml-2 text-caption text-muted">
                          {document.mimeType}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-caption leading-relaxed text-muted">
                  These are the public files attached to this catalog item.
                  Confirm that a document applies to the product and lot for
                  your order before relying on it.
                </p>
              </section>
            ) : null}

            <p className="mt-4 text-caption leading-relaxed text-muted">
              Catalog fields are general product information. Confirm the
              actual label, current lot specification and available documents
              before relying on a value for procurement or research planning.
            </p>

            <p className="mt-6 rounded-xl border border-clay-300/40 bg-clay-50 px-4 py-3 text-caption text-body">
              <strong className="text-strong">Research Use Only.</strong> This
              product is intended strictly for laboratory research. It is not a
              drug, supplement or medical product and is not for human or
              veterinary consumption.
            </p>
          </div>
        </div>
      </section>

      {related.length > 0 ? (
        <section className="bg-surface-alt">
          <div className="container-x py-16 md:py-22">
            <h2 className="text-h4 text-strong">
              Related catalog products
            </h2>
            <div className="mt-8 grid grid-cols-2 gap-6 lg:grid-cols-4">
              {related.map((relatedProduct) => (
                <ProductCard
                  key={relatedProduct.publicId}
                  product={relatedProduct}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
