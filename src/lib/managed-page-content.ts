export const MANAGED_PAGE_BODY_MAX_LENGTH = 100_000;

export type ManagedPageContentBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

export type ManagedPageBodyIssue =
  | "empty"
  | "too_long"
  | "control_character"
  | "html"
  | "personal_information"
  | "payment_secret";

const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const EMAIL_ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/iu;
const US_PHONE_NUMBER =
  /(?:^|\D)(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?:\D|$)/u;
const US_SSN = /(?:^|\D)\d{3}-\d{2}-\d{4}(?:\D|$)/u;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|SEED)-----/iu;
const SECRET_ASSIGNMENT =
  /\b(?:nowpayments?\s+)?(?:api[ _-]?key|ipn[ _-]?secret|secret|password|access[ _-]?token|private[ _-]?key|recovery[ _-]?phrase|seed[ _-]?phrase)\s*[:=]\s*["']?[A-Z0-9_./+=:-]{12,}/iu;
const BANK_DETAIL_ASSIGNMENT =
  /\b(?:bank\s+)?(?:routing|account|aba|iban|swift|bic)(?:\s+(?:number|code))?\s*[:=]\s*[A-Z0-9][A-Z0-9 -]{5,40}\b/iu;
const ZELLE_DESTINATION =
  /\bzelle\b.{0,48}\b(?:send\s+to|recipient|email|phone|number|handle)\b\s*[:=]?\s*(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}|\+?[\d(). -]{7,})/iu;
const PAYMENT_CARD_DETAIL =
  /\b(?:card|pan|credit|debit)(?:\s+number)?\s*[:=]\s*(?:\d[ -]?){13,19}\b/iu;
const CRYPTO_DESTINATION =
  /\b(?:wallet|crypto\s+address|send\s+to)\s*[:=]\s*(?:0x[a-f0-9]{40}|bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/iu;

export function inspectManagedPageBody(value: string): ManagedPageBodyIssue | null {
  if (value.trim().length === 0) return "empty";
  if (value.length > MANAGED_PAGE_BODY_MAX_LENGTH) return "too_long";
  if (FORBIDDEN_CONTROL.test(value)) return "control_character";
  if (value.includes("<") || value.includes(">")) return "html";
  if (EMAIL_ADDRESS.test(value) || US_PHONE_NUMBER.test(value) || US_SSN.test(value)) {
    return "personal_information";
  }
  if (
    PRIVATE_KEY_BLOCK.test(value) ||
    SECRET_ASSIGNMENT.test(value) ||
    BANK_DETAIL_ASSIGNMENT.test(value) ||
    ZELLE_DESTINATION.test(value) ||
    PAYMENT_CARD_DETAIL.test(value) ||
    CRYPTO_DESTINATION.test(value)
  ) {
    return "payment_secret";
  }
  return null;
}

export function parseManagedPageContent(
  body: string,
): ManagedPageContentBlock[] | null {
  if (inspectManagedPageBody(body) !== null) return null;

  const blocks = body
    .trim()
    .split(/\n{2,}/u)
    .slice(0, 200)
    .flatMap((section): ManagedPageContentBlock[] => {
      const value = section.trim();
      if (!value) return [];
      if (/^#{2,3}\s+/u.test(value)) {
        const text = value.replace(/^#{2,3}\s+/u, "").trim();
        return text ? [{ type: "heading", text }] : [];
      }

      const lines = value.split("\n").map((line) => line.trim());
      if (lines.length <= 100 && lines.every((line) => /^[-*]\s+/u.test(line))) {
        const items = lines
          .map((line) => line.replace(/^[-*]\s+/u, "").trim())
          .filter(Boolean);
        return items.length > 0 ? [{ type: "list", items }] : [];
      }

      return [{ type: "paragraph", text: lines.join("\n") }];
    });

  return blocks.length > 0 ? blocks : null;
}
