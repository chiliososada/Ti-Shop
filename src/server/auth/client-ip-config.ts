import { isIP } from "node:net";

const headerNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function parseTrustedProxy(value: string) {
  const [address, prefix, ...extra] = value.split("/");
  const ipVersion = isIP(address ?? "");

  if (!ipVersion || extra.length > 0) {
    throw new Error(`Invalid trusted proxy address or CIDR: ${value}`);
  }

  if (prefix === undefined) {
    return address as string;
  }

  if (!/^\d+$/.test(prefix)) {
    throw new Error(`Invalid trusted proxy address or CIDR: ${value}`);
  }

  const prefixNumber = Number(prefix);
  const maxPrefix = ipVersion === 4 ? 32 : 128;
  if (prefixNumber < 0 || prefixNumber > maxPrefix) {
    throw new Error(`Invalid trusted proxy address or CIDR: ${value}`);
  }

  return `${address}/${prefixNumber}`;
}

export function parseClientIpConfig(
  headerValue: string | undefined,
  trustedProxyValue: string | undefined,
) {
  const header = headerValue?.trim().toLowerCase();
  const trustedProxies = (trustedProxyValue ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseTrustedProxy);

  if (!header) {
    if (trustedProxies.length > 0) {
      throw new Error(
        "AUTH_CLIENT_IP_HEADER is required when AUTH_TRUSTED_PROXY_CIDRS is set.",
      );
    }

    return { ipAddressHeaders: [] as string[], trustedProxies };
  }

  if (!headerNamePattern.test(header)) {
    throw new Error("AUTH_CLIENT_IP_HEADER must be a valid HTTP header name.");
  }

  if (trustedProxies.length === 0) {
    throw new Error(
      "AUTH_TRUSTED_PROXY_CIDRS must contain the exact proxy address or CIDR when client IP headers are enabled.",
    );
  }

  return { ipAddressHeaders: [header], trustedProxies };
}
