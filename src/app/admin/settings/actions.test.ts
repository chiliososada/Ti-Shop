import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateWhatsApp: vi.fn(),
  revalidatePath: vi.fn(),
  logUnexpected: vi.fn(),
  unstableRethrow: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  unstable_rethrow: mocks.unstableRethrow,
}));
vi.mock("@/server/admin/settings/whatsapp/mutations", () => ({
  updateAdminWhatsAppSettings: mocks.updateWhatsApp,
}));
vi.mock("@/server/admin/audit/action-state", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/admin/audit/action-state")
  >();
  return { ...actual, logUnexpectedAdminActionError: mocks.logUnexpected };
});

import { updateWhatsAppSettingsAction } from "@/app/admin/settings/actions";
import { INITIAL_ADMIN_ACTION_STATE } from "@/server/admin/audit/action-state";

function validWhatsAppForm() {
  const formData = new FormData();
  const entries = {
    configured: "on",
    phoneE164: "+12025550123",
    displayValue: "+1 202 555 0123",
    welcomeMessage: "How can we help?",
    businessHours: "Monday-Friday, 9:00-17:00 ET",
    templateGlobal: "Hello, I have a question.",
    templateProduct:
      "Product {{productName}} {{productSlug}} {{sku}} {{casNumber}} {{productUrl}}",
    templateCart: "Cart {{cartLines}} subtotal {{displayedSubtotal}}",
    templateOrder: "Order {{orderReference}}",
    templateContact: "Research {{category}} requirement {{requirement}}",
  };
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

describe("WhatsApp settings action commit and refresh semantics", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("keeps the committed mutation successful and continues refreshes", async () => {
    const refreshError = new Error("settings cache unavailable");
    mocks.updateWhatsApp.mockResolvedValue({ ok: true });
    mocks.revalidatePath
      .mockImplementationOnce(() => {
        throw refreshError;
      })
      .mockImplementationOnce(() => undefined);

    const state = await updateWhatsAppSettingsAction(
      INITIAL_ADMIN_ACTION_STATE,
      validWhatsAppForm(),
    );

    expect(state).toMatchObject({ status: "success", refreshPending: true });
    expect(state.message).toContain("database operation is committed");
    expect(state.message).toContain("page refreshes may be delayed");
    expect(state.message).toContain("Do not resubmit this form");
    expect(mocks.updateWhatsApp).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(
      1,
      "/admin/settings",
      undefined,
    );
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(2, "/", "layout");
    expect(mocks.logUnexpected).toHaveBeenCalledWith(
      "settings.whatsapp.update.cache-refresh",
      refreshError,
    );
  });

  it("preserves the missing-baseline business failure without refresh", async () => {
    mocks.updateWhatsApp.mockResolvedValue({ ok: false, reason: "not_found" });

    const state = await updateWhatsAppSettingsAction(
      INITIAL_ADMIN_ACTION_STATE,
      validWhatsAppForm(),
    );

    expect(state.status).toBe("error");
    expect(state.message).toContain("baseline WhatsApp setting is missing");
    expect(mocks.updateWhatsApp).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a failure when the settings mutation itself fails", async () => {
    const mutationError = new Error("database write failed");
    mocks.updateWhatsApp.mockRejectedValue(mutationError);

    const state = await updateWhatsAppSettingsAction(
      INITIAL_ADMIN_ACTION_STATE,
      validWhatsAppForm(),
    );

    expect(state.status).toBe("error");
    expect(state.message).toContain("could not be saved");
    expect(mocks.logUnexpected).toHaveBeenCalledWith(
      "settings.whatsapp.update",
      mutationError,
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rethrows framework control flow raised during refresh", async () => {
    const controlFlowError = new Error("NEXT_REDIRECT");
    mocks.updateWhatsApp.mockResolvedValue({ ok: true });
    mocks.revalidatePath.mockImplementationOnce(() => {
      throw controlFlowError;
    });
    mocks.unstableRethrow.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(
      updateWhatsAppSettingsAction(
        INITIAL_ADMIN_ACTION_STATE,
        validWhatsAppForm(),
      ),
    ).rejects.toBe(controlFlowError);

    expect(mocks.updateWhatsApp).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.logUnexpected).not.toHaveBeenCalled();
  });
});
