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
import { getOrderMode } from "@/server/commerce/order-mode";

/** Customer-facing chrome: header, footer, cart, WhatsApp entry, JSON-LD. */
export default async function StorefrontLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  const [whatsapp, categories, headerNavigation, footerNavigation, orderMode] = await Promise.all([
    getPublicWhatsAppPresentation(),
    getPublicCategories(),
    getPublicNavigation("header"),
    getPublicNavigation("footer"),
    getOrderMode(),
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
        <CartDrawer whatsappEnabled={whatsapp !== null} orderMode={orderMode} />
        {whatsapp ? (
          <FloatingWhatsAppEntry
            welcomeMessage={whatsapp.welcomeMessage}
          />
        ) : null}
      </CartProvider>
    </>
  );
}
