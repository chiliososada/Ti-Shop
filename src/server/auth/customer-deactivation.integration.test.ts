import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST as authPost } from "@/app/api/auth/[...all]/route";
import { getActiveSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

function credentialRequest(email: string, password: string, operation: "sign-up" | "sign-in") {
  return new Request(`http://localhost:3100/api/auth/${operation}/email`, {
    method: "POST",
    headers: {
      origin: "http://localhost:3100",
      "content-type": "application/json",
    },
    body: JSON.stringify(
      operation === "sign-up"
        ? { email, password, name: "Deactivation integration customer" }
        : { email, password, rememberMe: true },
    ),
  });
}

function cookieHeader(response: Response) {
  const setCookie = response.headers.getSetCookie()[0];
  if (!setCookie) throw new Error("Authentication response did not set a cookie.");
  return setCookie.split(";", 1)[0];
}

integration("disabled customer authentication boundary", () => {
  const suffix = randomUUID();
  const email = `disabled-login-${suffix}@example.invalid`;
  const password = "Integration-password-123!";
  let customerUserId = "";
  let disablingActorUserId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.SITE_URL = "http://localhost:3100";
    process.env.BETTER_AUTH_SECRET =
      "customer-deactivation-integration-secret-at-least-32-characters";
    const actor = await getDb().user.create({
      data: {
        name: "Deactivation integration actor",
        email: `disabled-actor-${suffix}@example.invalid`,
        emailVerified: true,
      },
      select: { id: true },
    });
    disablingActorUserId = actor.id;
  });

  afterAll(async () => {
    await getDb().user.deleteMany({
      where: {
        id: {
          in: [customerUserId, disablingActorUserId].filter(Boolean),
        },
      },
    });
  });

  it("rejects an old cookie and genericizes new credential login until explicit restore", async () => {
    const signUp = await authPost(credentialRequest(email, password, "sign-up"));
    expect(signUp.status).toBe(200);
    const oldCookie = cookieHeader(signUp);
    customerUserId = (
      await getDb().user.findUniqueOrThrow({
        where: { email },
        select: { id: true },
      })
    ).id;

    const activeSession = await getActiveSession(
      new Headers({ cookie: oldCookie }),
    );
    expect(activeSession?.user.id).toBe(customerUserId);

    await getDb().$transaction(async (tx) => {
      await tx.user.update({
        where: { id: customerUserId },
        data: {
          disabledAt: new Date(),
          disabledReason: "Credential login integration security hold.",
          disabledByUserId: disablingActorUserId,
        },
        select: { id: true },
      });
      await tx.session.deleteMany({ where: { userId: customerUserId } });
    });

    await expect(
      getActiveSession(new Headers({ cookie: oldCookie })),
    ).resolves.toBeNull();

    const [disabledLogin, unknownLogin] = await Promise.all([
      authPost(credentialRequest(email, password, "sign-in")),
      authPost(
        credentialRequest(
          `unknown-${suffix}@example.invalid`,
          password,
          "sign-in",
        ),
      ),
    ]);
    expect(disabledLogin.status).toBe(401);
    expect(unknownLogin.status).toBe(401);
    await expect(disabledLogin.json()).resolves.toEqual({
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: "Invalid email or password",
    });
    await expect(unknownLogin.json()).resolves.toEqual({
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: "Invalid email or password",
    });
    expect(
      await getDb().session.count({ where: { userId: customerUserId } }),
    ).toBe(0);

    await getDb().user.update({
      where: { id: customerUserId },
      data: {
        disabledAt: null,
        disabledReason: null,
        disabledByUserId: null,
      },
      select: { id: true },
    });
    await expect(
      getActiveSession(new Headers({ cookie: oldCookie })),
    ).resolves.toBeNull();

    const restoredLogin = await authPost(
      credentialRequest(email, password, "sign-in"),
    );
    expect(restoredLogin.status).toBe(200);
    const restoredCookie = cookieHeader(restoredLogin);
    expect(restoredCookie).not.toBe(oldCookie);
    expect(
      (await getActiveSession(new Headers({ cookie: restoredCookie })))?.user.id,
    ).toBe(customerUserId);
  });
});
