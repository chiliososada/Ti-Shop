import Image from "next/image";

type BrandLogoProps = {
  className?: string;
  eager?: boolean;
};

/** The user-supplied Veripep mark and wordmark, trimmed for site chrome. */
export function BrandLogo({ className, eager = false }: BrandLogoProps) {
  return (
    <Image
      src="/brand/veripep-logo.png"
      alt="Veripep"
      width={373}
      height={290}
      className={className}
      sizes="(max-width: 768px) 88px, 112px"
      {...(eager ? { loading: "eager", fetchPriority: "high" } : {})}
    />
  );
}
