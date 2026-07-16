export function buildMerchantTrackingUrl(
  template: string | null,
  trackingNumber: string | null,
) {
  if (!template || !trackingNumber || !template.includes("{trackingNumber}")) {
    return null;
  }

  try {
    const value = template.replaceAll(
      "{trackingNumber}",
      encodeURIComponent(trackingNumber),
    );
    if (value.length > 4_096) return null;
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
