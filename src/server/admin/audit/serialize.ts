import type { Prisma } from "@/generated/prisma/client";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 20;
const MAX_VALUES = 5_000;

function serializeAuditValue(
  value: unknown,
  depth: number,
  state: { count: number },
): Prisma.InputJsonValue | null | undefined {
  state.count += 1;
  if (depth > MAX_DEPTH || state.count > MAX_VALUES) {
    throw new TypeError("Audit snapshot is too large.");
  }

  if (value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Audit snapshot contains a non-finite number.");
    }
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new TypeError("Audit snapshot contains an invalid date.");
    }
    return value.toISOString();
  }
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const result: Prisma.InputJsonValue[] = [];
    for (const item of value) {
      const serialized = serializeAuditValue(item, depth + 1, state);
      if (serialized !== undefined && serialized !== null) {
        result.push(serialized);
      } else if (serialized === null) {
        result.push(null as unknown as Prisma.InputJsonValue);
      }
    }
    return result;
  }
  if (typeof value !== "object") {
    throw new TypeError("Audit snapshot contains an unsupported value.");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Audit snapshot must contain plain objects.");
  }

  const result: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new TypeError("Audit snapshot contains an unsafe key.");
    }
    const serialized = serializeAuditValue(item, depth + 1, state);
    if (serialized !== undefined && serialized !== null) {
      result[key] = serialized;
    } else if (serialized === null) {
      result[key] = null as unknown as Prisma.InputJsonValue;
    }
  }
  return result;
}

export function toAuditJson(value: unknown): Prisma.InputJsonValue {
  const serialized = serializeAuditValue(value, 0, { count: 0 });
  if (serialized === undefined || serialized === null) {
    return { value: serialized === null ? null : "undefined" };
  }
  return serialized;
}
