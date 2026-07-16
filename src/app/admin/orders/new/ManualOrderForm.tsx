"use client";

import { useState } from "react";

import { AdminActionForm } from "@/app/admin/_components/AdminActionForm";
import { formatUsdMinor } from "@/domain/money";
import { createManualOrderAction } from "@/app/admin/orders/new/actions";

type AddressOption = {
  id: string;
  label: string | null;
  isDefaultShipping: boolean;
  recipientName: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: "US";
  phone?: string;
};

type VariantOption = {
  publicId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  unitPriceMinor: string;
  minimumOrderQuantity: number;
  trackInventory: boolean;
};

type PaymentMethodOption = {
  method: "WIRE_TRANSFER" | "ZELLE";
  label: string;
};

type ItemRow = {
  key: string;
  variantPublicId: string;
  quantity: number;
};

function variantLabel(variant: VariantOption) {
  return `${variant.productTitle} — ${variant.variantTitle}${
    variant.sku ? ` (${variant.sku})` : ""
  } — ${formatUsdMinor(variant.unitPriceMinor)} each`;
}

function addressLabel(address: AddressOption) {
  const prefix = address.label || address.recipientName;
  const defaultLabel = address.isDefaultShipping ? " · default shipping" : "";
  return `${prefix} — ${address.line1}, ${address.city}, ${address.region} ${address.postalCode}${defaultLabel}`;
}

export function ManualOrderForm({
  submissionId,
  customerUserId,
  customerEmail,
  addresses,
  variants,
  paymentMethods,
}: {
  submissionId: string;
  customerUserId: string;
  customerEmail: string;
  addresses: AddressOption[];
  variants: VariantOption[];
  paymentMethods: PaymentMethodOption[];
}) {
  const [addressMode, setAddressMode] = useState<"SAVED" | "CUSTOM">(
    addresses.length ? "SAVED" : "CUSTOM",
  );
  const [rows, setRows] = useState<ItemRow[]>(() => [
    {
      key: crypto.randomUUID(),
      variantPublicId: variants[0]?.publicId ?? "",
      quantity: variants[0]?.minimumOrderQuantity ?? 1,
    },
  ]);
  const variantById = new Map(
    variants.map((variant) => [variant.publicId, variant]),
  );
  const selectedIds = new Set(rows.map((row) => row.variantPublicId));

  function updateVariant(index: number, variantPublicId: string) {
    const variant = variantById.get(variantPublicId);
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              variantPublicId,
              quantity: variant?.minimumOrderQuantity ?? 1,
            }
          : row,
      ),
    );
  }

  function addRow() {
    const nextVariant = variants.find(
      (variant) => !selectedIds.has(variant.publicId),
    );
    if (!nextVariant || rows.length >= 50) return;
    setRows((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        variantPublicId: nextVariant.publicId,
        quantity: nextVariant.minimumOrderQuantity,
      },
    ]);
  }

  return (
    <AdminActionForm
      action={createManualOrderAction}
      submitLabel="Create pending order"
      className="mt-8 space-y-8"
    >
      <input type="hidden" name="idempotencyKey" value={submissionId} />
      <input type="hidden" name="customerUserId" value={customerUserId} />
      <input
        type="hidden"
        name="itemsJson"
        value={JSON.stringify(
          rows.map(({ variantPublicId, quantity }) => ({
            variantPublicId,
            quantity,
          })),
        )}
      />

      <div className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
        <h2 className="text-h4 text-strong">1. Customer and address</h2>
        <p className="mt-2 text-sm text-muted">{customerEmail}</p>
        <label className="mt-5 block text-sm font-semibold text-strong">
          Address source
          <select
            name="addressMode"
            value={addressMode}
            onChange={(event) =>
              setAddressMode(event.target.value as "SAVED" | "CUSTOM")
            }
            className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
          >
            {addresses.length ? (
              <option value="SAVED">Customer saved address</option>
            ) : null}
            <option value="CUSTOM">Enter a one-time US address</option>
          </select>
        </label>

        {addressMode === "SAVED" ? (
          <label className="mt-5 block text-sm font-semibold text-strong">
            Saved address
            <select
              name="addressId"
              required
              defaultValue={addresses[0]?.id}
              className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
            >
              {addresses.map((address) => (
                <option key={address.id} value={address.id}>
                  {addressLabel(address)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-semibold text-strong">
              Recipient name
              <input name="recipientName" required maxLength={255} className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal" />
            </label>
            <label className="text-sm font-semibold text-strong">
              Company (optional)
              <input name="company" maxLength={255} className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal" />
            </label>
            <label className="text-sm font-semibold text-strong md:col-span-2">
              Address line 1
              <input name="line1" required maxLength={255} className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal" />
            </label>
            <label className="text-sm font-semibold text-strong md:col-span-2">
              Address line 2 (optional)
              <input name="line2" maxLength={255} className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal" />
            </label>
            <label className="text-sm font-semibold text-strong">
              City
              <input name="city" required maxLength={120} className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal" />
            </label>
            <label className="text-sm font-semibold text-strong">
              State / district code
              <input name="region" required pattern="[A-Za-z]{2}" maxLength={2} placeholder="CA" className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal uppercase" />
            </label>
            <label className="text-sm font-semibold text-strong">
              ZIP code
              <input name="postalCode" required pattern="[0-9]{5}(-[0-9]{4})?" maxLength={10} className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal" />
            </label>
            <label className="text-sm font-semibold text-strong">
              Country
              <input name="countryCode" value="US" readOnly className="mt-2 w-full rounded-xl border border-ink-900/15 bg-surface-alt px-4 py-3 font-normal" />
            </label>
            <label className="text-sm font-semibold text-strong md:col-span-2">
              Phone (optional)
              <input name="phone" maxLength={32} className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal" />
            </label>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
        <h2 className="text-h4 text-strong">2. Published fixed-price items</h2>
        <div className="mt-5 space-y-4">
          {rows.map((row, index) => {
            const variant = variantById.get(row.variantPublicId);
            return (
              <div key={row.key} className="grid gap-3 rounded-xl border border-line p-4 md:grid-cols-[1fr_9rem_auto] md:items-end">
                <label className="text-sm font-semibold text-strong">
                  Product variant
                  <select
                    value={row.variantPublicId}
                    onChange={(event) => updateVariant(index, event.target.value)}
                    className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                  >
                    {variants.map((option) => (
                      <option
                        key={option.publicId}
                        value={option.publicId}
                        disabled={
                          option.publicId !== row.variantPublicId &&
                          selectedIds.has(option.publicId)
                        }
                      >
                        {variantLabel(option)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-strong">
                  Quantity
                  <input
                    type="number"
                    min={variant?.minimumOrderQuantity ?? 1}
                    max={99}
                    required
                    value={row.quantity}
                    onChange={(event) => {
                      const quantity = Number.parseInt(event.target.value, 10);
                      setRows((current) =>
                        current.map((item, rowIndex) =>
                          rowIndex === index
                            ? { ...item, quantity: Number.isNaN(quantity) ? 0 : quantity }
                            : item,
                        ),
                      );
                    }}
                    className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal"
                  />
                </label>
                <button
                  type="button"
                  disabled={rows.length === 1}
                  onClick={() =>
                    setRows((current) =>
                      current.filter((_, rowIndex) => rowIndex !== index),
                    )
                  }
                  className="rounded-full border border-ink-900/15 px-4 py-3 text-sm font-semibold text-strong disabled:opacity-40"
                >
                  Remove
                </button>
                <p className="text-xs text-muted md:col-span-3">
                  Current server-listed unit price: {variant ? formatUsdMinor(variant.unitPriceMinor) : "—"}; minimum {variant?.minimumOrderQuantity ?? "—"}. Price, MOQ, publication state, and inventory will be checked again when submitted.
                </p>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={addRow}
          disabled={rows.length >= variants.length || rows.length >= 50}
          className="mt-4 rounded-full border border-ink-900/15 px-5 py-2.5 text-sm font-semibold text-strong disabled:opacity-40"
        >
          Add another item
        </button>
      </div>

      <div className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6">
        <h2 className="text-h4 text-strong">3. Pending payment arrangement</h2>
        <label className="mt-5 block text-sm font-semibold text-strong">
          Payment method
          <select name="paymentMethod" required className="mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 font-normal">
            {paymentMethods.map((option) => (
              <option key={option.method} value={option.method}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-5 flex items-start gap-3 rounded-xl border border-amber-700/20 bg-amber-50 p-4 text-sm text-amber-950">
          <input
            type="checkbox"
            name="confirmation"
            value="CREATE_PENDING_MANUAL_ORDER"
            required
            className="mt-1"
          />
          <span>
            I confirm this order follows a WhatsApp customer arrangement and must be created as pending payment. I am not recording or claiming receipt of funds.
          </span>
        </label>
        <p className="mt-4 text-sm text-muted">
          This workflow does not collect or display bank, wire, or Zelle account details. Payment review remains a separate controlled action.
        </p>
      </div>
    </AdminActionForm>
  );
}
