import { describe, expect, it } from "vitest";

import {
  allowedInquiryTransitions,
  canTransitionInquiry,
  inquiryLifecycleTimestampPatch,
} from "@/server/admin/communications/lifecycle";

describe("inquiry lifecycle", () => {
  it("allows active work to advance without regressing to open", () => {
    expect(allowedInquiryTransitions("OPEN")).toEqual([
      "IN_PROGRESS",
      "WAITING_CUSTOMER",
      "RESOLVED",
      "CLOSED",
    ]);
    expect(canTransitionInquiry("IN_PROGRESS", "WAITING_CUSTOMER")).toBe(
      true,
    );
    expect(canTransitionInquiry("WAITING_CUSTOMER", "IN_PROGRESS")).toBe(
      true,
    );
    expect(canTransitionInquiry("IN_PROGRESS", "OPEN")).toBe(false);
    expect(canTransitionInquiry("OPEN", "OPEN")).toBe(false);
  });

  it("supports deliberate reopen and final closure transitions", () => {
    expect(canTransitionInquiry("RESOLVED", "OPEN")).toBe(true);
    expect(canTransitionInquiry("RESOLVED", "CLOSED")).toBe(true);
    expect(canTransitionInquiry("CLOSED", "OPEN")).toBe(true);
    expect(canTransitionInquiry("CLOSED", "IN_PROGRESS")).toBe(false);
  });

  it("sets, preserves, and clears lifecycle timestamps", () => {
    const resolvedAt = new Date("2026-07-13T01:00:00.000Z");
    const now = new Date("2026-07-13T02:00:00.000Z");

    expect(
      inquiryLifecycleTimestampPatch(
        { resolvedAt: null, closedAt: null },
        "RESOLVED",
        now,
      ),
    ).toEqual({ resolvedAt: now, closedAt: null });
    expect(
      inquiryLifecycleTimestampPatch(
        { resolvedAt, closedAt: null },
        "CLOSED",
        now,
      ),
    ).toEqual({ resolvedAt, closedAt: now });
    expect(
      inquiryLifecycleTimestampPatch(
        { resolvedAt, closedAt: now },
        "OPEN",
        now,
      ),
    ).toEqual({ resolvedAt: null, closedAt: null });
  });
});
