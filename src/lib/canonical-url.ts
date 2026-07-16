const CANONICAL_BASE = "https://canonical.invalid";
const UNSAFE_CANONICAL_CHARACTERS = /[\p{Cc}\p{Cf}\s\\]/u;
const MAX_DECODE_PASSES = 5;
const PROTECTED_CANONICAL_PREFIXES = [
  "/_next",
  "/account",
  "/admin",
  "/api",
  "/checkout",
  "/static",
] as const;

function hasUnsafeDecodedForm(value: string) {
  let candidate = value;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    if (
      UNSAFE_CANONICAL_CHARACTERS.test(candidate) ||
      candidate.includes("?") ||
      candidate.includes("#") ||
      candidate.startsWith("//")
    ) {
      return true;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      return true;
    }
    if (decoded === candidate) return false;
    candidate = decoded;
  }
  return (
    UNSAFE_CANONICAL_CHARACTERS.test(candidate) ||
    candidate.includes("?") ||
    candidate.includes("#") ||
    candidate.startsWith("//") ||
    /%[0-9a-f]{2}/iu.test(candidate)
  );
}

function isProtectedCanonicalPath(pathname: string) {
  let decoded = pathname;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return true;
    }
    if (next === decoded) break;
    decoded = next;
  }

  const lower = decoded.toLowerCase();
  return PROTECTED_CANONICAL_PREFIXES.some(
    (prefix) => lower === prefix || lower.startsWith(`${prefix}/`),
  );
}

/**
 * Canonicals are either normalized public root-relative paths or absolute
 * credential-free HTTPS URLs. Query strings and fragments are intentionally
 * rejected so tracking or application state cannot become the indexed URL.
 */
export function normalizeCanonicalUrl(value: string): string | null {
  if (
    value.length === 0 ||
    value.length > 2_048 ||
    value !== value.trim() ||
    value.includes("?") ||
    value.includes("#") ||
    hasUnsafeDecodedForm(value)
  ) {
    return null;
  }

  if (value.startsWith("/")) {
    if (value.startsWith("//")) return null;
    try {
      const parsed = new URL(value, CANONICAL_BASE);
      if (
        parsed.origin !== CANONICAL_BASE ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        parsed.pathname !== value ||
        isProtectedCanonicalPath(parsed.pathname)
      ) {
        return null;
      }
      return parsed.pathname;
    } catch {
      return null;
    }
  }

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
