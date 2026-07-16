import "server-only";

import { z } from "zod";

import { validatePostgresConnectionUrl } from "@/lib/postgres-connection-url";
import { parseClientIpConfig } from "@/server/auth/client-ip-config";

const postgresUrlSchema = z.string().min(1).superRefine((value, context) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      context.addIssue({
        code: "custom",
        message: "must use the postgres:// or postgresql:// protocol",
      });
    }
  } catch {
    context.addIssue({ code: "custom", message: "must be a valid PostgreSQL URL" });
  }
});

const databaseEnvSchema = z.object({
  DATABASE_URL: postgresUrlSchema,
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DB_POOL_IDLE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .default(10_000),
  DB_POOL_CONNECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(5_000),
  DB_POOL_MAX_LIFETIME_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86_400)
    .default(1_800),
});

type DatabaseRuntimeEnvInput = {
  DATABASE_URL?: string;
  DB_POOL_MAX?: string;
  DB_POOL_IDLE_TIMEOUT_MS?: string;
  DB_POOL_CONNECTION_TIMEOUT_MS?: string;
  DB_POOL_MAX_LIFETIME_SECONDS?: string;
};

const authEnvSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(32),
  SITE_URL: z.string().min(1),
  AUTH_CLIENT_IP_HEADER: z.string().optional(),
  AUTH_TRUSTED_PROXY_CIDRS: z.string().optional(),
});

type AuthRuntimeEnvInput = {
  BETTER_AUTH_SECRET?: string;
  SITE_URL?: string;
  AUTH_CLIENT_IP_HEADER?: string;
  AUTH_TRUSTED_PROXY_CIDRS?: string;
};

const productionSecretPlaceholderPattern =
  /(?:replace(?:[_-]?with)?|change[_-]?me|placeholder|example|your[_-]?(?:random[_-]?)?secret)/iu;

export type DatabaseRuntimeEnv = z.infer<typeof databaseEnvSchema>;

export type AuthRuntimeEnv = {
  secret: string;
  siteOrigin: string;
  ipAddressHeaders: string[];
  trustedProxyCidrs: string[];
};

let databaseEnv: DatabaseRuntimeEnv | undefined;
let authEnv: AuthRuntimeEnv | undefined;

export function parseDatabaseRuntimeEnv(
  input: DatabaseRuntimeEnvInput,
): DatabaseRuntimeEnv {
  const parsed = databaseEnvSchema.parse(input);
  validatePostgresConnectionUrl(parsed.DATABASE_URL, { label: "DATABASE_URL" });

  return parsed;
}

function normalizeSiteOrigin(value: string, nodeEnv: string | undefined) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("SITE_URL must be a valid absolute URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("SITE_URL must use http:// or https://.");
  }

  if (nodeEnv === "production" && url.protocol !== "https:") {
    throw new Error("SITE_URL must use https:// in production.");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error("SITE_URL must contain only the public site origin.");
  }

  if (url.pathname !== "/") {
    throw new Error("SITE_URL must not include a path.");
  }

  return url.origin;
}

function validateProductionAuthSecret(secret: string) {
  if (secret.length < 48) {
    throw new Error(
      "BETTER_AUTH_SECRET must contain at least 48 characters in production.",
    );
  }

  if (!/^[\x21-\x7e]+$/u.test(secret)) {
    throw new Error(
      "BETTER_AUTH_SECRET must contain only printable, non-whitespace ASCII characters in production.",
    );
  }

  if (productionSecretPlaceholderPattern.test(secret)) {
    throw new Error(
      "BETTER_AUTH_SECRET must not contain an example or replacement placeholder in production.",
    );
  }

  if (new Set(secret).size < 12) {
    throw new Error(
      "BETTER_AUTH_SECRET must be a high-entropy random value in production.",
    );
  }
}

export function parseAuthRuntimeEnv(
  input: AuthRuntimeEnvInput,
  nodeEnv: string | undefined,
): AuthRuntimeEnv {
  const parsed = authEnvSchema.parse(input);
  if (nodeEnv === "production") {
    validateProductionAuthSecret(parsed.BETTER_AUTH_SECRET);
  }

  const clientIpConfig = parseClientIpConfig(
    parsed.AUTH_CLIENT_IP_HEADER,
    parsed.AUTH_TRUSTED_PROXY_CIDRS,
  );

  return {
    secret: parsed.BETTER_AUTH_SECRET,
    siteOrigin: normalizeSiteOrigin(parsed.SITE_URL, nodeEnv),
    ipAddressHeaders: clientIpConfig.ipAddressHeaders,
    trustedProxyCidrs: clientIpConfig.trustedProxies,
  };
}

export function getDatabaseRuntimeEnv(): DatabaseRuntimeEnv {
  databaseEnv ??= parseDatabaseRuntimeEnv({
    DATABASE_URL: process.env.DATABASE_URL,
    DB_POOL_MAX: process.env.DB_POOL_MAX,
    DB_POOL_IDLE_TIMEOUT_MS: process.env.DB_POOL_IDLE_TIMEOUT_MS,
    DB_POOL_CONNECTION_TIMEOUT_MS: process.env.DB_POOL_CONNECTION_TIMEOUT_MS,
    DB_POOL_MAX_LIFETIME_SECONDS: process.env.DB_POOL_MAX_LIFETIME_SECONDS,
  });

  return databaseEnv;
}

export function getAuthRuntimeEnv(): AuthRuntimeEnv {
  if (authEnv) {
    return authEnv;
  }

  authEnv = parseAuthRuntimeEnv({
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    SITE_URL: process.env.SITE_URL,
    AUTH_CLIENT_IP_HEADER: process.env.AUTH_CLIENT_IP_HEADER,
    AUTH_TRUSTED_PROXY_CIDRS: process.env.AUTH_TRUSTED_PROXY_CIDRS,
  }, process.env.NODE_ENV);

  return authEnv;
}
