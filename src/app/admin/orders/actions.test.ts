import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reviewManualPayment: vi.fn(),
  recordManualPaymentRefund: vi.fn(),
  linkNowPaymentsProviderPayment: vi.fn(),
  cancelUnlinkedNowPaymentsPayment: vi.fn(),
  revalidatePath: vi.fn(),
  logUnexpected: vi.fn(),
  unstableRethrow: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("next/navigation", () => ({
  unstable_rethrow: mocks.unstableRethrow,
}));
vi.mock("@/server/admin/orders/mutations", () => ({
  reviewAdminManualPayment: mocks.reviewManualPayment,
  recordAdminManualPaymentRefund: mocks.recordManualPaymentRefund,
}));
vi.mock("@/server/admin/orders/nowpayments-review", () => ({
  linkAdminNowPaymentsProviderPayment:
    mocks.linkNowPaymentsProviderPayment,
  cancelAdminUnlinkedNowPaymentsPayment:
    mocks.cancelUnlinkedNowPaymentsPayment,
}));
vi.mock("@/server/admin/audit/action-state", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/admin/audit/action-state")
  >();
  return {
    ...actual,
    logUnexpectedAdminActionError: mocks.logUnexpected,
  };
});

import {
  cancelUnlinkedNowPaymentsPaymentAction,
  linkNowPaymentsProviderPaymentAction,
  recordManualPaymentRefundAction,
  reviewManualPaymentAction,
} from "@/app/admin/orders/actions";
import { INITIAL_ADMIN_ACTION_STATE } from "@/server/admin/audit/action-state";

function form(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

describe("order and payment review action commit and refresh semantics", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  const paymentPublicId = randomUUID();
  const orderPublicId = randomUUID();
  const scenarios = [
    {
      name: "manual payment review",
      action: reviewManualPaymentAction,
      mutation: mocks.reviewManualPayment,
      form: () =>
        form({ paymentPublicId, decision: "CONFIRM" }),
      result: {
        ok: true,
        orderPublicId,
        orderNumber: "SO-10001",
        decision: "CONFIRM",
      },
      scope: "payments.manual.review.cache-refresh",
    },
    {
      name: "manual external refund",
      action: recordManualPaymentRefundAction,
      mutation: mocks.recordManualPaymentRefund,
      form: () =>
        form({
          paymentPublicId,
          refundReference: "WIRE-REF-100",
          note: "",
          confirmation: "CONFIRM_EXTERNAL_REFUND_COMPLETED",
        }),
      result: {
        ok: true,
        orderPublicId,
        orderNumber: "SO-10002",
        duplicate: false,
        hasPhysicalDispatch: false,
        inventoryRestoredQuantity: 1,
      },
      scope: "payments.manual.external-refund.cache-refresh",
    },
    {
      name: "NOWPayments provider link",
      action: linkNowPaymentsProviderPaymentAction,
      mutation: mocks.linkNowPaymentsProviderPayment,
      form: () =>
        form({ paymentPublicId, providerPaymentId: "provider_123" }),
      result: {
        ok: true,
        orderPublicId,
        orderNumber: "SO-10003",
        paymentStatus: "WAITING",
      },
      scope: "payments.nowpayments.link.cache-refresh",
    },
    {
      name: "unlinked NOWPayments cancellation",
      action: cancelUnlinkedNowPaymentsPaymentAction,
      mutation: mocks.cancelUnlinkedNowPaymentsPayment,
      form: () =>
        form({
          paymentPublicId,
          providerInvoiceId: "invoice_123",
          confirmation: "CONFIRM_NO_PROVIDER_PAYMENT",
        }),
      result: {
        ok: true,
        orderPublicId,
        orderNumber: "SO-10004",
        orderClosed: true,
      },
      scope: "payments.nowpayments.cancel-unlinked.cache-refresh",
    },
  ];

  for (const scenario of scenarios) {
    it(`keeps a committed ${scenario.name} successful and attempts every unique refresh`, async () => {
      const refreshError = new Error("cache backend unavailable");
      scenario.mutation.mockResolvedValue(scenario.result);
      mocks.revalidatePath
        .mockImplementationOnce(() => {
          throw refreshError;
        })
        .mockImplementation(() => undefined);

      const state = await scenario.action(
        INITIAL_ADMIN_ACTION_STATE,
        scenario.form(),
      );

      expect(state).toMatchObject({ status: "success", refreshPending: true });
      expect(state.message).toContain("database operation is committed");
      expect(state.message).toContain("page refreshes may be delayed");
      expect(state.message).toContain("Do not resubmit");
      expect(scenario.mutation).toHaveBeenCalledTimes(1);
      expect(mocks.unstableRethrow).toHaveBeenCalledWith(refreshError);
      expect(mocks.logUnexpected).toHaveBeenCalledWith(
        scenario.scope,
        refreshError,
      );
      const paths = mocks.revalidatePath.mock.calls.map(([path]) => String(path));
      expect(paths).toHaveLength(7);
      expect(new Set(paths).size).toBe(paths.length);
    });
  }

  it("preserves a business failure without attempting refresh", async () => {
    mocks.reviewManualPayment.mockResolvedValue({
      ok: false,
      reason: "not_reviewable",
    });

    const state = await reviewManualPaymentAction(
      INITIAL_ADMIN_ACTION_STATE,
      form({ paymentPublicId, decision: "CONFIRM" }),
    );

    expect(state.status).toBe("error");
    expect(mocks.reviewManualPayment).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rethrows a framework control-flow error raised during refresh", async () => {
    const controlFlowError = new Error("NEXT_REDIRECT");
    mocks.reviewManualPayment.mockResolvedValue(scenarios[0]?.result);
    mocks.revalidatePath.mockImplementationOnce(() => {
      throw controlFlowError;
    });
    mocks.unstableRethrow.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(
      reviewManualPaymentAction(
        INITIAL_ADMIN_ACTION_STATE,
        form({ paymentPublicId, decision: "CONFIRM" }),
      ),
    ).rejects.toBe(controlFlowError);

    expect(mocks.reviewManualPayment).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.logUnexpected).not.toHaveBeenCalled();
  });
});
