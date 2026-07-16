import { describe, expect, it } from "vitest";

import { buildOwnedOrderWhere } from "@/server/orders/query-contracts";

describe("customer order authorization query", () => {
  it("always combines the opaque order public ID with session user ownership", () => {
    expect(
      buildOwnedOrderWhere(
        "ebef2a70-e1a0-4ce4-9917-119d29cc3c20",
        "969bb9a1-914b-4c92-8767-f72c70e8371b",
      ),
    ).toEqual({
      userId: "ebef2a70-e1a0-4ce4-9917-119d29cc3c20",
      publicId: "969bb9a1-914b-4c92-8767-f72c70e8371b",
    });
  });

  it("never treats an order number as an authorization selector", () => {
    expect(
      buildOwnedOrderWhere("ebef2a70-e1a0-4ce4-9917-119d29cc3c20"),
    ).toEqual({ userId: "ebef2a70-e1a0-4ce4-9917-119d29cc3c20" });
  });
});
