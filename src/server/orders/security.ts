export function isSameOriginRequest(
  requestUrl: string,
  originHeader: string | null,
  trustedSiteUrl = requestUrl,
) {
  if (!originHeader) return false;

  try {
    return (
      new URL(trustedSiteUrl).origin === new URL(originHeader).origin
    );
  } catch {
    return false;
  }
}

export function isJsonRequest(contentType: string | null) {
  if (!contentType) return false;
  return contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
