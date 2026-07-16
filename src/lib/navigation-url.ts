import { z } from "zod";

const NAVIGATION_BASE_ORIGIN = "https://navigation.invalid";
const UNSAFE_CHARACTERS = /[\p{Cc}\p{Cf}]/u;
const ENCODED_CONTROL_OR_BACKSLASH = /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/iu;
const RESERVED_INTERNAL_PREFIXES = [
  "/_next",
  "/account",
  "/admin",
  "/api",
  "/checkout",
] as const;

export type SafeNavigationUrl = {
  href: string;
  external: boolean;
};

export type StorefrontNavigationLink = SafeNavigationUrl & {
  id: string;
  label: string;
  openInNewTab: boolean;
};

export function isSafeNavigationLabel(value: string) {
  return (
    value.length > 0 &&
    value.length <= 160 &&
    value === value.trim() &&
    !UNSAFE_CHARACTERS.test(value) &&
    !/[\r\n]/u.test(value)
  );
}

function isReservedInternalPath(pathname: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname).toLowerCase();
  } catch {
    return true;
  }
  if (decoded.startsWith("//")) return true;
  return RESERVED_INTERNAL_PREFIXES.some(
    (prefix) =>
      decoded === prefix ||
      decoded.startsWith(`${prefix}/`) ||
      decoded.startsWith(`${prefix};`),
  );
}

/**
 * Accept only root-relative same-origin paths or absolute HTTPS destinations.
 * This helper is deliberately shared by writes and reads: malformed legacy or
 * directly edited database rows therefore fail closed on the storefront too.
 */
export function parseSafeNavigationUrl(value: string): SafeNavigationUrl | null {
  if (
    value.length === 0 ||
    value.length > 2_048 ||
    value !== value.trim() ||
    UNSAFE_CHARACTERS.test(value) ||
    ENCODED_CONTROL_OR_BACKSLASH.test(value) ||
    value.includes("\\")
  ) {
    return null;
  }

  try {
    const decoded = decodeURI(value);
    if (UNSAFE_CHARACTERS.test(decoded) || decoded.includes("\\")) return null;
  } catch {
    return null;
  }

  if (value.startsWith("/")) {
    if (value.startsWith("//")) return null;

    try {
      const parsed = new URL(value, NAVIGATION_BASE_ORIGIN);
      if (
        parsed.origin !== NAVIGATION_BASE_ORIGIN ||
        parsed.username.length > 0 ||
        parsed.password.length > 0
      ) {
        return null;
      }

      const href = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      return href.startsWith("/") &&
        !href.startsWith("//") &&
        !isReservedInternalPath(parsed.pathname)
        ? { href, external: false }
        : null;
    } catch {
      return null;
    }
  }

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname.length === 0 ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      return null;
    }
    return { href: parsed.toString(), external: true };
  } catch {
    return null;
  }
}

export const safeNavigationUrlSchema = z
  .string()
  .max(2_048, "URL is too long.")
  .transform((value, context) => {
    const parsed = parseSafeNavigationUrl(value);
    if (!parsed) {
      context.addIssue({
        code: "custom",
        message:
          "Use a public same-site path beginning with one slash or a credential-free HTTPS URL; private application routes are not allowed.",
      });
      return z.NEVER;
    }
    return parsed.href;
  });
