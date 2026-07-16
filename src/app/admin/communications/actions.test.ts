import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateStatus: vi.fn(),
  assignInquiry: vi.fn(),
  addNote: vi.fn(),
  createFollowUp: vi.fn(),
  revalidatePath: vi.fn(),
  logUnexpected: vi.fn(),
  unstableRethrow: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  unstable_rethrow: mocks.unstableRethrow,
}));
vi.mock("@/server/admin/communications/mutations", () => ({
  updateAdminInquiryStatus: mocks.updateStatus,
  assignAdminInquiry: mocks.assignInquiry,
  addAdminInquiryNote: mocks.addNote,
  createAdminInquiryFromWhatsAppIntent: mocks.createFollowUp,
}));
vi.mock("@/server/admin/audit/action-state", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/admin/audit/action-state")
  >();
  return { ...actual, logUnexpectedAdminActionError: mocks.logUnexpected };
});

import {
  addInquiryNoteAction,
  assignInquiryAction,
  createWhatsAppFollowUpAction,
  updateInquiryStatusAction,
} from "@/app/admin/communications/actions";
import { INITIAL_ADMIN_ACTION_STATE } from "@/server/admin/audit/action-state";

const INQUIRY_ID = "86072a52-40ec-4be1-aa4e-e5073f19e049";
const INTENT_ID = "212e4379-e904-4599-9d83-0fa49394fbbc";

function form(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

describe("communications action commit and refresh semantics", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  const scenarios = [
    {
      name: "inquiry status update",
      action: updateInquiryStatusAction,
      mutation: mocks.updateStatus,
      form: () =>
        form({
          inquiryPublicId: INQUIRY_ID,
          status: "IN_PROGRESS",
          expectedUpdatedAt: "2026-07-13T12:00:00Z",
        }),
      result: {
        ok: true,
        inquiryPublicId: INQUIRY_ID,
        inquiryNumber: "INQ-1001",
        unchanged: false,
      },
      scope: "communications.inquiry.status.cache-refresh",
    },
    {
      name: "inquiry assignment",
      action: assignInquiryAction,
      mutation: mocks.assignInquiry,
      form: () =>
        form({
          inquiryPublicId: INQUIRY_ID,
          assignedToUserId: "",
          expectedUpdatedAt: "2026-07-13T12:00:00Z",
        }),
      result: {
        ok: true,
        inquiryPublicId: INQUIRY_ID,
        inquiryNumber: "INQ-1001",
        unchanged: false,
        assigneeName: null,
      },
      scope: "communications.inquiry.assign.cache-refresh",
    },
    {
      name: "internal note",
      action: addInquiryNoteAction,
      mutation: mocks.addNote,
      form: () =>
        form({
          inquiryPublicId: INQUIRY_ID,
          body: "Customer requested an availability follow-up.",
        }),
      result: {
        ok: true,
        inquiryPublicId: INQUIRY_ID,
        inquiryNumber: "INQ-1001",
      },
      scope: "communications.inquiry.note.cache-refresh",
    },
    {
      name: "WhatsApp follow-up inquiry",
      action: createWhatsAppFollowUpAction,
      mutation: mocks.createFollowUp,
      form: () => form({ intentPublicId: INTENT_ID }),
      result: {
        ok: true,
        inquiryPublicId: INQUIRY_ID,
        inquiryNumber: "INQ-1001",
        duplicate: false,
      },
      scope: "communications.whatsapp_follow_up.create.cache-refresh",
    },
  ];

  for (const scenario of scenarios) {
    it(`keeps a committed ${scenario.name} successful and continues refreshes`, async () => {
      const firstError = new Error("communications list cache unavailable");
      const secondError = new Error("dashboard cache unavailable");
      scenario.mutation.mockResolvedValue(scenario.result);
      mocks.revalidatePath
        .mockImplementationOnce(() => {
          throw firstError;
        })
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => {
          throw secondError;
        });

      const state = await scenario.action(
        INITIAL_ADMIN_ACTION_STATE,
        scenario.form(),
      );

      expect(state).toMatchObject({ status: "success", refreshPending: true });
      expect(state.message).toContain("database operation is committed");
      expect(state.message).toContain("page refreshes may be delayed");
      expect(state.message).toContain("Do not resubmit this form");
      expect(scenario.mutation).toHaveBeenCalledTimes(1);
      expect(mocks.revalidatePath).toHaveBeenCalledTimes(3);
      expect(mocks.logUnexpected).toHaveBeenNthCalledWith(
        1,
        scenario.scope,
        firstError,
      );
      expect(mocks.logUnexpected).toHaveBeenNthCalledWith(
        2,
        scenario.scope,
        secondError,
      );
      const paths = mocks.revalidatePath.mock.calls.map(([path]) =>
        String(path),
      );
      expect(new Set(paths).size).toBe(paths.length);
    });
  }

  it("preserves a business failure without attempting refresh", async () => {
    mocks.updateStatus.mockResolvedValue({
      ok: false,
      reason: "invalid_transition",
    });

    const state = await updateInquiryStatusAction(
      INITIAL_ADMIN_ACTION_STATE,
      scenarios[0].form(),
    );

    expect(state.status).toBe("error");
    expect(state.message).toContain("status transition is not allowed");
    expect(mocks.updateStatus).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a failure for a genuine mutation error without attempting refresh", async () => {
    const mutationError = new Error("database unavailable");
    mocks.updateStatus.mockRejectedValue(mutationError);

    const state = await updateInquiryStatusAction(
      INITIAL_ADMIN_ACTION_STATE,
      scenarios[0].form(),
    );

    expect(state.status).toBe("error");
    expect(state.message).toContain("could not be saved");
    expect(mocks.updateStatus).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.logUnexpected).toHaveBeenCalledWith(
      "communications.inquiry.status",
      mutationError,
    );
  });

  it("rethrows framework control flow raised during refresh", async () => {
    const controlFlowError = new Error("NEXT_REDIRECT");
    mocks.updateStatus.mockResolvedValue(scenarios[0].result);
    mocks.revalidatePath.mockImplementationOnce(() => {
      throw controlFlowError;
    });
    mocks.unstableRethrow.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(
      updateInquiryStatusAction(
        INITIAL_ADMIN_ACTION_STATE,
        scenarios[0].form(),
      ),
    ).rejects.toBe(controlFlowError);

    expect(mocks.updateStatus).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.logUnexpected).not.toHaveBeenCalled();
  });
});
