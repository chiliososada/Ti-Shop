const FALLBACK_CALLBACK = "/account";

/**
 * Accepts only a local path. Protocol-relative and auth endpoint callbacks are
 * rejected so a successful sign-in cannot become an open redirect.
 */
export function safeCallbackPath(
  value: string | string[] | undefined,
  fallback = FALLBACK_CALLBACK,
) {
  const candidate = Array.isArray(value) ? value[0] : value;

  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  let url: URL;
  try {
    url = new URL(candidate, "https://local.invalid");
  } catch {
    return fallback;
  }

  if (url.origin !== "https://local.invalid") {
    return fallback;
  }

  if (
    url.pathname === "/login" ||
    url.pathname === "/register" ||
    url.pathname.startsWith("/api/auth")
  ) {
    return fallback;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
