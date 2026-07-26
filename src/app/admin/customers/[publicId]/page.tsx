import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { formatUsdMinor } from "@/domain/money";
import { humanizeCommerceStatus } from "@/domain/order";
import { getAdminCustomer } from "@/server/admin/customers/queries";

import {
  disableCustomerAccountAction,
  restoreCustomerAccountAction,
  updateCustomerProfileAction,
} from "../actions";
import { DISPLAY_TIME_ZONE } from "@/lib/display-timezone";

export const metadata: Metadata = {
  title: "Customer account administration",
  robots: { index: false, follow: false },
};

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

function displayMoney(value: string, currency: string) {
  return currency === "USD" ? formatUsdMinor(value) : `${currency} ${value}`;
}

export default async function AdminCustomerPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  await connection();
  const { publicId } = await params;
  const customer = await getAdminCustomer(publicId);
  if (!customer) notFound();

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header>
          <Link
            href="/admin/customers"
            className="text-sm font-semibold text-sage-700"
          >
            ← Customers
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Customer account
          </p>
          <h1 className="mt-3 text-h2 text-strong">{customer.name}</h1>
          <p className="mt-3 text-body">
            {customer.email} · {customer.emailVerified ? "Email verified" : "Email not verified"} · {customer.accountControls.isDisabled ? "Account disabled" : "Account active"}
          </p>
          <p className="mt-2 text-caption text-muted">
            Joined {formatDate(customer.createdAt)} CT · Updated {formatDate(customer.updatedAt)} CT
          </p>
        </header>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
            <h2 className="text-h4 text-strong">Customer profile</h2>
            {customer.canManage ? (
              <AdminActionForm
                action={updateCustomerProfileAction}
                submitLabel="Save customer profile"
                className="mt-6 space-y-5"
              >
                <input type="hidden" name="publicId" value={customer.publicId} />
                <input type="hidden" name="countryCode" value="US" />
                <label className="block text-sm font-semibold text-strong">
                  Account display name
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={255}
                    defaultValue={customer.name}
                    className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                  />
                </label>
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-strong">
                    First name
                    <input
                      name="firstName"
                      maxLength={100}
                      defaultValue={customer.profile.firstName ?? ""}
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                    />
                  </label>
                  <label className="text-sm font-semibold text-strong">
                    Last name
                    <input
                      name="lastName"
                      maxLength={100}
                      defaultValue={customer.profile.lastName ?? ""}
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                    />
                  </label>
                </div>
                <label className="block text-sm font-semibold text-strong">
                  Phone
                  <input
                    name="phone"
                    type="tel"
                    maxLength={32}
                    defaultValue={customer.profile.phone ?? ""}
                    className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                  />
                </label>
                <div className="grid gap-5 sm:grid-cols-3">
                  <div>
                    <p className="text-caption text-muted">Country</p>
                    <p className="mt-1 font-semibold text-strong">United States</p>
                  </div>
                  <div>
                    <p className="text-caption text-muted">Currency</p>
                    <p className="mt-1 font-semibold text-strong">USD</p>
                  </div>
                  <div>
                    <p className="text-caption text-muted">Locale</p>
                    <p className="mt-1 font-semibold text-strong">en-US</p>
                  </div>
                </div>
              </AdminActionForm>
            ) : (
              <dl className="mt-6 grid gap-5 sm:grid-cols-2">
                <div>
                  <dt className="text-caption text-muted">Profile name</dt>
                  <dd className="mt-1 text-body">
                    {[customer.profile.firstName, customer.profile.lastName]
                      .filter(Boolean)
                      .join(" ") || "Not set"}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-muted">Phone</dt>
                  <dd className="mt-1 text-body">{customer.profile.phone ?? "Not set"}</dd>
                </div>
                <div>
                  <dt className="text-caption text-muted">Country</dt>
                  <dd className="mt-1 text-body">United States</dd>
                </div>
                <div>
                  <dt className="text-caption text-muted">Locale / currency</dt>
                  <dd className="mt-1 text-body">
                    {customer.profile.locale} · {customer.profile.preferredCurrency}
                  </dd>
                </div>
              </dl>
            )}
          </section>

          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
            <h2 className="text-h4 text-strong">Account controls</h2>
            <dl className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
              <div>
                <dt className="text-caption text-muted">Marketing consent</dt>
                <dd className="mt-1 text-body">
                  {customer.profile.marketingConsent ? "Recorded" : "Not recorded"}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-muted">Saved addresses</dt>
                <dd className="mt-1 text-body">{customer.counts.addresses}</dd>
              </div>
              <div>
                <dt className="text-caption text-muted">Orders</dt>
                <dd className="mt-1 text-body">{customer.counts.orders}</dd>
              </div>
              <div>
                <dt className="text-caption text-muted">Sign-in status</dt>
                <dd className="mt-1 text-body">
                  {customer.accountControls.isDisabled ? "Disabled" : "Active"}
                </dd>
              </div>
            </dl>
            {customer.accountControls.isDisabled ? (
              <div className="mt-6 rounded-xl border border-red-700/20 bg-red-50 p-4 text-sm leading-relaxed text-red-900">
                <p className="font-semibold">Sign-in is blocked</p>
                <p className="mt-2">
                  Disabled {formatDate(customer.accountControls.disabledAt)} UTC
                  {customer.accountControls.disabledBy
                    ? ` by ${customer.accountControls.disabledBy.name} (${customer.accountControls.disabledBy.email})`
                    : " by an administrator whose account is no longer available"}
                  .
                </p>
                <p className="mt-2 whitespace-pre-wrap">
                  Reason: {customer.accountControls.disabledReason ?? "Not recorded"}
                </p>
              </div>
            ) : (
              <p className="mt-6 rounded-xl bg-surface-alt p-4 text-sm leading-relaxed text-body">
                Disabling this account permanently records the reason and revokes
                every current session. Orders, addresses, and audit history remain.
              </p>
            )}

            {customer.accountControls.canManage ? (
              customer.accountControls.isDisabled ? (
                <AdminActionForm
                  action={restoreCustomerAccountAction}
                  submitLabel="Restore customer sign-in"
                  className="mt-6 space-y-4 border-t border-line pt-6"
                >
                  <input type="hidden" name="publicId" value={customer.publicId} />
                  <label className="block text-sm font-semibold text-strong">
                    Type the customer email to confirm
                    <input
                      name="confirmationEmail"
                      type="email"
                      required
                      autoComplete="off"
                      placeholder={customer.email}
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                    />
                  </label>
                  <label className="flex items-start gap-3 text-sm leading-relaxed text-body">
                    <input
                      name="confirmation"
                      type="checkbox"
                      required
                      value="RESTORE_CUSTOMER_ACCOUNT"
                      className="mt-1"
                    />
                    <span>
                      I confirm this customer may sign in again. No old session will
                      be restored.
                    </span>
                  </label>
                </AdminActionForm>
              ) : (
                <AdminActionForm
                  action={disableCustomerAccountAction}
                  submitLabel="Disable account and revoke sessions"
                  className="mt-6 space-y-4 border-t border-line pt-6"
                >
                  <input type="hidden" name="publicId" value={customer.publicId} />
                  <label className="block text-sm font-semibold text-strong">
                    Required reason
                    <textarea
                      name="reason"
                      required
                      minLength={10}
                      maxLength={500}
                      rows={4}
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                    />
                  </label>
                  <label className="block text-sm font-semibold text-strong">
                    Type the customer email to confirm
                    <input
                      name="confirmationEmail"
                      type="email"
                      required
                      autoComplete="off"
                      placeholder={customer.email}
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                    />
                  </label>
                  <label className="flex items-start gap-3 text-sm leading-relaxed text-body">
                    <input
                      name="confirmation"
                      type="checkbox"
                      required
                      value="DISABLE_CUSTOMER_ACCOUNT"
                      className="mt-1"
                    />
                    <span>
                      I confirm all current sessions will be revoked and new sign-in
                      attempts will be blocked until an explicit restore.
                    </span>
                  </label>
                </AdminActionForm>
              )
            ) : (
              <p className="mt-6 text-sm text-muted">
                Customer account access changes require users.manage together with
                customer and order read access.
              </p>
            )}
          </section>
        </div>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <h2 className="text-h4 text-strong">
            Saved addresses ({customer.addresses.length})
          </h2>
          {customer.addresses.length ? (
            <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {customer.addresses.map((address, index) => (
                <article
                  key={`${address.createdAt}:${index}`}
                  className="rounded-xl bg-surface-alt p-5 text-sm leading-relaxed text-body"
                >
                  <div className="flex flex-wrap gap-2 text-caption font-semibold text-sage-700">
                    {address.isDefaultShipping ? <span>Default shipping</span> : null}
                    {address.isDefaultBilling ? <span>Default billing</span> : null}
                  </div>
                  <p className="mt-3 font-semibold text-strong">
                    {address.label || address.recipientName}
                  </p>
                  <address className="mt-2 not-italic">
                    {address.recipientName}
                    {address.company ? <><br />{address.company}</> : null}
                    <br />
                    {address.line1}
                    {address.line2 ? <><br />{address.line2}</> : null}
                    <br />
                    {address.city}, {address.region} {address.postalCode}
                    <br />
                    {address.countryCode}
                    {address.phone ? <><br />{address.phone}</> : null}
                  </address>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-5 text-body">No active saved addresses.</p>
          )}
        </section>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-h4 text-strong">Recent orders</h2>
            <p className="text-caption text-muted">Newest 50</p>
          </div>
          {customer.orders.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="py-3 pr-4">Order</th>
                    <th className="py-3 pr-4">Order status</th>
                    <th className="py-3 pr-4">Payment</th>
                    <th className="py-3 pr-4">Fulfillment</th>
                    <th className="py-3 pr-4">Items</th>
                    <th className="py-3">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {customer.orders.map((order) => (
                    <tr key={order.publicId}>
                      <td className="py-4 pr-4">
                        <p className="font-mono font-semibold text-sage-700">
                          {order.orderNumber}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {formatDate(order.createdAt)} UTC
                        </p>
                      </td>
                      <td className="py-4 pr-4">
                        {humanizeCommerceStatus(order.status)}
                      </td>
                      <td className="py-4 pr-4">
                        {humanizeCommerceStatus(order.paymentStatus)}
                      </td>
                      <td className="py-4 pr-4">
                        {humanizeCommerceStatus(order.fulfillmentStatus)}
                      </td>
                      <td className="py-4 pr-4">
                        {order.itemCount} item{order.itemCount === 1 ? "" : "s"} · {" "}
                        {order.shipmentCount} shipment
                        {order.shipmentCount === 1 ? "" : "s"}
                      </td>
                      <td className="py-4 font-semibold text-strong">
                        {displayMoney(order.totalMinor, order.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-5 text-body">No orders placed.</p>
          )}
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-h4 text-strong">WhatsApp intents</h2>
              <p className="text-caption text-muted">
                {customer.counts.whatsappIntents} total · newest 50
              </p>
            </div>
            <p className="mt-3 text-sm text-muted">
              Only coarse source and linkage metadata is shown. Prefilled message
              text and captured context are intentionally excluded.
            </p>
            {customer.whatsappIntents.length ? (
              <ul className="mt-5 divide-y divide-line">
                {customer.whatsappIntents.map((intent) => (
                  <li key={intent.publicId} className="py-4 text-sm text-body">
                    <div className="flex flex-wrap justify-between gap-2">
                      <p className="font-semibold text-strong">{intent.sourceArea}</p>
                      <p className="text-xs text-muted">
                        {formatDate(intent.createdAt)} UTC
                      </p>
                    </div>
                    <p className="mt-2 text-muted">
                      {intent.wasOpened
                        ? "WhatsApp handoff prepared"
                        : "Intent recorded"}
                      {intent.hasMessageTemplate
                        ? " · Controlled template recorded"
                        : ""}
                    </p>
                    <p className="mt-2 text-xs text-muted">
                      {intent.order ? `Order ${intent.order.orderNumber}` : ""}
                      {intent.product ? `${intent.order ? " · " : ""}Product ${intent.product.title}` : ""}
                      {intent.inquiry ? `${intent.order || intent.product ? " · " : ""}Inquiry ${intent.inquiry.inquiryNumber}` : ""}
                      {!intent.order && !intent.product && !intent.inquiry
                        ? "No linked business record"
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 text-body">No WhatsApp intents recorded.</p>
            )}
          </section>

          <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-h4 text-strong">Inquiry summaries</h2>
              <p className="text-caption text-muted">
                {customer.counts.inquiries} total · newest 50
              </p>
            </div>
            <p className="mt-3 text-sm text-muted">
              Customer-entered subject, message, phone, and email values are not
              repeated in this summary.
            </p>
            {customer.inquiries.length ? (
              <ul className="mt-5 divide-y divide-line">
                {customer.inquiries.map((inquiry) => (
                  <li key={inquiry.publicId} className="py-4 text-sm text-body">
                    <div className="flex flex-wrap justify-between gap-2">
                      <p className="font-mono font-semibold text-sage-700">
                        {inquiry.inquiryNumber}
                      </p>
                      <p className="text-xs text-muted">
                        {formatDate(inquiry.createdAt)} UTC
                      </p>
                    </div>
                    <p className="mt-2">
                      {humanizeCommerceStatus(inquiry.status)} · {" "}
                      {humanizeCommerceStatus(inquiry.source)}
                    </p>
                    <p className="mt-2 text-xs text-muted">
                      {inquiry.order ? `Order ${inquiry.order.orderNumber}` : ""}
                      {inquiry.product ? `${inquiry.order ? " · " : ""}Product ${inquiry.product.title}` : ""}
                      {!inquiry.order && !inquiry.product
                        ? "No linked order or product"
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 text-body">No inquiries recorded.</p>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
