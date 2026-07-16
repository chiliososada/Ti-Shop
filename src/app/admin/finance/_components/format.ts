import { formatUsdMinor } from "@/domain/money";

export const financeInputClass =
  "mt-2 w-full rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-sm text-strong outline-none focus:border-sage-600";
export const financeLabelClass = "block text-sm font-semibold text-strong";

/** Formats signed USD cents ("-1234" → "-$12.34"). */
export function signedUsd(minor: string | bigint): string {
  const value = typeof minor === "bigint" ? minor : BigInt(minor);
  return value < BigInt(0)
    ? `-${formatUsdMinor((-value).toString())}`
    : formatUsdMinor(value.toString());
}

/** "6744" bps → "67.44%" (pure string math; no floats). */
export function bpsPercent(bps: number | null): string {
  if (bps === null) return "—";
  const negative = bps < 0;
  const abs = Math.abs(bps).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}%`;
}

export function usdInputValue(minor: string): string {
  const value = BigInt(minor);
  const negative = value < BigInt(0);
  const abs = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

export function formatCnyMinor(minor: string): string {
  const value = BigInt(minor);
  const negative = value < BigInt(0);
  const abs = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}¥${abs.slice(0, -2)}.${abs.slice(-2)}`;
}
