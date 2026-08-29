import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { renderPasswordResetEmail } from "@/server/email/account-emails";

describe("renderPasswordResetEmail", () => {
  it("includes the reset link in both bodies and states the expiry", () => {
    const rendered = renderPasswordResetEmail({
      resetUrl: "https://flintmarrow.com/api/auth/reset-password/tok?callbackURL=%2Freset-password",
      expiresMinutes: 60,
    });
    expect(rendered.subject).toBe("Reset your Flintmarrow password");
    expect(rendered.html).toContain("reset-password/tok");
    expect(rendered.html).toContain("60 minutes");
    expect(rendered.text).toContain("reset-password/tok");
    expect(rendered.text).toContain("safely ignore");
  });

  it("escapes hostile characters in the URL for the HTML body", () => {
    const rendered = renderPasswordResetEmail({
      resetUrl: 'https://flintmarrow.com/x?a=1&b="<s>"',
      expiresMinutes: 60,
    });
    expect(rendered.html).not.toContain('"<s>"');
    expect(rendered.html).toContain("&amp;b=");
  });
});
