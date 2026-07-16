import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  parseAuthRuntimeEnv,
  parseDatabaseRuntimeEnv,
} from "@/server/config/runtime-env";

const opensslStyleSecret =
  "uRlbMjMbtg8d2wHvjXfY6kNCHafX5qL5SgQj4OP3lcrfMzPkdc9AsDLa1xV2G7Qb";

describe("authentication runtime environment", () => {
  it("allows an HTTP site origin only outside production", () => {
    expect(
      parseAuthRuntimeEnv(
        {
          BETTER_AUTH_SECRET: "development-only-secret-at-least-32-characters",
          SITE_URL: "http://localhost:3000",
        },
        "development",
      ).siteOrigin,
    ).toBe("http://localhost:3000");

    expect(() =>
      parseAuthRuntimeEnv(
        {
          BETTER_AUTH_SECRET: opensslStyleSecret,
          SITE_URL: "http://shop.example",
        },
        "production",
      ),
    ).toThrow(/https:\/\//u);
  });

  it("accepts an HTTPS production origin and an OpenSSL-style random secret", () => {
    expect(
      parseAuthRuntimeEnv(
        {
          BETTER_AUTH_SECRET: opensslStyleSecret,
          SITE_URL: "https://shop.example",
        },
        "production",
      ),
    ).toMatchObject({
      secret: opensslStyleSecret,
      siteOrigin: "https://shop.example",
    });
  });

  it.each([
    "REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS",
    "replace-with-a-unique-production-secret-value-1234567890",
    "this-is-an-example-production-secret-value-123456789012",
  ])("rejects production placeholder secret %s", (secret) => {
    expect(() =>
      parseAuthRuntimeEnv(
        { BETTER_AUTH_SECRET: secret, SITE_URL: "https://shop.example" },
        "production",
      ),
    ).toThrow(/placeholder/u);
  });

  it("rejects short and low-diversity production secrets", () => {
    expect(() =>
      parseAuthRuntimeEnv(
        {
          BETTER_AUTH_SECRET: "short-production-secret-value-123456",
          SITE_URL: "https://shop.example",
        },
        "production",
      ),
    ).toThrow(/48 characters/u);

    expect(() =>
      parseAuthRuntimeEnv(
        { BETTER_AUTH_SECRET: "a".repeat(64), SITE_URL: "https://shop.example" },
        "production",
      ),
    ).toThrow(/high-entropy/u);
  });
});

describe("database runtime environment", () => {
  it("requires TLS for a public production database host", () => {
    expect(() =>
      parseDatabaseRuntimeEnv(
        {
          DATABASE_URL:
            "postgresql://runtime:secret@database.example.com:5432/ti_shop",
        },
      ),
    ).toThrow(/sslmode=verify-full/u);

    expect(
      parseDatabaseRuntimeEnv(
        {
          DATABASE_URL:
            "postgresql://runtime:secret@database.example.com:5432/ti_shop?sslmode=verify-full",
        },
      ).DATABASE_URL,
    ).toContain("sslmode=verify-full");
  });

  it("allows private database hosts without TLS and protects public hosts in every environment", () => {
    expect(
      parseDatabaseRuntimeEnv(
        {
          DATABASE_URL: "postgresql://runtime:secret@postgres:5432/ti_shop",
        },
      ).DATABASE_URL,
    ).toContain("@postgres:");

    expect(() =>
      parseDatabaseRuntimeEnv(
        {
          DATABASE_URL:
            "postgresql://runtime:secret@database.example.com:5432/ti_shop",
        },
      ),
    ).toThrow(/sslmode=verify-full/u);
  });

  it.each([
    "postgresql://runtime:secret@postgres:5432/ti_shop?host=database.example.com",
    "postgresql://runtime:secret@postgres:5432/ti_shop?ho%73t=database.example.com",
    "postgresql://runtime:secret@postgres:5432/ti_shop?hostaddr=203.0.113.10",
  ])("rejects PostgreSQL query parameters that override the authority host: %s", (url) => {
    expect(() =>
      parseDatabaseRuntimeEnv({ DATABASE_URL: url }),
    ).toThrow(/authority host/u);
  });

  it.each([
    "postgresql://runtime:secret@database.example.com:5432/ti_shop?sslmode=verify-full&sslmode=disable",
    "postgresql://runtime:secret@database.example.com:5432/ti_shop?sslmode=verify-full&uselibpqcompat=true",
    "postgresql://runtime:secret@database.example.com:5432/ti_shop?sslmode=verify-full&ssl=true",
    "postgresql://runtime:secret@database.example.com:5432/ti_shop?sslmode=require",
    "postgresql://runtime:secret@database.example.com:5432/ti_shop?sslmode=verify-ca",
  ])("rejects ambiguous or certificate-bypassing production TLS parameters: %s", (url) => {
    expect(() =>
      parseDatabaseRuntimeEnv({ DATABASE_URL: url }),
    ).toThrow(/sslmode|security parameter/u);
  });

  it.each([
    "postgresql://runtime:secret@database.example.com:5432/ti_shop?SSLMODE=verify-full",
    "postgresql://runtime:secret@database.example.com:5432/ti_shop?sslMode=verify-full",
    "postgresql://runtime:secret@database.example.com:5432/ti_shop?ssl%4dode=verify-full",
  ])("rejects case variants that PostgreSQL treats as unknown TLS parameters: %s", (url) => {
    expect(() =>
      parseDatabaseRuntimeEnv({ DATABASE_URL: url }),
    ).toThrow(/must be lowercase/u);
  });
});
