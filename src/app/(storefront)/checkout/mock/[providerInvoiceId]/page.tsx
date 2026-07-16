import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { formatUsdMinor } from "@/domain/money";
import { humanizeCommerceStatus } from "@/domain/order";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getNowPaymentsRuntimeConfig } from "@/server/payments/nowpayments/runtime-config";

import { MockPaymentControls } from "./MockPaymentControls";

export const metadata: Metadata = {
  title: "Local payment simulation",
  robots: { index: false, follow: false },
};

export default async function MockNowPaymentsPage({
  params,
}: {
  params: Promise<{ providerInvoiceId: string }>;
}) {
  await connection();
  let config;
  try {
    config = getNowPaymentsRuntimeConfig();
  } catch {
    notFound();
  }
  if (process.env.NODE_ENV === "production" || config.mode !== "mock") {
    notFound();
  }

  const { providerInvoiceId } = await params;
  if (!/^mock-invoice-[a-f0-9]{24}$/u.test(providerInvoiceId)) notFound();
  const session = await requireUser(
    `/checkout/mock/${encodeURIComponent(providerInvoiceId)}`,
  );
  const payment = await getDb().payment.findFirst({
    where: {
      providerInvoiceId,
      method: "NOWPAYMENTS",
      order: { is: { userId: session.user.id } },
    },
    select: {
      status: true,
      amountMinor: true,
      currency: true,
      order: { select: { publicId: true, orderNumber: true } },
    },
  });
  if (!payment) notFound();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-3xl">
        <p className="font-mono text-eyebrow uppercase text-clay-600">
          Development-only simulation
        </p>
        <h1 className="mt-4 text-h2 text-strong">Mock NOWPayments checkout</h1>
        <div className="mt-6 rounded-2xl border border-clay-200 bg-clay-50 p-6 text-clay-700">
          <p className="font-semibold">This is not a real payment page.</p>
          <p className="mt-2 text-sm leading-relaxed">
            It exists only when the local mock adapter is explicitly enabled.
            No wallet address is issued, no cryptocurrency is transferred, and
            this route is unavailable in production.
          </p>
        </div>

        <article className="mt-6 rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <dl className="grid gap-5 sm:grid-cols-3">
            <div>
              <dt className="text-caption uppercase tracking-wider text-muted">
                Order
              </dt>
              <dd className="mt-2 font-mono text-sm text-strong">
                {payment.order.orderNumber}
              </dd>
            </div>
            <div>
              <dt className="text-caption uppercase tracking-wider text-muted">
                Amount
              </dt>
              <dd className="mt-2 font-semibold text-strong">
                {payment.currency === "USD"
                  ? formatUsdMinor(payment.amountMinor)
                  : payment.currency}
              </dd>
            </div>
            <div>
              <dt className="text-caption uppercase tracking-wider text-muted">
                Local status
              </dt>
              <dd className="mt-2 font-semibold text-strong">
                {humanizeCommerceStatus(payment.status)}
              </dd>
            </div>
          </dl>

          <MockPaymentControls providerInvoiceId={providerInvoiceId} />
        </article>

        <Link
          href={`/account/orders/${payment.order.publicId}`}
          className="mt-6 inline-flex text-sm font-semibold text-sage-700 hover:underline"
        >
          Return to authenticated order details →
        </Link>
      </div>
    </section>
  );
}
