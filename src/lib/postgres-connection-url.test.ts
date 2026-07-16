import { describe, expect, it } from "vitest";

import { validatePostgresConnectionUrl } from "@/lib/postgres-connection-url";

const directOptions = {
  label: "DIRECT_URL",
  requiredSchema: "app",
} as const;

describe("PostgreSQL connection URL security", () => {
  it("keeps privileged migration history in the app schema", () => {
    expect(() =>
      validatePostgresConnectionUrl(
        "postgresql://migrator:secret@localhost:5432/ti_shop",
        directOptions,
      ),
    ).toThrow(/schema=app/u);

    expect(
      validatePostgresConnectionUrl(
        "postgresql://migrator:secret@localhost:5432/ti_shop?schema=app",
        directOptions,
      ),
    ).toContain("schema=app");
  });

  it.each([
    "postgresql://migrator:secret@database.example.com:5432/ti_shop?schema=app",
    "postgresql://migrator:secret@postgres:5432/ti_shop?schema=app&host=database.example.com",
    "postgresql://migrator:secret@database.example.com:5432/ti_shop?schema=app&sslmode=verify-full&sslmode=disable",
    "postgresql://migrator:secret@database.example.com:5432/ti_shop?schema=app&SSLMODE=verify-full",
    "postgresql://migrator:secret@database.example.com:5432/ti_shop?schema=app&sslmode=VERIFY-FULL",
    "postgresql://migrator:secret@localhost:5432/ti_shop?SCHEMA=app",
    "postgresql://migrator:secret@localhost:5432/ti_shop?sche%4da=app",
    "postgresql://migrator:secret@database.example.com:5432/ti_shop?schema=app&sslmode=verify-full&uselibpqcompat=true",
  ])("rejects an unsafe privileged connection before Prisma or pg sees it: %s", (url) => {
    expect(() => validatePostgresConnectionUrl(url, directOptions)).toThrow();
  });

  it("accepts one certificate-verifying public connection with the private schema", () => {
    expect(
      validatePostgresConnectionUrl(
        "postgresql://migrator:secret@database.example.com:5432/ti_shop?schema=app&sslmode=verify-full",
        directOptions,
      ),
    ).toContain("sslmode=verify-full");
  });
});
