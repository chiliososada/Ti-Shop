import type { Metadata } from "next";
import { connection } from "next/server";

import { CheckoutForm } from "@/app/(storefront)/checkout/CheckoutForm";
import { requireUser } from "@/server/auth/session";
import { getDefaultShippingAddressForUser } from "@/server/account/addresses";
import {
  getConfiguredCheckoutCharges,
  getEnabledPaymentMethods,
} from "@/server/orders/queries";
import { getPublicWhatsAppPresentation } from "@/server/whatsapp/config";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  await connection();
  const session = await requireUser("/checkout");
  const [
    paymentMethods,
    checkoutCharges,
    defaultShippingAddress,
    whatsapp,
  ] = await Promise.all([
    getEnabledPaymentMethods(),
    getConfiguredCheckoutCharges(),
    getDefaultShippingAddressForUser(session.user.id),
    getPublicWhatsAppPresentation(),
  ]);

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x">
        <div className="mb-10 max-w-3xl">
          <p className="font-mono text-eyebrow uppercase text-sage-600">
            Customer checkout
          </p>
          <h1 className="mt-4 text-h2 text-strong">Create your pending order</h1>
          <p className="mt-4 text-lg leading-relaxed text-body">
            Checkout requires an email/password account. Prices, payment state,
            and inventory are verified again on the server.
          </p>
        </div>
        <CheckoutForm
          customerEmail={session.user.email}
          paymentMethods={paymentMethods}
          checkoutCharges={checkoutCharges}
          defaultShippingAddress={defaultShippingAddress}
          whatsappEnabled={whatsapp !== null}
        />
      </div>
    </section>
  );
}
