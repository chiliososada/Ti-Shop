import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  addInquiryNoteSchema,
  assignInquirySchema,
  createWhatsAppFollowUpSchema,
  updateInquiryStatusSchema,
} from "@/server/admin/communications/validators";

describe("communication validators", () => {
  const inquiryPublicId = randomUUID();
  const expectedUpdatedAt = "2026-07-13T12:00:00.000Z";

  it("parses status changes with a concurrency version", () => {
    const parsed = updateInquiryStatusSchema.parse({
      inquiryPublicId,
      status: "IN_PROGRESS",
      expectedUpdatedAt,
    });
    expect(parsed.expectedUpdatedAt).toEqual(new Date(expectedUpdatedAt));
    expect(
      updateInquiryStatusSchema.safeParse({
        inquiryPublicId,
        status: "INVALID",
        expectedUpdatedAt,
      }).success,
    ).toBe(false);
  });

  it("supports unassignment while rejecting malformed administrator ids", () => {
    expect(
      assignInquirySchema.parse({
        inquiryPublicId,
        assignedToUserId: "",
        expectedUpdatedAt,
      }).assignedToUserId,
    ).toBeNull();
    expect(
      assignInquirySchema.safeParse({
        inquiryPublicId,
        assignedToUserId: "not-an-id",
        expectedUpdatedAt,
      }).success,
    ).toBe(false);
  });

  it("allows ordinary note whitespace but blocks hidden control bytes", () => {
    expect(
      addInquiryNoteSchema.parse({
        inquiryPublicId,
        body: "First line\nSecond line\twith tab",
      }).body,
    ).toContain("Second line");
    expect(
      addInquiryNoteSchema.safeParse({
        inquiryPublicId,
        body: "unsafe\u0000value",
      }).success,
    ).toBe(false);
  });

  it("accepts only a public UUID for WhatsApp follow-up creation", () => {
    expect(
      createWhatsAppFollowUpSchema.parse({ intentPublicId: randomUUID() }),
    ).toBeTruthy();
    expect(
      createWhatsAppFollowUpSchema.safeParse({
        intentPublicId: randomUUID(),
        customerMessage: "not allowed",
      }).success,
    ).toBe(false);
  });
});
