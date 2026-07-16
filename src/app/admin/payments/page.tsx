import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { PAYMENT_METHOD_LABELS } from "@/domain/order";
import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { getAdminPaymentSettings } from "@/server/admin/payments/queries";

import {
  updateCheckoutChargesAction,
  updateOnlinePaymentSwitchAction,
  updatePaymentMethodConfigAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Payment settings administration",
  robots: { index: false, follow: false },
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default async function AdminPaymentSettingsPage() {
  await connection();
  const settings = await getAdminPaymentSettings();
  const charges = settings.checkoutCharges;

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x space-y-10">
        <header>
          <Link href="/admin/orders" className="text-sm font-semibold text-sage-700">
            ← Orders and payments
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Payment controls
          </p>
          <h1 className="mt-3 text-h2 text-strong">Payment settings</h1>
          <p className="mt-3 max-w-3xl text-body">
            Manage customer-facing method names and instructions. Provider API
            keys and recipient credentials are never stored or shown here.
          </p>
        </header>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <h2 className="text-h4 text-strong">Online payment kill switch</h2>
          {settings.onlinePaymentSwitch ? (
            <>
              <p className="mt-3 text-body">
                Current state: {settings.onlinePaymentSwitch.isEnabled ? "enabled" : "disabled"} · Updated {formatDate(settings.onlinePaymentSwitch.updatedAt)} UTC
              </p>
              {settings.canManageOnlinePaymentSwitch ? (
                <AdminActionForm
                  action={updateOnlinePaymentSwitchAction}
                  submitLabel="Save online payment switch"
                  className="mt-6 space-y-5"
                >
                  <label className="flex items-start gap-3 text-sm text-body">
                    <input
                      type="checkbox"
                      name="isEnabled"
                      defaultChecked={settings.onlinePaymentSwitch.isEnabled}
                      className="mt-1"
                    />
                    <span>
                      Permit direct online payment initiation. NOWPayments must
                      also be enabled below and configured in the runtime environment.
                    </span>
                  </label>
                </AdminActionForm>
              ) : (
                <p className="mt-4 text-sm text-muted">
                  You need the settings.manage permission to change this switch.
                </p>
              )}
            </>
          ) : (
            <p className="mt-4 text-body">
              The baseline online-payment setting is missing. Run the safe database seed before enabling payments.
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          <h2 className="text-h4 text-strong">Checkout shipping and tax</h2>
          <p className="mt-3 max-w-3xl text-body">
            Values are explicit: shipping uses integer USD cents and tax uses basis
            points. When disabled, checkout must not infer a fee or tax rate. The
            configured tax rate is applied uniformly to every supported US shipping
            address; it is not a state or local tax engine. Confirm the correct
            treatment with a qualified tax adviser before enabling a nonzero rate.
          </p>
          {settings.checkoutChargesInvalid ? (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">
              Stored checkout charges are invalid and must remain fail-closed until an authorized administrator saves a complete configuration.
            </p>
          ) : null}
          {charges || settings.checkoutChargesInvalid ? (
            settings.canManageOnlinePaymentSwitch ? (
              <AdminActionForm
                action={updateCheckoutChargesAction}
                submitLabel="Save checkout charges"
                className="mt-6 space-y-5"
              >
                <label className="flex items-start gap-3 text-sm text-body">
                  <input
                    type="checkbox"
                    name="configured"
                    defaultChecked={charges?.configured ?? false}
                    className="mt-1"
                  />
                  <span>
                    Checkout charges are fully configured. Both fields below are
                    required when selected; explicit zero values are allowed.
                  </span>
                </label>
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-strong">
                    Flat shipping (USD cents)
                    <input
                      name="shippingFlatMinor"
                      inputMode="numeric"
                      defaultValue={charges?.shippingFlatMinor ?? ""}
                      placeholder="0"
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                    />
                  </label>
                  <label className="text-sm font-semibold text-strong">
                    Tax rate (basis points)
                    <input
                      name="taxRateBps"
                      inputMode="numeric"
                      defaultValue={charges?.taxRateBps ?? ""}
                      placeholder="0"
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                    />
                  </label>
                </div>
              </AdminActionForm>
            ) : (
              <p className="mt-4 text-sm text-muted">
                You need the settings.manage permission to change checkout charges.
              </p>
            )
          ) : (
            <p className="mt-4 text-body">
              The baseline checkout-charge setting is missing. Run the safe database seed before configuring charges.
            </p>
          )}
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          {settings.methods.map((method) => (
            <section
              key={method.method}
              className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-caption text-sage-700">
                    {method.method}
                  </p>
                  <h2 className="mt-2 text-h4 text-strong">
                    {PAYMENT_METHOD_LABELS[method.method]}
                  </h2>
                </div>
                <span className="rounded-full bg-surface-alt px-3 py-1 text-caption font-semibold text-strong">
                  {method.isEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <p className="mt-3 text-caption text-muted">
                Updated {formatDate(method.updatedAt)} UTC
              </p>
              {method.publicInstructionsRejected ? (
                <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">
                  Stored public instructions looked like recipient, bank, or
                  credential material and were withheld. Replace them with
                  non-sensitive procedural copy before enabling this method.
                </p>
              ) : null}

              {method.method === "NOWPAYMENTS" ? (
                <div
                  className={`mt-4 rounded-xl border p-4 text-sm ${
                    settings.nowPaymentsRuntime.valid &&
                    settings.nowPaymentsRuntime.mode !== "disabled"
                      ? "border-sage-700/20 bg-sage-50 text-sage-900"
                      : "border-amber-700/20 bg-amber-50 text-amber-950"
                  }`}
                >
                  <p className="font-semibold">Runtime provider state</p>
                  <p className="mt-1">
                    {settings.nowPaymentsRuntime.valid
                      ? `Mode: ${settings.nowPaymentsRuntime.mode}.`
                      : "The NOWPayments runtime configuration is invalid."}
                    {settings.nowPaymentsRuntime.valid &&
                    settings.nowPaymentsRuntime.mode !== "disabled"
                      ? " Checkout still requires this method and the global switch to be enabled."
                      : " Customers cannot select NOWPayments even if database switches are enabled."}
                  </p>
                </div>
              ) : null}

              {settings.canManagePaymentMethods ? (
                <AdminActionForm
                  action={updatePaymentMethodConfigAction}
                  submitLabel="Save payment method"
                  className="mt-6 space-y-5"
                >
                  <input type="hidden" name="method" value={method.method} />
                  <label className="block text-sm font-semibold text-strong">
                    Customer-facing name
                    <input
                      name="displayName"
                      required
                      maxLength={160}
                      defaultValue={method.displayName}
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                    />
                  </label>
                  <label className="block text-sm font-semibold text-strong">
                    Public instructions
                    <textarea
                      name="publicInstructions"
                      rows={6}
                      maxLength={20_000}
                      defaultValue={method.publicInstructions ?? ""}
                      className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal leading-relaxed"
                    />
                    <span className="mt-2 block text-xs font-normal leading-relaxed text-muted">
                      Public procedural copy only. Do not enter API secrets,
                      bank/routing/account numbers, Zelle recipient email or
                      phone, or any other settlement credential; this field is
                      intentionally not a secret vault.
                    </span>
                  </label>
                  <label className="flex items-start gap-3 text-sm text-body">
                    <input
                      type="checkbox"
                      name="isEnabled"
                      defaultChecked={method.isEnabled}
                      className="mt-1"
                    />
                    <span>Offer this method to customers at checkout.</span>
                  </label>
                </AdminActionForm>
              ) : (
                <div className="mt-5 rounded-xl bg-surface-alt p-4 text-sm leading-relaxed text-body">
                  <p className="font-semibold text-strong">{method.displayName}</p>
                  <p className="mt-2 whitespace-pre-wrap">
                    {method.publicInstructions || "No public instructions."}
                  </p>
                  <p className="mt-3 text-muted">
                    You need the payments.manage permission to make changes.
                  </p>
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
