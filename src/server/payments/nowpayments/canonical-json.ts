import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_CANONICAL_JSON_DEPTH = 32;
const MAX_CANONICAL_JSON_NODES = 5_000;

export class NowPaymentsPayloadComplexityError extends Error {
  constructor() {
    super("NOWPayments payload exceeds canonical JSON complexity limits.");
    this.name = "NowPaymentsPayloadComplexityError";
  }
}

function assertCanonicalJsonComplexity(value: unknown) {
  const stack: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    nodes += 1;
    if (
      nodes > MAX_CANONICAL_JSON_NODES ||
      current.depth > MAX_CANONICAL_JSON_DEPTH
    ) {
      throw new NowPaymentsPayloadComplexityError();
    }
    if (current.value === null || typeof current.value !== "object") continue;

    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    for (const child of children) {
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          sortJson((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

export function canonicalizeNowPaymentsPayload(payload: unknown) {
  assertCanonicalJsonComplexity(payload);
  return JSON.stringify(sortJson(payload));
}

export function signNowPaymentsPayload(payload: unknown, secret: string) {
  return createHmac("sha512", secret)
    .update(canonicalizeNowPaymentsPayload(payload), "utf8")
    .digest("hex");
}

export function verifyNowPaymentsSignature(
  payload: unknown,
  signature: string,
  secret: string,
) {
  if (!/^[a-f0-9]{128}$/iu.test(signature)) {
    return false;
  }
  const expected = Buffer.from(signNowPaymentsPayload(payload, secret), "hex");
  const received = Buffer.from(signature, "hex");
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
