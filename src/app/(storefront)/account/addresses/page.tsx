import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AddressActionForm } from "@/app/(storefront)/account/addresses/_components/AddressActionForm";
import { AddressFields } from "@/app/(storefront)/account/addresses/_components/AddressFields";
import {
  createAddressAction,
  deleteAddressAction,
} from "@/app/(storefront)/account/addresses/actions";
import {
  getCurrentCustomerAddresses,
  MAX_ACTIVE_CUSTOMER_ADDRESSES,
} from "@/server/account/addresses";

export const metadata: Metadata = {
  title: "Saved addresses",
  robots: { index: false, follow: false },
};

export default async function CustomerAddressesPage() {
  await connection();
  const addresses = await getCurrentCustomerAddresses();
  const canCreate = addresses.length < MAX_ACTIVE_CUSTOMER_ADDRESSES;

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-6xl">
        <header>
          <Link href="/account" className="text-sm font-semibold text-sage-700">
            ← My account
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Address book
          </p>
          <h1 className="mt-3 text-h2 text-strong">Saved addresses</h1>
          <p className="mt-3 max-w-3xl leading-relaxed text-body">
            Store up to {MAX_ACTIVE_CUSTOMER_ADDRESSES} United States addresses
            and choose separate shipping and billing defaults. Existing orders
            keep their own address snapshots when an address is edited or
            removed here.
          </p>
        </header>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)] lg:items-start">
          <section>
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-h4 text-strong">Your address book</h2>
                <p className="mt-2 text-sm text-muted">
                  {addresses.length} of {MAX_ACTIVE_CUSTOMER_ADDRESSES} active
                  addresses
                </p>
              </div>
            </div>

            {addresses.length ? (
              <div className="mt-5 space-y-4">
                {addresses.map((address) => (
                  <article
                    key={address.id}
                    className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-h5 text-strong">
                            {address.label ?? address.recipientName}
                          </h3>
                          {address.isDefaultShipping ? (
                            <span className="rounded-full bg-sage-100 px-3 py-1 text-xs font-semibold text-sage-800">
                              Default shipping
                            </span>
                          ) : null}
                          {address.isDefaultBilling ? (
                            <span className="rounded-full bg-clay-100 px-3 py-1 text-xs font-semibold text-clay-700">
                              Default billing
                            </span>
                          ) : null}
                        </div>
                        <address className="mt-3 not-italic leading-relaxed text-body">
                          <span className="block">{address.recipientName}</span>
                          {address.company ? (
                            <span className="block">{address.company}</span>
                          ) : null}
                          <span className="block">
                            {address.line1}
                            {address.line2 ? `, ${address.line2}` : ""}
                          </span>
                          <span className="block">
                            {address.city}, {address.region} {address.postalCode}
                          </span>
                          <span className="block">United States</span>
                          {address.phone ? (
                            <span className="mt-1 block">{address.phone}</span>
                          ) : null}
                        </address>
                      </div>
                      <Link
                        href={`/account/addresses/${address.id}`}
                        className="rounded-full border border-ink-900/15 px-4 py-2 text-sm font-semibold text-strong transition hover:bg-surface-alt"
                      >
                        Edit
                      </Link>
                    </div>

                    <div className="mt-5 border-t border-line pt-4">
                      <AddressActionForm
                        action={deleteAddressAction}
                        submitLabel="Remove from address book"
                        pendingLabel="Removing…"
                        className="space-y-3"
                        tone="danger"
                      >
                        <input type="hidden" name="addressId" value={address.id} />
                        <p className="text-xs leading-relaxed text-muted">
                          This is a soft removal. It never changes an address
                          saved on a previous order.
                        </p>
                      </AddressActionForm>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-ink-900/15 bg-surface p-8 text-center">
                <h3 className="text-h5 text-strong">No saved addresses yet</h3>
                <p className="mt-2 text-sm text-muted">
                  Add your first US address using the form.
                </p>
              </div>
            )}
          </section>

          <aside className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-7 lg:sticky lg:top-28">
            <h2 className="text-h4 text-strong">Add an address</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Saved addresses are available to this signed-in account only.
            </p>
            {canCreate ? (
              <AddressActionForm
                action={createAddressAction}
                submitLabel="Save address"
                className="mt-6 space-y-6"
              >
                <input type="hidden" name="submissionId" value={randomUUID()} />
                <AddressFields />
              </AddressActionForm>
            ) : (
              <p className="mt-6 rounded-xl border border-clay-300/40 bg-clay-50 px-4 py-3 text-sm text-clay-700">
                Remove an address before adding another one.
              </p>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
