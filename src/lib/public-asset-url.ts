const PUBLIC_ASSET_BASE = "https://public-assets.invalid";
const RAW_UNSAFE_ASSET_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\\]/u;
const RAW_WHITESPACE = /\s/u;
const MAX_DECODE_PASSES = 5;

function hasUnsafeDecodedForm(value: string): boolean {
  let candidate = value;

  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    if (
      RAW_UNSAFE_ASSET_CHARACTERS.test(candidate) ||
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
    RAW_UNSAFE_ASSET_CHARACTERS.test(candidate) ||
    candidate.startsWith("//") ||
    /%[0-9a-f]{2}/iu.test(candidate)
  );
}

export function sanitizePublicAssetUrl(value: string | null): string | null {
  if (
    !value ||
    value !== value.trim() ||
    RAW_WHITESPACE.test(value) ||
    hasUnsafeDecodedForm(value)
  ) {
    return null;
  }

  if (value.startsWith("/")) {
    try {
      const parsed = new URL(value, PUBLIC_ASSET_BASE);
      if (
        parsed.origin !== PUBLIC_ASSET_BASE ||
        parsed.username ||
        parsed.password
      ) {
        return null;
      }
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return null;
    }
  }

  try {
    const parsed = new URL(value);
    const isLoopbackHttp =
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "localhost" ||
        parsed.hostname === "[::1]" ||
        parsed.hostname.endsWith(".localhost"));
    if (
      (parsed.protocol !== "https:" && !isLoopbackHttp) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isRemotePublicAssetUrl(value: string): boolean {
  const sanitized = sanitizePublicAssetUrl(value);
  return (
    sanitized !== null &&
    (sanitized.startsWith("https://") || sanitized.startsWith("http://"))
  );
}
