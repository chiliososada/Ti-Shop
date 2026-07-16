import type { InquiryStatus } from "@/generated/prisma/client";

const TRANSITIONS: Readonly<Record<InquiryStatus, readonly InquiryStatus[]>> = {
  OPEN: ["IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["WAITING_CUSTOMER", "RESOLVED", "CLOSED"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  RESOLVED: ["OPEN", "CLOSED"],
  CLOSED: ["OPEN"],
};

export function allowedInquiryTransitions(status: InquiryStatus) {
  return TRANSITIONS[status];
}

export function canTransitionInquiry(
  current: InquiryStatus,
  next: InquiryStatus,
) {
  return TRANSITIONS[current].includes(next);
}

export function inquiryLifecycleTimestampPatch(
  current: {
    resolvedAt: Date | null;
    closedAt: Date | null;
  },
  next: InquiryStatus,
  occurredAt: Date,
) {
  if (next === "RESOLVED") {
    return {
      resolvedAt: current.resolvedAt ?? occurredAt,
      closedAt: null,
    };
  }

  if (next === "CLOSED") {
    return {
      resolvedAt: current.resolvedAt,
      closedAt: current.closedAt ?? occurredAt,
    };
  }

  return {
    resolvedAt: null,
    closedAt: null,
  };
}
