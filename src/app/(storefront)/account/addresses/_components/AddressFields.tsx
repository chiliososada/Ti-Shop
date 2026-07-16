import type { CustomerAddressDto } from "@/server/account/addresses";

const inputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-base px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
const labelClass = "block text-sm font-semibold text-strong";

export function AddressFields({
  address,
}: {
  address?: CustomerAddressDto;
}) {
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className={labelClass}>
          Label (optional)
          <input
            className={inputClass}
            name="label"
            defaultValue={address?.label ?? ""}
            maxLength={80}
            placeholder="Home or Office"
          />
        </label>
        <label className={labelClass}>
          Recipient name
          <input
            className={inputClass}
            name="recipientName"
            defaultValue={address?.recipientName ?? ""}
            autoComplete="name"
            required
            maxLength={255}
          />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Company (optional)
          <input
            className={inputClass}
            name="company"
            defaultValue={address?.company ?? ""}
            autoComplete="organization"
            maxLength={255}
          />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Street address
          <input
            className={inputClass}
            name="line1"
            defaultValue={address?.line1 ?? ""}
            autoComplete="address-line1"
            required
            maxLength={255}
          />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Unit, suite, or building (optional)
          <input
            className={inputClass}
            name="line2"
            defaultValue={address?.line2 ?? ""}
            autoComplete="address-line2"
            maxLength={255}
          />
        </label>
        <label className={labelClass}>
          City
          <input
            className={inputClass}
            name="city"
            defaultValue={address?.city ?? ""}
            autoComplete="address-level2"
            required
            maxLength={120}
          />
        </label>
        <label className={labelClass}>
          State / district code
          <input
            className={`${inputClass} uppercase`}
            name="region"
            defaultValue={address?.region ?? ""}
            autoComplete="address-level1"
            required
            minLength={2}
            maxLength={2}
            pattern="[A-Za-z]{2}"
            placeholder="CA"
          />
        </label>
        <label className={labelClass}>
          ZIP code
          <input
            className={inputClass}
            name="postalCode"
            defaultValue={address?.postalCode ?? ""}
            autoComplete="postal-code"
            inputMode="numeric"
            required
            maxLength={10}
            pattern="[0-9]{5}(-[0-9]{4})?"
            placeholder="94105"
          />
        </label>
        <label className={labelClass}>
          Country
          <input
            className={`${inputClass} bg-surface-alt text-muted`}
            value="United States"
            readOnly
            aria-label="Country: United States"
          />
          <input type="hidden" name="countryCode" value="US" />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Phone (optional)
          <input
            className={inputClass}
            name="phone"
            defaultValue={address?.phone ?? ""}
            autoComplete="tel"
            inputMode="tel"
            maxLength={32}
            placeholder="+1 415 555 0100"
          />
        </label>
      </div>

      <fieldset className="space-y-3 rounded-xl border border-ink-900/[0.08] bg-surface-alt p-4">
        <legend className="px-1 text-sm font-semibold text-strong">
          Default use
        </legend>
        <label className="flex items-start gap-3 text-sm text-body">
          <input
            type="checkbox"
            name="isDefaultShipping"
            defaultChecked={address?.isDefaultShipping ?? false}
            className="mt-1"
          />
          Use as my default shipping address
        </label>
        <label className="flex items-start gap-3 text-sm text-body">
          <input
            type="checkbox"
            name="isDefaultBilling"
            defaultChecked={address?.isDefaultBilling ?? false}
            className="mt-1"
          />
          Use as my default billing address
        </label>
        <p className="text-xs leading-relaxed text-muted">
          Selecting a default replaces the previous default of that type. Your
          first saved address becomes both defaults automatically.
        </p>
      </fieldset>
    </>
  );
}
