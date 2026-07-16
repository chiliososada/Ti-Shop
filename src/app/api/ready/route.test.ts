import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthRuntimeEnv: vi.fn(),
  getDatabaseRuntimeEnv: vi.fn(),
  getNowPaymentsRuntimeConfig: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/server/config/runtime-env", () => ({
  getAuthRuntimeEnv: mocks.getAuthRuntimeEnv,
  getDatabaseRuntimeEnv: mocks.getDatabaseRuntimeEnv,
}));

vi.mock("@/server/db/client", () => ({
  getDb: () => ({ $queryRaw: mocks.queryRaw }),
}));

vi.mock("@/server/payments/nowpayments/runtime-config", () => ({
  getNowPaymentsRuntimeConfig: mocks.getNowPaymentsRuntimeConfig,
}));

import { GET } from "@/app/api/ready/route";
import { REQUIRED_APPLICATION_SCHEMA_VERSION } from "@/server/db/schema-version";

describe("readiness endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthRuntimeEnv.mockReturnValue({});
    mocks.getDatabaseRuntimeEnv.mockReturnValue({});
    mocks.getNowPaymentsRuntimeConfig.mockReturnValue({ mode: "disabled" });
    mocks.queryRaw.mockResolvedValue([
      { version: REQUIRED_APPLICATION_SCHEMA_VERSION },
    ]);
  });

  it("fails closed when the selected payment runtime mode is invalid", async () => {
    mocks.getNowPaymentsRuntimeConfig.mockImplementation(() => {
      throw new Error("invalid NOWPayments configuration");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(503);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("is ready only after runtime configuration and PostgreSQL succeed", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
  });

  it("fails closed when required runtime configuration is missing", async () => {
    mocks.getAuthRuntimeEnv.mockImplementation(() => {
      throw new Error("invalid environment");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready" });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("fails closed when PostgreSQL is unavailable", async () => {
    mocks.queryRaw.mockRejectedValue(new Error("connection refused"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    consoleError.mockRestore();
  });

  it("fails closed when PostgreSQL is reachable but the application schema is stale", async () => {
    mocks.queryRaw.mockResolvedValue([
      { version: "20260713143000_public_id_default_consistency" },
    ]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready" });
    consoleError.mockRestore();
  });

  it("fails closed when the schema exists but baseline seed data is absent", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(503);
    consoleError.mockRestore();
  });
});
