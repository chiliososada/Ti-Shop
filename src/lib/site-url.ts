import { company } from "@/data/company";

export function resolvePublicSiteOrigin(
  candidate: string | undefined = process.env.SITE_URL,
  fallback: string = company.url,
) {
  for (const value of [candidate, fallback]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === "/"
      ) {
        return url.origin;
      }
    } catch {
      // Continue to the trusted repository fallback.
    }
  }
  throw new Error("A valid public site origin is required.");
}
