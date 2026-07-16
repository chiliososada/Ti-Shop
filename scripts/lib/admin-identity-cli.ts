import { z } from "zod";

export type AdminIdentity = {
  userId: string;
  email: string;
};

export class AdminIdentityCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminIdentityCliUsageError";
  }
}

const identitySchema = z
  .object({
    userId: z.uuid(),
    email: z.email().transform((value) => value.trim().toLowerCase()),
  })
  .strict();

function parseIdentityFlags(
  args: string[],
  confirmationFlag: string,
): AdminIdentity {
  const values: Partial<Record<"userId" | "email", string>> = {};
  let confirmed = false;

  for (const argument of args) {
    if (argument === confirmationFlag) {
      if (confirmed) {
        throw new AdminIdentityCliUsageError(
          `The ${confirmationFlag} flag may only be supplied once.`,
        );
      }
      confirmed = true;
      continue;
    }

    const match = /^(--user-id|--email)=(.+)$/u.exec(argument);
    if (!match) {
      throw new AdminIdentityCliUsageError(
        `Unknown or malformed argument: ${argument || "<empty>"}.`,
      );
    }

    const key = match[1] === "--user-id" ? "userId" : "email";
    if (values[key] !== undefined) {
      throw new AdminIdentityCliUsageError(
        `The ${match[1]} flag may only be supplied once.`,
      );
    }
    values[key] = match[2];
  }

  if (!confirmed) {
    throw new AdminIdentityCliUsageError(
      `The explicit ${confirmationFlag} confirmation flag is required.`,
    );
  }

  const parsed = identitySchema.safeParse(values);
  if (!parsed.success) {
    throw new AdminIdentityCliUsageError(
      "Both --user-id=<uuid> and --email=<registered-email> are required and must be valid.",
    );
  }

  return parsed.data;
}

export function parseGrantAdminArgs(args: string[]): AdminIdentity {
  return parseIdentityFlags(args, "--confirm-owner-grant");
}

export function parseVerifyUserEmailArgs(args: string[]): AdminIdentity {
  return parseIdentityFlags(args, "--confirm-out-of-band");
}
