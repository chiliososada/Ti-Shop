import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  listOrdersForUser: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  getActiveSession: mocks.getActiveSession,
}));

vi.mock("@/server/orders/queries", () => ({
  getOrderForUser: vi.fn(),
  listOrdersForUser: mocks.listOrdersForUser,
}));

vi.mock("@/server/orders/create-order", () => ({
  createCustomerOrder: vi.fn(),
}));

vi.mock("@/server/security/rate-limit", () => ({
  consumeDatabaseRateLimit: vi.fn(),
}));

import { handleListOrdersRequest } from "@/server/orders/http";

describe("order HTTP authentication failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 only when session verification completes without a session", async () => {
    mocks.getActiveSession.mockResolvedValue(null);

    const response = await handleListOrdersRequest(
      new Request("https://shop.example/api/orders"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(mocks.listOrdersForUser).not.toHaveBeenCalled();
  });

  it("returns 503 when account verification cannot reach its backing service", async () => {
    mocks.getActiveSession.mockRejectedValue(new Error("database unavailable"));

    const response = await handleListOrdersRequest(
      new Request("https://shop.example/api/orders"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTHENTICATION_UNAVAILABLE",
    });
    expect(mocks.listOrdersForUser).not.toHaveBeenCalled();
  });
});
