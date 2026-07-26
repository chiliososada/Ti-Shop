import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveEmailConfigState } from "@/server/email/config";

const FULL_ENV = {
  SMTP_HOST: "mail49.onamae.ne.jp",
  SMTP_PORT: "465",
  SMTP_USER: "support@flintmarrow.com",
  SMTP_PASSWORD: "secret",
};

describe("resolveEmailConfigState", () => {
  it("reports unconfigured with a stable reason when nothing is set", () => {
    const state = resolveEmailConfigState({});
    expect(state.configured).toBe(false);
    if (!state.configured) {
      expect(state.reason).toContain("SMTP_");
    }
  });

  it("names the missing keys when configuration is partial", () => {
    const state = resolveEmailConfigState({ SMTP_HOST: "mail.example.com" });
    expect(state.configured).toBe(false);
    if (!state.configured) {
      expect(state.reason).toContain("SMTP_USER");
      expect(state.reason).toContain("SMTP_PASSWORD");
    }
  });

  it("derives implicit TLS and the from address from the SMTP user", () => {
    const state = resolveEmailConfigState(FULL_ENV);
    expect(state.configured).toBe(true);
    if (state.configured) {
      expect(state.env.secure).toBe(true);
      expect(state.env.fromAddress).toBe("support@flintmarrow.com");
      expect(state.env.fromName).toBe("Flintmarrow");
      expect(state.env.replyTo).toBeNull();
    }
  });

  it("treats compose-style empty strings as absent optional values", () => {
    const state = resolveEmailConfigState({
      ...FULL_ENV,
      SMTP_SECURE: "",
      MAIL_FROM_ADDRESS: "",
      MAIL_REPLY_TO: "",
    });
    expect(state.configured).toBe(true);
    if (state.configured) {
      expect(state.env.secure).toBe(true);
      expect(state.env.fromAddress).toBe("support@flintmarrow.com");
      expect(state.env.replyTo).toBeNull();
    }
  });

  it("routes replies to the service inbox when MAIL_REPLY_TO is set", () => {
    const state = resolveEmailConfigState({
      ...FULL_ENV,
      MAIL_REPLY_TO: "sales01@flintmarrow.com",
    });
    expect(state.configured).toBe(true);
    if (state.configured) {
      expect(state.env.replyTo).toBe("sales01@flintmarrow.com");
    }
  });

  it("honors explicit overrides for port security and sender identity", () => {
    const state = resolveEmailConfigState({
      ...FULL_ENV,
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      MAIL_FROM_NAME: "Flintmarrow Support",
      MAIL_FROM_ADDRESS: "orders@flintmarrow.com",
    });
    expect(state.configured).toBe(true);
    if (state.configured) {
      expect(state.env.port).toBe(587);
      expect(state.env.secure).toBe(false);
      expect(state.env.fromName).toBe("Flintmarrow Support");
      expect(state.env.fromAddress).toBe("orders@flintmarrow.com");
    }
  });
});
