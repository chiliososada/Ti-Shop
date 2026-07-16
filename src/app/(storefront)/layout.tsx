import { connection } from "next/server";

import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { OrganizationJsonLd, WebSiteJsonLd } from "@/components/JsonLd";
import { CartProvider } from "@/components/cart/CartProvider";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { FloatingWhatsAppEntry } from "@/components/whatsapp/FloatingWhatsAppEntry";
import { getPublicCategories } from "@/server/catalog";
import { getPublicNavigation } from "@/server/navigation/public";
import { getPublicWhatsAppPresentation } from "@/server/whatsapp/config";

/** Customer-facing chrome: header, footer, cart, WhatsApp entry, JSON-LD. */
export default async function StorefrontLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  const [whatsapp, categories, headerNavigation, footerNavigation] = await Promise.all([
    getPublicWhatsAppPresentation(),
    getPublicCategories(),
    getPublicNavigation("header"),
    getPublicNavigation("footer"),
  ]);

  return (
    <>
      <OrganizationJsonLd />
      <WebSiteJsonLd />
      <CartProvider>
        <SiteHeader
          categories={categories}
          navigation={headerNavigation}
        />
        <main className="flex-1">{children}</main>
        <SiteFooter
          whatsapp={whatsapp}
          categories={categories}
          navigation={footerNavigation}
        />
        <CartDrawer whatsappEnabled={whatsapp !== null} />
        {whatsapp ? (
          <FloatingWhatsAppEntry
            welcomeMessage={whatsapp.welcomeMessage}
          />
        ) : null}
      </CartProvider>
    </>
  );
}
