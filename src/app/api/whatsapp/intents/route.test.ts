import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  consumeRateLimit: vi.fn(),
  createIntent: vi.fn(),
}));

vi.mock("@/server/auth/auth", () => ({
  getAuth: () => ({ api: { getSession: mocks.getSession } }),
}));

vi.mock("@/server/security/rate-limit", () => ({
  consumeDatabaseRateLimit: mocks.consumeRateLimit,
}));

vi.mock("@/server/whatsapp/intents", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/server/whatsapp/intents")
  >();
  return {
    ...original,
    createWhatsAppContactIntent: mocks.createIntent,
  };
});

import { POST } from "./route";

function request(
  body: unknown,
  options: {
    origin?: string;
    contentType?: string;
    clientIp?: string;
    userAgent?: string;
  } = {},
) {
  return new Request("https://shop.example/api/whatsapp/intents", {
    method: "POST",
    headers: {
      origin: options.origin ?? "https://shop.example",
      "content-type": options.contentType ?? "application/json",
      "user-agent": options.userAgent ?? "test-browser",
      "accept-language": "en-US",
      "x-ti-shop-client-ip": options.clientIp ?? "192.0.2.10",
    },
    body: JSON.stringify(body),
  });
}

describe("WhatsApp intent route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SITE_URL", "https://shop.example");
    vi.stubEnv("AUTH_CLIENT_IP_HEADER", "x-ti-shop-client-ip");
    vi.stubEnv("AUTH_TRUSTED_PROXY_CIDRS", "172.31.250.10/32");
    mocks.getSession.mockResolvedValue(null);
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 11,
      retryAfterSeconds: 0,
    });
    mocks.createIntent.mockResolvedValue({
      intentPublicId: "0191c24b-6666-7777-8888-999999999999",
      destinationUrl:
        "https://wa.me/12025550123?text=Hello%2C+I%27d+like+help.",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("records an intent before returning a trusted WhatsApp URL", async () => {
    const response = await POST(
      request({ templateKey: "global", sourcePath: "/" }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      intentPublicId: "0191c24b-6666-7777-8888-999999999999",
      url: "https://wa.me/12025550123?text=Hello%2C+I%27d+like+help.",
    });
    expect(mocks.createIntent).toHaveBeenCalledWith({
      input: { templateKey: "global", sourcePath: "/" },
      userId: null,
      siteOrigin: "https://shop.example",
    });
  });

  it("rejects cross-origin requests before authentication or writes", async () => {
    const response = await POST(
      request(
        { templateKey: "global", sourcePath: "/" },
        { origin: "https://attacker.example" },
      ),
    );

    expect(response.status).toBe(403);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.createIntent).not.toHaveBeenCalled();
  });

  it("rejects arbitrary message fields", async () => {
    const response = await POST(
      request({
        templateKey: "global",
        sourcePath: "/",
        message: "Arbitrary caller-supplied content",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createIntent).not.toHaveBeenCalled();
  });

  it("fails closed when the database rate limit cannot be checked", async () => {
    mocks.consumeRateLimit.mockRejectedValue(new Error("database offline"));

    const response = await POST(
      request({ templateKey: "global", sourcePath: "/" }),
    );

    expect(response.status).toBe(503);
    expect(mocks.createIntent).not.toHaveBeenCalled();
  });

  it("keys anonymous limits by trusted client IP instead of shared browser headers", async () => {
    await POST(
      request(
        { templateKey: "global", sourcePath: "/" },
        { clientIp: "192.0.2.20", userAgent: "same-browser" },
      ),
    );
    await POST(
      request(
        { templateKey: "global", sourcePath: "/" },
        { clientIp: "192.0.2.21", userAgent: "same-browser" },
      ),
    );
    await POST(
      request(
        { templateKey: "global", sourcePath: "/" },
        { clientIp: "192.0.2.20", userAgent: "rotated-browser" },
      ),
    );

    const keys = mocks.consumeRateLimit.mock.calls.map(
      ([input]) => (input as { key: string }).key,
    );
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toBe(keys[2]);
    expect(keys.every((key) => key.startsWith("whatsapp-intent:anonymous-ip:"))).toBe(
      true,
    );
  });

  it("does not return a URL if intent persistence fails", async () => {
    mocks.createIntent.mockRejectedValue(new Error("write failed"));

    const response = await POST(
      request({ templateKey: "global", sourcePath: "/" }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "CONTACT_TEMPORARILY_UNAVAILABLE",
      error:
        "WhatsApp contact is temporarily unavailable. No contact link was opened.",
    });
  });
});
