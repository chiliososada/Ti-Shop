const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/u;
const PROTECTED_SOURCE_PREFIXES = [
  "/_next",
  "/admin",
  "/api",
  "/account",
  "/checkout",
  "/static",
] as const;

export type RedirectGraphEntry = {
  publicId: string;
  sourcePath: string;
  destinationPath: string;
};

export function isSafeRootRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 2_048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#") ||
    CONTROL_OR_BACKSLASH.test(value)
  ) {
    return false;
  }

  try {
    const decoded = decodeURIComponent(value);
    if (CONTROL_OR_BACKSLASH.test(decoded)) return false;
    const url = new URL(value, "https://redirect-policy.invalid");
    return url.origin === "https://redirect-policy.invalid" && url.pathname === value;
  } catch {
    return false;
  }
}

export function isRedirectablePublicPath(pathname: string): boolean {
  if (!isSafeRootRelativePath(pathname)) return false;
  if (pathname === "/") return true;
  if (/\/[^/]*\.[^/]+$/u.test(pathname)) return false;
  return !PROTECTED_SOURCE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function createsRedirectCycle(
  sourcePath: string,
  destinationPath: string,
  entries: readonly RedirectGraphEntry[],
  ignoredPublicId?: string,
): boolean {
  const destinations = new Map<string, string>();
  for (const entry of entries) {
    if (entry.publicId !== ignoredPublicId) {
      destinations.set(entry.sourcePath, entry.destinationPath);
    }
  }
  destinations.set(sourcePath, destinationPath);

  const seen = new Set<string>();
  let current: string | undefined = sourcePath;
  while (current !== undefined) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = destinations.get(current);
  }
  return false;
}

export function buildRedirectDestination(
  requestUrl: string,
  destinationPath: string,
  preserveQuery: boolean,
  trustedSiteOrigin: string,
): URL {
  if (!isSafeRootRelativePath(destinationPath)) {
    throw new Error("Unsafe redirect destination.");
  }
  const request = new URL(requestUrl);
  const trustedOrigin = new URL(trustedSiteOrigin);
  if (
    (trustedOrigin.protocol !== "http:" && trustedOrigin.protocol !== "https:") ||
    trustedOrigin.username ||
    trustedOrigin.password ||
    trustedOrigin.pathname !== "/" ||
    trustedOrigin.search ||
    trustedOrigin.hash
  ) {
    throw new Error("Unsafe trusted redirect origin.");
  }
  const destination = new URL(destinationPath, trustedOrigin.origin);
  destination.search = preserveQuery ? request.search : "";
  return destination;
}
