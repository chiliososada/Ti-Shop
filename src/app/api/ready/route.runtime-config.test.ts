import { afterEach, describe, expect, it, vi } from "vitest";

import { REQUIRED_APPLICATION_SCHEMA_VERSION } from "@/server/db/schema-version";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/server/db/client", () => ({
  getDb: () => ({ $queryRaw: mocks.queryRaw }),
}));

vi.mock("@/server/payments/nowpayments/runtime-config", () => ({
  getNowPaymentsRuntimeConfig: () => ({ mode: "disabled" }),
}));

const opensslStyleSecret =
  "uRlbMjMbtg8d2wHvjXfY6kNCHafX5qL5SgQj4OP3lcrfMzPkdc9AsDLa1xV2G7Qb";

function stubProductionEnvironment(siteUrl: string, secret = opensslStyleSecret) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SITE_URL", siteUrl);
  vi.stubEnv("BETTER_AUTH_SECRET", secret);
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://runtime:runtime@database.example:5432/ti_shop?sslmode=verify-full",
  );
}

describe("readiness with the real runtime environment validator", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("reports not ready for an HTTP production origin before querying PostgreSQL", async () => {
    stubProductionEnvironment("http://shop.example");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/ready/route");

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready" });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("reports not ready for a production placeholder secret", async () => {
    stubProductionEnvironment(
      "https://shop.example",
      "REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS",
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/ready/route");

    const response = await GET();

    expect(response.status).toBe(503);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("becomes ready with valid production auth and database configuration", async () => {
    stubProductionEnvironment("https://shop.example");
    mocks.queryRaw.mockResolvedValue([
      { version: REQUIRED_APPLICATION_SCHEMA_VERSION },
    ]);
    const { GET } = await import("@/app/api/ready/route");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
  });
});
