import "server-only";

import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { accountNameSchema } from "@/server/auth/account-name";
import { getAuthRuntimeEnv } from "@/server/config/runtime-env";
import { getDb } from "@/server/db/client";
import { renderPasswordResetEmail } from "@/server/email/account-emails";
import { getEmailConfigState } from "@/server/email/config";
import { sendViaSmtp } from "@/server/email/transport";

function createAuth() {
  const env = getAuthRuntimeEnv();
  const db = getDb();

  return betterAuth({
    appName: "Flintmarrow",
    baseURL: env.siteOrigin,
    basePath: "/api/auth",
    secret: env.secret,
    trustedOrigins: [env.siteOrigin],
    database: prismaAdapter(db, {
      provider: "postgresql",
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 6,
      maxPasswordLength: 128,
      requireEmailVerification: false,
      resetPasswordTokenExpiresIn: 60 * 60,
      async sendResetPassword({ user, url }) {
        const emailConfig = getEmailConfigState();
        if (!emailConfig.configured) {
          // Failing loudly beats telling the customer an email is on the way
          // when no mail can leave the box.
          throw new Error(emailConfig.reason);
        }
        const rendered = renderPasswordResetEmail({
          resetUrl: url,
          expiresMinutes: 60,
        });
        await sendViaSmtp(emailConfig.env, {
          to: user.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
      },
    },
    user: {
      additionalFields: {
        disabledAt: {
          type: "date",
          required: false,
          input: false,
          returned: false,
        },
        disabledReason: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
        disabledByUserId: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
      },
    },
    databaseHooks: {
      session: {
        create: {
          async before(session, context) {
            if (!context) return;
            const user = await context.context.internalAdapter.findUserById(
              session.userId,
            );
            if ((user as { disabledAt?: Date | null } | null)?.disabledAt) {
              // Match the ordinary credential failure response. The customer
              // account state must not be disclosed by the login endpoint.
              throw new APIError("UNAUTHORIZED", {
                code: "INVALID_EMAIL_OR_PASSWORD",
                message: "Invalid email or password",
              });
            }
          },
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        const validatesName =
          context.path === "/sign-up/email" ||
          (context.path === "/update-user" &&
            context.body?.name !== undefined);

        if (!validatesName) {
          return;
        }

        const parsed = accountNameSchema.safeParse(context.body?.name);
        if (!parsed.success) {
          throw new APIError("BAD_REQUEST", {
            code: "INVALID_NAME",
            message: "Name must contain 2–255 non-whitespace characters.",
          });
        }

        context.body.name = parsed.data;
      }),
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: env.ipAddressHeaders,
        trustedProxies: env.trustedProxyCidrs,
        ipv6Subnet: 64,
      },
      database: {
        generateId: "uuid",
      },
    },
  });
}

type TiShopAuth = ReturnType<typeof createAuth>;

let auth: TiShopAuth | undefined;

/** Runtime-only singleton. Do not call this at module scope in a route. */
export function getAuth(): TiShopAuth {
  auth ??= createAuth();
  return auth;
}
