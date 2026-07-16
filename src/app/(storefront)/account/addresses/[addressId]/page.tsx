import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AddressActionForm } from "@/app/(storefront)/account/addresses/_components/AddressActionForm";
import { AddressFields } from "@/app/(storefront)/account/addresses/_components/AddressFields";
import { updateAddressAction } from "@/app/(storefront)/account/addresses/actions";
import { getCurrentCustomerAddress } from "@/server/account/addresses";

export const metadata: Metadata = {
  title: "Edit saved address",
  robots: { index: false, follow: false },
};

export default async function EditCustomerAddressPage({
  params,
}: {
  params: Promise<{ addressId: string }>;
}) {
  await connection();
  const { addressId } = await params;
  const address = await getCurrentCustomerAddress(addressId);
  if (!address) notFound();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-3xl">
        <header>
          <Link
            href="/account/addresses"
            className="text-sm font-semibold text-sage-700"
          >
            ← Saved addresses
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Address book
          </p>
          <h1 className="mt-3 text-h2 text-strong">
            Edit {address.label ?? "address"}
          </h1>
          <p className="mt-3 leading-relaxed text-body">
            Changes apply to future use of this saved address. Address snapshots
            on existing orders remain unchanged.
          </p>
        </header>

        <article className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <AddressActionForm
            action={updateAddressAction}
            submitLabel="Save changes"
          >
            <input type="hidden" name="addressId" value={address.id} />
            <AddressFields address={address} />
          </AddressActionForm>
        </article>
      </div>
    </section>
  );
}
