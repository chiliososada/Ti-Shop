import { describe, expect, it, vi } from "vitest";

import {
  isRetryableTransactionError,
  withSerializableRetry,
} from "@/server/orders/retry";

describe("serializable transaction retries", () => {
  it.each([
    { code: "P2034" },
    { code: "40001" },
    { meta: { database_error: { code: "40P01" } } },
    {
      code: "P2010",
      meta: {
        driverAdapterError: { cause: { code: "40001" } },
      },
    },
    { cause: { code: "P2002" } },
  ])("recognizes retryable database conflicts", (error) => {
    expect(isRetryableTransactionError(error)).toBe(true);
  });

  it("retries a serialization failure and returns the committed result", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ code: "40001" })
      .mockResolvedValue("committed");

    await expect(withSerializableRetry(operation)).resolves.toBe("committed");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry a business or validation failure", async () => {
    const failure = new Error("out of stock");
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(failure);

    await expect(withSerializableRetry(operation)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
