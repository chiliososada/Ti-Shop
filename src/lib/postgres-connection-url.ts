type PostgresConnectionUrlOptions = {
  label: "DATABASE_URL" | "DIRECT_URL";
  requiredSchema?: string;
};

const securityParameterNames = new Set([
  "host",
  "hostaddr",
  "sslmode",
  "ssl",
  "uselibpqcompat",
  "schema",
]);

function isPrivateDatabaseHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    !normalized.includes(".")
  ) {
    return true;
  }

  if (
    normalized === "::1" ||
    (normalized.includes(":") &&
      (normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe8") ||
        normalized.startsWith("fe9") ||
        normalized.startsWith("fea") ||
        normalized.startsWith("feb")))
  ) {
    return true;
  }

  const octets = normalized.split(".").map((part) => Number(part));
  if (
    octets.length === 4 &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
  ) {
    const [first = -1, second = -1] = octets;
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  return false;
}

/**
 * Validates the exact URI subset supported by this deployment before either
 * node-postgres or Prisma sees a credential. This intentionally rejects URI
 * forms whose effective pg configuration differs from WHATWG URL semantics.
 */
export function validatePostgresConnectionUrl(
  connectionString: string,
  options: PostgresConnectionUrlOptions,
) {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`${options.label} must be a valid PostgreSQL URL.`);
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      `${options.label} must use the postgres:// or postgresql:// protocol.`,
    );
  }

  const parameters = new Map<string, string[]>();
  for (const [rawKey, value] of url.searchParams) {
    const key = rawKey.toLowerCase();
    if (securityParameterNames.has(key) && rawKey !== key) {
      throw new Error(
        `${options.label} security query parameter names must be lowercase.`,
      );
    }
    parameters.set(key, [...(parameters.get(key) ?? []), value]);
  }

  for (const forbiddenHostOverride of ["host", "hostaddr"]) {
    if (parameters.has(forbiddenHostOverride)) {
      throw new Error(
        `${options.label} must not override its authority host through query parameters.`,
      );
    }
  }

  for (const securityParameter of ["sslmode", "ssl", "uselibpqcompat"]) {
    if ((parameters.get(securityParameter)?.length ?? 0) > 1) {
      throw new Error(
        `${options.label} must not repeat the ${securityParameter} security parameter.`,
      );
    }
  }

  if (options.requiredSchema) {
    const schemas = parameters.get("schema") ?? [];
    if (schemas.length !== 1 || schemas[0] !== options.requiredSchema) {
      throw new Error(
        `${options.label} must include exactly one schema=${options.requiredSchema} parameter.`,
      );
    }
  }

  if (!isPrivateDatabaseHostname(url.hostname)) {
    const sslModes = parameters.get("sslmode") ?? [];
    if (
      sslModes.length !== 1 ||
      sslModes[0] !== "verify-full" ||
      parameters.has("ssl") ||
      parameters.has("uselibpqcompat")
    ) {
      throw new Error(
        `${options.label} must use one sslmode=verify-full parameter for a non-private host.`,
      );
    }
  }

  return connectionString;
}
