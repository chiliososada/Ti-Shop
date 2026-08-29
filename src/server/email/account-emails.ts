import "server-only";

/**
 * Account-lifecycle emails (password reset). Unlike order notifications these
 * are sent inline from the auth endpoint rather than through the outbox: the
 * person is sitting at the form waiting, and a reset link that arrives twenty
 * minutes late has usually already been replaced by a newer request.
 */

const BRAND_COLOR = "#43543d";
const MUTED_COLOR = "#5a6069";
const LINE_COLOR = "#e4e4de";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export type RenderedAccountEmail = {
  subject: string;
  html: string;
  text: string;
};

export function renderPasswordResetEmail(input: {
  resetUrl: string;
  expiresMinutes: number;
}): RenderedAccountEmail {
  const subject = "Reset your Flintmarrow password";
  const url = escapeHtml(input.resetUrl);
  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#faf7f0;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#21252b;">
  <table role="presentation" width="100%" style="border-collapse:collapse;background:#faf7f0;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" style="max-width:600px;width:100%;border-collapse:collapse;background:#ffffff;border-radius:12px;">
        <tr><td style="padding:28px 32px 12px;">
          <div style="font-size:20px;font-weight:bold;letter-spacing:0.12em;color:${BRAND_COLOR};">FLINTMARROW</div>
        </td></tr>
        <tr><td style="padding:8px 32px 24px;font-size:15px;line-height:1.65;">
          <p style="margin:0 0 14px;">We received a request to reset the password for your Flintmarrow account.</p>
          <p style="margin:20px 0;">
            <a href="${url}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:999px;font-size:14px;font-weight:bold;">Set a new password</a>
          </p>
          <p style="margin:0 0 14px;color:${MUTED_COLOR};font-size:13px;">This link expires in ${input.expiresMinutes} minutes and can be used once. If the button does not work, copy this address into your browser:<br/><span style="word-break:break-all;">${url}</span></p>
          <p style="margin:0;color:${MUTED_COLOR};font-size:13px;">If you did not request this, you can safely ignore this email — your password stays unchanged.</p>
        </td></tr>
        <tr><td style="padding:18px 32px 26px;border-top:1px solid ${LINE_COLOR};font-size:12px;color:${MUTED_COLOR};line-height:1.6;">
          This is a transactional message about your account. Replies reach our support inbox.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = [
    "We received a request to reset the password for your Flintmarrow account.",
    "",
    `Set a new password: ${input.resetUrl}`,
    "",
    `This link expires in ${input.expiresMinutes} minutes and can be used once.`,
    "If you did not request this, you can safely ignore this email — your password stays unchanged.",
  ].join("\n");
  return { subject, html, text };
}
