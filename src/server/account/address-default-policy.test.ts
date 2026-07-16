import { describe, expect, it } from "vitest";

import {
  defaultsForCreatedAddress,
  defaultsToTransferAfterDelete,
} from "@/server/account/address-default-policy";

describe("customer address default policy", () => {
  it("makes the first active address the shipping and billing default", () => {
    expect(
      defaultsForCreatedAddress(0, {
        isDefaultShipping: false,
        isDefaultBilling: false,
      }),
    ).toEqual({ isDefaultShipping: true, isDefaultBilling: true });
  });

  it("respects explicit choices when another active address exists", () => {
    expect(
      defaultsForCreatedAddress(2, {
        isDefaultShipping: true,
        isDefaultBilling: false,
      }),
    ).toEqual({ isDefaultShipping: true, isDefaultBilling: false });
  });

  it("transfers only the default roles held by a removed address", () => {
    expect(
      defaultsToTransferAfterDelete({
        isDefaultShipping: false,
        isDefaultBilling: true,
      }),
    ).toEqual({ isDefaultShipping: false, isDefaultBilling: true });
  });
});
