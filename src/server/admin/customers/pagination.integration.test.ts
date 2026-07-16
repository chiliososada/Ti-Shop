import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: "pagination-admin" } },
    roles: ["owner"],
    permissions: new Set([
      "customers.read",
      "customers.manage",
      "orders.read",
      "users.manage",
    ]),
  })),
}));

import { getAdminCustomerIndex } from "@/server/admin/customers/queries";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("customer administration pagination", () => {
  const suffix = randomUUID();
  const marker = `customer-page-${suffix}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const baseTime = Date.now() - 100_000;
    await getDb().user.createMany({
      data: Array.from({ length: 32 }, (_, index) => ({
        name: `${marker}-${String(index).padStart(2, "0")}`,
        email: `${marker}-${index}@example.invalid`,
        createdAt: new Date(baseTime + index * 1_000),
      })),
    });
  });

  afterAll(async () => {
    await getDb().user.deleteMany({
      where: { email: { contains: suffix } },
    });
  });

  it("returns a stable later page and clamps an out-of-range request", async () => {
    const laterPage = await getAdminCustomerIndex({ q: marker, page: "2" });
    expect(laterPage.pagination).toMatchObject({
      page: 2,
      pageCount: 2,
      pageSize: 30,
      total: 32,
      skip: 30,
    });
    expect(laterPage.customers.map(({ name }) => name)).toEqual([
      `${marker}-01`,
      `${marker}-00`,
    ]);

    const outOfRange = await getAdminCustomerIndex({
      q: marker,
      page: "999",
    });
    expect(outOfRange.filters.page).toBe(2);
    expect(outOfRange.customers.map(({ publicId }) => publicId)).toEqual(
      laterPage.customers.map(({ publicId }) => publicId),
    );
  });

  it("searches customer identity fields without escaping the page boundary", async () => {
    const result = await getAdminCustomerIndex({
      q: `${marker}-7@example.invalid`,
      page: "2",
    });
    expect(result.pagination).toMatchObject({ page: 1, pageCount: 1, total: 1 });
    expect(result.customers).toHaveLength(1);
    expect(result.customers[0]?.email).toBe(`${marker}-7@example.invalid`);
  });
});
