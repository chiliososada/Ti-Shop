import "server-only";

import { z } from "zod";

/**
 * SMTP settings come exclusively from the environment: credentials must never
 * live in the database, and the worker container already receives the same
 * .env file as the app. Template wording, by contrast, is operator content
 * and lives in SiteSetting (see templates.ts).
 */
const emailEnvSchema = z.object({
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  SMTP_USER: z.string().min(1),
  SMTP_PASSWORD: z.string().min(1),
  MAIL_FROM_NAME: z.string().min(1).default("Flintmarrow"),
  MAIL_FROM_ADDRESS: z.string().email().optional(),
  MAIL_REPLY_TO: z.string().email().optional(),
});

export type EmailRuntimeEnv = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromAddress: string;
  replyTo: string | null;
};

export type EmailConfigState =
  | { configured: true; env: EmailRuntimeEnv }
  | { configured: false; reason: string };

const REQUIRED_KEYS = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"] as const;

export function resolveEmailConfigState(
  source: Record<string, string | undefined> = process.env,
): EmailConfigState {
  const present = REQUIRED_KEYS.filter((key) => source[key]);
  if (present.length === 0) {
    return {
      configured: false,
      reason:
        "Transactional email is not configured. Set the SMTP_* environment variables to enable customer notifications.",
    };
  }
  const parsed = emailEnvSchema.safeParse(source);
  if (!parsed.success) {
    const missing = REQUIRED_KEYS.filter((key) => !source[key]);
    return {
      configured: false,
      reason:
        missing.length > 0
          ? `Email configuration is incomplete. Missing: ${missing.join(", ")}.`
          : "Email configuration is invalid. Check the SMTP_* environment variables.",
    };
  }
  const env = parsed.data;
  return {
    configured: true,
    env: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // Port 465 is implicit TLS; anything else defaults to STARTTLS-capable
      // plain connection unless explicitly overridden.
      secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      fromName: env.MAIL_FROM_NAME,
      fromAddress: env.MAIL_FROM_ADDRESS ?? env.SMTP_USER,
      replyTo: env.MAIL_REPLY_TO ?? null,
    },
  };
}

export function getEmailConfigState(): EmailConfigState {
  return resolveEmailConfigState(process.env);
}
