import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { getAccountOverview } from "@/server/account/account";

import { ProfileActionForm } from "./_components/ProfileActionForm";
import { PasswordChangeForm } from "./_components/PasswordChangeForm";
import { updateCustomerProfileAction } from "./actions";

export const metadata: Metadata = {
  title: "My account",
  robots: { index: false, follow: false },
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(value);
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  await connection();
  const [account, params] = await Promise.all([
    getAccountOverview(),
    searchParams,
  ]);
  const adminNotice = params.notice === "admin-access-required";

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <p className="font-mono text-eyebrow uppercase text-sage-600">
              Customer account
            </p>
            <h1 className="mt-4 text-h2 text-strong">Hello, {account.name}</h1>
            <p className="mt-3 text-body">{account.email}</p>
          </div>
          <SignOutButton />
        </div>

        {adminNotice ? (
          <p
            className="mt-8 rounded-2xl border border-clay-300/50 bg-clay-50 px-5 py-4 text-sm text-clay-600"
            role="status"
          >
            This account does not have active administration access.
          </p>
        ) : null}

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <p className="text-caption font-semibold uppercase tracking-wider text-muted">
              Account
            </p>
            <p className="mt-3 text-h5 text-strong">Email / password</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Member since {formatDate(account.createdAt)}
            </p>
          </article>
          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <p className="text-caption font-semibold uppercase tracking-wider text-muted">
              Preferences
            </p>
            <p className="mt-3 text-h5 text-strong">
              {account.profile?.preferredCurrency ?? "USD"} · {account.profile?.countryCode ?? "US"}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              United States storefront defaults are active for this account.
            </p>
          </article>
          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
            <p className="text-caption font-semibold uppercase tracking-wider text-muted">
              Saved addresses
            </p>
            <p className="mt-3 text-h5 text-strong">{account.addressCount}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              United States shipping and billing defaults for future checkouts.
            </p>
            <Link
              href="/account/addresses"
              className="mt-4 inline-flex text-sm font-semibold text-sage-700"
            >
              Manage addresses →
            </Link>
          </article>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
            <h2 className="text-h4 text-strong">Orders and shipment tracking</h2>
            <p className="mt-3 leading-relaxed text-body">
              View payment, fulfillment, shipment, and carrier-event status for
              orders associated with this account.
            </p>
            <Link
              href="/account/orders"
              className="mt-5 inline-flex rounded-full border border-ink-900/15 px-6 py-3 text-sm font-semibold text-strong transition hover:bg-surface-alt"
            >
              View my orders
            </Link>
          </article>
          <article className="rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
            <h2 className="text-h4 text-strong">Need help with a requirement?</h2>
            <p className="mt-3 leading-relaxed text-body">
              Product and payment arrangements can be discussed with the team
              before an order is created.
            </p>
            <Link
              href="/contact"
              className="mt-5 inline-flex rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-cream-50 transition hover:bg-sage-600"
            >
              Contact the team
            </Link>
          </article>
        </div>

        <section className="mt-6 rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <h2 className="text-h4 text-strong">Profile and preferences</h2>
          <p className="mt-3 max-w-3xl leading-relaxed text-body">
            Keep the contact name and phone used to prepare future orders up to
            date. The storefront currently supports United States addresses and
            USD only; changing this profile never changes an existing order
            snapshot.
          </p>
          <ProfileActionForm action={updateCustomerProfileAction}>
            <input type="hidden" name="countryCode" value="US" />
            <input type="hidden" name="preferredCurrency" value="USD" />
            <input type="hidden" name="locale" value="en-US" />
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="sm:col-span-2 text-sm font-semibold text-strong">
                Display name
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={255}
                  autoComplete="name"
                  defaultValue={account.name}
                  className="mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 font-normal"
                />
              </label>
              <label className="text-sm font-semibold text-strong">
                First name
                <input
                  name="firstName"
                  maxLength={100}
                  autoComplete="given-name"
                  defaultValue={account.profile?.firstName ?? ""}
                  className="mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 font-normal"
                />
              </label>
              <label className="text-sm font-semibold text-strong">
                Last name
                <input
                  name="lastName"
                  maxLength={100}
                  autoComplete="family-name"
                  defaultValue={account.profile?.lastName ?? ""}
                  className="mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 font-normal"
                />
              </label>
              <label className="sm:col-span-2 text-sm font-semibold text-strong">
                Phone (optional)
                <input
                  name="phone"
                  type="tel"
                  maxLength={32}
                  autoComplete="tel"
                  defaultValue={account.profile?.phone ?? ""}
                  className="mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 font-normal"
                />
              </label>
            </div>
            <label className="flex items-start gap-3 text-sm leading-relaxed text-body">
              <input
                type="checkbox"
                name="marketingConsent"
                defaultChecked={account.profile?.marketingConsent ?? false}
                className="mt-1"
              />
              <span>
                I agree to optional product and catalog marketing messages.
                Order, security, and service messages are separate from this
                preference.
              </span>
            </label>
          </ProfileActionForm>
        </section>

        <section className="mt-6 rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
          <h2 className="text-h4 text-strong">Password and sessions</h2>
          <p className="mt-3 max-w-3xl leading-relaxed text-body">
            Confirm the current password before setting a new one. Other active
            sessions are revoked after a successful change.
          </p>
          <PasswordChangeForm />
        </section>
      </div>
    </section>
  );
}
