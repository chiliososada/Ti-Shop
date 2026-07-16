import { z } from "zod";

export type NowPaymentsMode = "disabled" | "mock" | "sandbox" | "production";

export type NowPaymentsRuntimeConfig = {
  mode: NowPaymentsMode;
  apiBaseUrl: string | null;
  apiKey: string | null;
  ipnSecret: string | null;
  timeoutMs: number;
};

const rawSchema = z.object({
  NOWPAYMENTS_MODE: z
    .enum(["disabled", "mock", "sandbox", "production"])
    .default("disabled"),
  NOWPAYMENTS_API_BASE_URL: z.string().optional(),
  NOWPAYMENTS_API_KEY: z.string().optional(),
  NOWPAYMENTS_IPN_SECRET: z.string().optional(),
  NOWPAYMENTS_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(30_000)
    .default(10_000),
});

function normalizeApiBaseUrl(value: string, mode: NowPaymentsMode) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.replace(/\/$/u, "") !== "/v1"
  ) {
    throw new Error("NOWPayments API base URL must be an HTTPS /v1 endpoint.");
  }

  const allowed =
    mode === "production"
      ? url.hostname === "api.nowpayments.io"
      : url.hostname.endsWith(".nowpayments.io") &&
        url.hostname !== "api.nowpayments.io";
  if (!allowed) {
    throw new Error("NOWPayments API host does not match the selected mode.");
  }
  return `${url.origin}/v1`;
}

export function parseNowPaymentsRuntimeConfig(
  input: Record<string, string | undefined>,
  nodeEnv: string | undefined,
): NowPaymentsRuntimeConfig {
  const parsed = rawSchema.parse(input);
  const { NOWPAYMENTS_MODE: mode } = parsed;

  if (mode === "disabled") {
    return {
      mode,
      apiBaseUrl: null,
      apiKey: null,
      ipnSecret: null,
      timeoutMs: parsed.NOWPAYMENTS_TIMEOUT_MS,
    };
  }

  if (mode === "mock" && nodeEnv === "production") {
    throw new Error("NOWPayments mock mode is forbidden in production.");
  }

  const ipnSecret = parsed.NOWPAYMENTS_IPN_SECRET?.trim();
  if (!ipnSecret || ipnSecret.length < 16) {
    throw new Error("NOWPAYMENTS_IPN_SECRET must contain at least 16 characters.");
  }

  if (mode === "mock") {
    return {
      mode,
      apiBaseUrl: null,
      apiKey: null,
      ipnSecret,
      timeoutMs: parsed.NOWPAYMENTS_TIMEOUT_MS,
    };
  }

  const apiKey = parsed.NOWPAYMENTS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("NOWPAYMENTS_API_KEY is required in sandbox or production mode.");
  }

  const rawBaseUrl =
    parsed.NOWPAYMENTS_API_BASE_URL?.trim() ||
    (mode === "production" ? "https://api.nowpayments.io/v1" : "");
  if (!rawBaseUrl) {
    throw new Error(
      "NOWPAYMENTS_API_BASE_URL is required in sandbox mode; copy it from the current official sandbox documentation.",
    );
  }

  return {
    mode,
    apiBaseUrl: normalizeApiBaseUrl(rawBaseUrl, mode),
    apiKey,
    ipnSecret,
    timeoutMs: parsed.NOWPAYMENTS_TIMEOUT_MS,
  };
}
