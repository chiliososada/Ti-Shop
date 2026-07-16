import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ userId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({
  requireUser: vi.fn(async () => ({
    user: { id: authorization.userId },
    session: { id: "address-test-session" },
  })),
}));

import { createCurrentCustomerAddress } from "@/server/account/addresses";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("customer address creation idempotency", () => {
  const suffix = randomUUID();
  let userId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const user = await getDb().user.create({
      data: {
        name: "Address integration customer",
        email: `address-${suffix}@example.invalid`,
      },
      select: { id: true },
    });
    userId = user.id;
    authorization.userId = user.id;
  });

  afterAll(async () => {
    if (userId) await getDb().user.delete({ where: { id: userId } });
  });

  it("returns the original address for a replayed submission token", async () => {
    const submissionId = randomUUID();
    const input = {
      submissionId,
      label: "Lab",
      recipientName: "Research Customer",
      company: null,
      line1: "1 Research Way",
      line2: null,
      city: "Boston",
      region: "MA",
      postalCode: "02110",
      countryCode: "US" as const,
      phone: null,
      isDefaultShipping: true,
      isDefaultBilling: true,
    };

    const first = await createCurrentCustomerAddress(input);
    const replay = await createCurrentCustomerAddress({
      ...input,
      label: "A changed replay must not overwrite",
    });

    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(replay).toEqual({
      ok: true,
      duplicate: true,
      addressId: first.ok ? first.addressId : "unreachable",
    });
    expect(
      await getDb().address.findMany({
        where: { userId, createRequestId: submissionId },
        select: { label: true },
      }),
    ).toEqual([{ label: "Lab" }]);
  });
});
