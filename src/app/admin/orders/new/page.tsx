import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { ManualOrderForm } from "@/app/admin/orders/new/ManualOrderForm";
import { buildQueryHref, type SearchParameter } from "@/lib/pagination";
import { getAdminManualOrderForm } from "@/server/admin/orders/manual-order-queries";

export const metadata: Metadata = {
  title: "Create manual order",
  robots: { index: false, follow: false },
};

export default async function NewAdminOrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParameter>>;
}) {
  await connection();
  const result = await getAdminManualOrderForm(await searchParams);
  const submissionId = randomUUID();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-6xl">
        <header>
          <Link href="/admin/orders" className="text-sm font-semibold text-sage-700">
            ← Orders and payments
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Controlled operation
          </p>
          <h1 className="mt-3 text-h2 text-strong">Create a manual customer order</h1>
          <p className="mt-3 max-w-3xl text-body">
            Use this after a WhatsApp arrangement. The order and payment attempt are always created in pending state; payment receipt is never inferred here.
          </p>
        </header>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <form action="/admin/orders/new" method="get" className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h4 text-strong">Find an eligible customer</h2>
            <p className="mt-2 text-sm text-muted">
              Only verified, active customer-only accounts configured for US and USD are selectable.
            </p>
            <input type="hidden" name="variantQ" value={result.filters.variantQuery} />
            {result.selectedCustomer ? (
              <input type="hidden" name="customer" value={result.selectedCustomer.id} />
            ) : null}
            <label className="mt-5 block text-sm font-semibold text-strong">
              Name or email
              <input name="customerQ" defaultValue={result.filters.customerQuery} maxLength={120} className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal" />
            </label>
            <button type="submit" className="mt-4 rounded-full bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white">
              Search customers
            </button>
            <div className="mt-5 max-h-72 space-y-2 overflow-y-auto">
              {result.customers.map((customer) => (
                <Link
                  key={customer.id}
                  href={buildQueryHref("/admin/orders/new", {
                    customer: customer.id,
                    customerQ: result.filters.customerQuery,
                    variantQ: result.filters.variantQuery,
                  })}
                  className={`block rounded-xl border p-3 text-sm ${
                    result.selectedCustomer?.id === customer.id
                      ? "border-sage-700 bg-sage-50"
                      : "border-line hover:bg-surface-alt"
                  }`}
                >
                  <span className="font-semibold text-strong">{customer.name}</span>
                  <span className="mt-1 block text-muted">{customer.email}</span>
                </Link>
              ))}
            </div>
            {result.customersTruncated ? (
              <p className="mt-3 text-xs text-muted">More customers match. Narrow the search to select the right account.</p>
            ) : null}
          </form>

          <form action="/admin/orders/new" method="get" className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <h2 className="text-h4 text-strong">Filter purchasable variants</h2>
            <p className="mt-2 text-sm text-muted">
              Search the current published, fixed-price USD/US catalog before composing the order.
            </p>
            {result.selectedCustomer ? (
              <input type="hidden" name="customer" value={result.selectedCustomer.id} />
            ) : null}
            <input type="hidden" name="customerQ" value={result.filters.customerQuery} />
            <label className="mt-5 block text-sm font-semibold text-strong">
              Product, variant, or SKU
              <input name="variantQ" defaultValue={result.filters.variantQuery} maxLength={120} className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal" />
            </label>
            <button type="submit" className="mt-4 rounded-full bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white">
              Search variants
            </button>
            <p className="mt-5 text-sm text-muted">
              {result.variants.length} valid variant{result.variants.length === 1 ? "" : "s"} available in this form.
              {result.variantsTruncated ? " Narrow the search to see a specific variant." : ""}
            </p>
          </form>
        </div>

        {!result.selectedCustomer ? (
          <div className="mt-8 rounded-2xl border border-amber-700/20 bg-amber-50 p-6 text-amber-950">
            Select an eligible customer to continue.
          </div>
        ) : !result.checkoutChargesConfigured ? (
          <div className="mt-8 rounded-2xl border border-red-700/20 bg-red-50 p-6 text-red-900">
            Checkout shipping and tax charges are not fully configured. Configure them before creating an order.
          </div>
        ) : result.paymentMethods.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-red-700/20 bg-red-50 p-6 text-red-900">
            Neither Wire transfer nor Zelle is currently operational. Enable and configure a supported method first.
          </div>
        ) : result.variants.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-amber-700/20 bg-amber-50 p-6 text-amber-950">
            No valid fixed-price variants match this search. Change the product filter before continuing.
          </div>
        ) : (
          <ManualOrderForm
            submissionId={submissionId}
            customerUserId={result.selectedCustomer.id}
            customerEmail={result.selectedCustomer.email}
            addresses={result.selectedCustomer.addresses}
            variants={result.variants}
            paymentMethods={result.paymentMethods}
          />
        )}
      </div>
    </section>
  );
}
