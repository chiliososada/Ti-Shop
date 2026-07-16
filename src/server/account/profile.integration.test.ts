import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ userId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({
  requireUser: vi.fn(async () => ({
    user: { id: authorization.userId },
    session: { id: "profile-test-session" },
  })),
}));

import { updateCurrentCustomerProfile } from "@/server/account/profile";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("customer self-service profile", () => {
  const suffix = randomUUID();
  let userId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const user = await getDb().user.create({
      data: {
        name: "Profile integration customer",
        email: `profile-${suffix}@example.invalid`,
      },
      select: { id: true },
    });
    userId = user.id;
    authorization.userId = user.id;
  });

  afterAll(async () => {
    if (!userId) return;
    const db = getDb();
    await db.auditLog.deleteMany({ where: { actorUserId: userId } });
    await db.outboxEvent.deleteMany({
      where: { aggregateType: "customer", aggregateId: userId },
    });
    await db.user.delete({ where: { id: userId } });
  });

  it("updates its own profile with durable consent evidence and blocks a disabled account", async () => {
    const updated = await updateCurrentCustomerProfile({
      name: "Updated profile customer",
      firstName: "Updated",
      lastName: "Customer",
      phone: "+1 415 555 0100",
      countryCode: "US",
      preferredCurrency: "USD",
      locale: "en-US",
      marketingConsent: true,
    });
    expect(updated).toEqual({ ok: true });

    const db = getDb();
    const [account, auditCount, outboxCount] = await Promise.all([
      db.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          name: true,
          customerProfile: {
            select: {
              firstName: true,
              lastName: true,
              phone: true,
              marketingConsent: true,
              countryCode: true,
              preferredCurrency: true,
            },
          },
        },
      }),
      db.auditLog.count({
        where: { actorUserId: userId, action: "account.profile.update" },
      }),
      db.outboxEvent.count({
        where: {
          aggregateType: "customer",
          aggregateId: userId,
          eventType: "customer.profile.updated_by_customer",
        },
      }),
    ]);
    expect(account).toMatchObject({
      name: "Updated profile customer",
      customerProfile: {
        firstName: "Updated",
        lastName: "Customer",
        phone: "+1 415 555 0100",
        marketingConsent: true,
        countryCode: "US",
        preferredCurrency: "USD",
      },
    });
    expect(auditCount).toBe(1);
    expect(outboxCount).toBe(1);

    await db.user.update({
      where: { id: userId },
      data: {
        disabledAt: new Date(),
        disabledReason: "Integration test account access is disabled.",
      },
      select: { id: true },
    });
    const blocked = await updateCurrentCustomerProfile({
      name: "Must not be written",
      firstName: null,
      lastName: null,
      phone: null,
      countryCode: "US",
      preferredCurrency: "USD",
      locale: "en-US",
      marketingConsent: false,
    });
    expect(blocked).toEqual({ ok: false, reason: "inactive" });
    expect(
      await db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { name: true },
      }),
    ).toEqual({ name: "Updated profile customer" });
  });
});
