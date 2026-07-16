import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { humanizeCommerceStatus } from "@/domain/order";
import { WhatsAppIntentButton } from "@/components/whatsapp/WhatsAppIntentButton";
import { getCurrentUserOrder } from "@/server/orders/queries";
import { getPublicWhatsAppPresentation } from "@/server/whatsapp/config";

export const metadata: Metadata = {
  title: "Payment status",
  description:
    "Return to the authenticated order record after NOWPayments checkout.",
  robots: { index: false, follow: false },
};

export default async function PaymentReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string | string[] }>;
}) {
  await connection();
  const params = await searchParams;
  const candidate = Array.isArray(params.order) ? params.order[0] : params.order;
  const publicId = z.string().uuid().safeParse(candidate);
  if (!publicId.success) notFound();
  const [order, whatsapp] = await Promise.all([
    getCurrentUserOrder(publicId.data),
    getPublicWhatsAppPresentation(),
  ]);
  if (!order) notFound();

  return (
    <section className="container-x flex min-h-[70vh] flex-col items-center justify-center py-24 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-surface-alt text-sage-600">
        <svg
          className="h-8 w-8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </div>
      <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
        {order.orderNumber}
      </p>
      <h1 className="mt-3 text-h2 text-strong">Payment verification</h1>
      <p className="mt-4 max-w-xl text-body">
        You returned from the provider checkout. A redirect is not proof of
        payment; this order is updated only from a verified provider event.
      </p>
      <div className="mt-6 rounded-2xl border border-ink-900/[0.08] bg-surface px-7 py-5">
        <p className="text-caption uppercase tracking-wider text-muted">
          Current recorded payment status
        </p>
        <p className="mt-2 text-h4 text-strong">
          {humanizeCommerceStatus(order.paymentStatus)}
        </p>
      </div>
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Link
          href={`/account/orders/${order.publicId}`}
          className="rounded-full bg-ink-900 px-7 py-3.5 text-sm font-semibold text-cream-50 transition-colors hover:bg-sage-600"
        >
          View authenticated order
        </Link>
        {whatsapp ? (
          <WhatsAppIntentButton
            intent={{
              templateKey: "order",
              orderPublicId: order.publicId,
            }}
            className="rounded-full border border-ink-900/15 px-7 py-3.5 text-sm font-semibold text-strong transition-colors hover:bg-ink-900/[0.04] disabled:cursor-wait disabled:opacity-70"
          >
            Ask on WhatsApp
          </WhatsAppIntentButton>
        ) : null}
      </div>
    </section>
  );
}
