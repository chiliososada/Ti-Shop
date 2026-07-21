import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui";
import type {
  PublicCategoryListItemDto,
  PublicHomePlacementPresentationDto,
  PublicProductSummaryDto,
} from "@/domain/catalog";

type ShowcaseItem = {
  product: PublicProductSummaryDto;
  presentation: PublicHomePlacementPresentationDto;
};

export function SpinShowcase({
  item,
  category,
  count,
  flip,
}: {
  item: ShowcaseItem;
  category: PublicCategoryListItemDto;
  count: number;
  flip: boolean;
}) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
      {/* Media — real Veripep product vial on a soft, rotating glow */}
      <Link
        href={`/products/${item.product.slug}`}
        className={`group relative flex aspect-square items-center justify-center overflow-hidden rounded-3xl bg-cream-50 ring-1 ring-ink-900/[0.06] ${
          flip ? "lg:order-2" : ""
        }`}
      >
        <div
          className="absolute h-[70%] w-[70%] rounded-full bg-[radial-gradient(circle,var(--color-sage-200)_0%,transparent_70%)] opacity-60 blur-2xl motion-safe:animate-[spin_22s_linear_infinite]"
          aria-hidden
        />
        <div className="relative h-[82%] w-[82%] motion-safe:animate-[float_6s_ease-in-out_infinite]">
          <Image
            src={item.presentation.imageUrl}
            alt={`${item.presentation.productName} — Veripep research peptide vial`}
            fill
            sizes="(max-width: 1024px) 90vw, 45vw"
            className="object-contain mix-blend-multiply transition-transform duration-700 group-hover:scale-[1.04]"
          />
        </div>
        <span className="absolute left-6 top-6 font-mono text-caption uppercase tracking-widest text-ink-400">
          {count} catalog listings
        </span>
        <span className="absolute bottom-6 left-6 rounded-full bg-cream-50/90 px-3 py-1 text-caption font-semibold text-strong ring-1 ring-ink-900/10 backdrop-blur-sm">
          {item.presentation.productName}
        </span>
      </Link>

      {/* Copy */}
      <div className={flip ? "lg:order-1" : ""}>
        <span className="font-mono text-h4 text-sage-500/70">
          {item.presentation.index}
        </span>
        <h3 className="mt-3 text-h3 text-strong">{category.name}</h3>
        <p className="mt-4 max-w-md text-lg leading-relaxed text-body">
          {item.presentation.benefit}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button href={`/categories/${category.slug}`} variant="primary">
            Explore category
          </Button>
          <Link
            href="/products"
            className="text-sm font-semibold text-strong underline-offset-4 hover:underline"
          >
            View all products
          </Link>
        </div>
      </div>
    </div>
  );
}
