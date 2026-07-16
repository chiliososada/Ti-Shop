import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { getAdminWhatsAppSettings } from "@/server/admin/settings/whatsapp/queries";

import { updateWhatsAppSettingsAction } from "./actions";

export const metadata: Metadata = {
  title: "Storefront settings administration",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal";
const textareaClass = `${inputClass} font-mono text-sm leading-relaxed`;

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default async function AdminSettingsPage() {
  await connection();
  const settings = await getAdminWhatsAppSettings();
  const value = settings.value;

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x max-w-5xl">
        <header>
          <Link href="/admin" className="text-sm font-semibold text-sage-700">
            ← Administration
          </Link>
          <p className="mt-6 font-mono text-eyebrow uppercase text-sage-600">
            Storefront settings
          </p>
          <h1 className="mt-3 text-h2 text-strong">WhatsApp click-to-chat</h1>
          <p className="mt-3 max-w-3xl text-body">
            Configure the public number and server-controlled message templates.
            This creates tracked click-to-chat handoffs only; it does not claim a
            WhatsApp Business API connection or synchronize conversations.
          </p>
          <p className="mt-2 text-caption text-muted">
            Last updated: {formatDate(settings.updatedAt)} UTC
          </p>
        </header>

        {!settings.exists ? (
          <p role="alert" className="mt-8 rounded-xl bg-red-50 p-4 text-sm text-red-800">
            The baseline storefront.whatsapp setting is missing. The public site
            remains fail-closed until the safe database seed is run.
          </p>
        ) : null}
        {settings.invalid ? (
          <p role="alert" className="mt-8 rounded-xl bg-red-50 p-4 text-sm text-red-800">
            The stored WhatsApp setting is invalid. Public WhatsApp links remain
            unavailable until an authorized administrator saves a complete value.
          </p>
        ) : null}

        <div className="mt-8 rounded-2xl border border-ink-900/[0.08] bg-surface p-6 md:p-8">
          {settings.canManage && settings.exists ? (
            <AdminActionForm
              action={updateWhatsAppSettingsAction}
              submitLabel="Save WhatsApp settings"
              className="space-y-8"
            >
              <label className="flex items-start gap-3 text-sm text-body">
                <input
                  type="checkbox"
                  name="configured"
                  defaultChecked={value.configured}
                  className="mt-1"
                />
                <span>
                  Enable public WhatsApp entry points. A valid E.164 number,
                  display value, and every required template placeholder are
                  mandatory before this can be enabled.
                </span>
              </label>

              <div className="grid gap-5 sm:grid-cols-2">
                <label className="text-sm font-semibold text-strong">
                  Destination number (E.164)
                  <input
                    name="phoneE164"
                    defaultValue={value.phoneE164 ?? ""}
                    placeholder="+12025550123"
                    maxLength={16}
                    autoComplete="off"
                    className={inputClass}
                  />
                </label>
                <label className="text-sm font-semibold text-strong">
                  Public display value
                  <input
                    name="displayValue"
                    defaultValue={value.displayValue ?? ""}
                    placeholder="+1 202 555 0123"
                    maxLength={80}
                    className={inputClass}
                  />
                </label>
                <label className="text-sm font-semibold text-strong">
                  Welcome text
                  <textarea
                    name="welcomeMessage"
                    rows={3}
                    maxLength={500}
                    defaultValue={value.welcomeMessage ?? ""}
                    className={inputClass}
                  />
                </label>
                <label className="text-sm font-semibold text-strong">
                  Business hours
                  <textarea
                    name="businessHours"
                    rows={3}
                    maxLength={500}
                    defaultValue={value.businessHours ?? ""}
                    placeholder="Monday–Friday, 9:00–17:00 ET"
                    className={inputClass}
                  />
                </label>
              </div>

              <section>
                <h2 className="text-h4 text-strong">Message templates</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Placeholders are resolved only from validated server data or
                  bounded contact-form fields. Unknown placeholders and missing
                  required fields are rejected.
                </p>
                <div className="mt-5 space-y-6">
                  <TemplateField
                    name="templateGlobal"
                    label="Global entry"
                    hint="No placeholders."
                    value={value.templates.global}
                  />
                  <TemplateField
                    name="templateProduct"
                    label="Product"
                    hint="Required: {{productName}}, {{productSlug}}, {{sku}}, {{casNumber}}, {{productUrl}}"
                    value={value.templates.product}
                  />
                  <TemplateField
                    name="templateCart"
                    label="Cart"
                    hint="Required: {{cartLines}}, {{displayedSubtotal}}"
                    value={value.templates.cart}
                  />
                  <TemplateField
                    name="templateOrder"
                    label="Customer order"
                    hint="Required: {{orderReference}}"
                    value={value.templates.order}
                  />
                  <TemplateField
                    name="templateContact"
                    label="Contact form"
                    hint="Required: {{category}}, {{requirement}}"
                    value={value.templates.contact}
                  />
                </div>
              </section>
            </AdminActionForm>
          ) : (
            <div className="space-y-5">
              <p className="text-sm text-muted">
                You need settings.manage permission to change this configuration.
              </p>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div><dt className="text-caption text-muted">Status</dt><dd className="mt-1 font-semibold text-strong">{value.configured ? "Enabled" : "Disabled"}</dd></div>
                <div><dt className="text-caption text-muted">Display value</dt><dd className="mt-1 text-body">{value.displayValue ?? "Not configured"}</dd></div>
                <div><dt className="text-caption text-muted">Welcome</dt><dd className="mt-1 text-body">{value.welcomeMessage ?? "Not configured"}</dd></div>
                <div><dt className="text-caption text-muted">Business hours</dt><dd className="mt-1 text-body">{value.businessHours ?? "Not configured"}</dd></div>
              </dl>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TemplateField({
  name,
  label,
  hint,
  value,
}: {
  name: string;
  label: string;
  hint: string;
  value: string;
}) {
  return (
    <label className="block text-sm font-semibold text-strong">
      {label}
      <span className="ml-2 font-normal text-muted">{hint}</span>
      <textarea
        name={name}
        rows={5}
        required
        maxLength={2_000}
        defaultValue={value}
        className={textareaClass}
      />
    </label>
  );
}
