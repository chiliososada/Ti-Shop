import type { Metadata } from "next";
import { Manrope, Geist_Mono } from "next/font/google";
import "./globals.css";
import { resolvePublicSiteOrigin } from "@/lib/site-url";

const sans = Manrope({
  variable: "--font-sans-src",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const mono = Geist_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const publicSiteOrigin = resolvePublicSiteOrigin();

export const metadata: Metadata = {
  metadataBase: new URL(publicSiteOrigin),
  title: {
    default: "sheng.an | Research Materials for Laboratory Procurement",
    template: "%s | sheng.an",
  },
  description:
    "Research-use peptide catalog with USD pricing where published and ordering for eligible US addresses. Confirm current specifications and documentation before purchase.",
  keywords: [
    "research-use peptide catalog",
    "laboratory research materials",
    "US research material procurement",
    "peptide catalog documentation",
    "research material specifications",
  ],
  openGraph: {
    type: "website",
    siteName: "sheng.an",
    title: "sheng.an | Research Materials for Laboratory Procurement",
    description:
      "Browse research-use materials with USD pricing where published. Current specifications, documentation and US shipping details are confirmed per order.",
    url: publicSiteOrigin,
    images: [
      {
        url: "/video/hero-poster.jpg",
        width: 1920,
        height: 1080,
        alt: "sheng.an research material catalog",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "sheng.an | Research Materials for Laboratory Procurement",
    description:
      "Browse research-use materials with USD pricing where published and ordering for supported US addresses.",
    images: ["/video/hero-poster.jpg"],
  },
  robots: { index: true, follow: true },
};

/**
 * Bare document shell. The customer-facing chrome (header, footer, cart,
 * WhatsApp entry) lives in the (storefront) group layout, and /admin renders
 * its own chrome — the two surfaces share only fonts and global CSS, so an
 * administrator can never wander out of the console through storefront
 * navigation embedded in its frame.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-base text-body">
        {children}
      </body>
    </html>
  );
}
