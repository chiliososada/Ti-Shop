import { describe, expect, it } from "vitest";

import {
  buildRedirectDestination,
  createsRedirectCycle,
  isRedirectablePublicPath,
  isSafeRootRelativePath,
} from "@/server/seo/redirect-policy";

describe("redirect policy", () => {
  it("rejects external, normalized, encoded-control, and private source paths", () => {
    expect(isSafeRootRelativePath("/old-page")).toBe(true);
    for (const path of [
      "https://evil.example/path",
      "//evil.example/path",
      "/a/../b",
      "/line%0Abreak",
      "/back\\slash",
      "/query?x=1",
    ]) {
      expect(isSafeRootRelativePath(path)).toBe(false);
    }

    for (const path of [
      "/admin",
      "/api/orders",
      "/account/orders",
      "/checkout",
      "/static/file",
      "/image.png",
    ]) {
      expect(isRedirectablePublicPath(path)).toBe(false);
    }
    expect(isRedirectablePublicPath("/legacy-product")).toBe(true);
  });

  it("detects direct and multi-hop cycles while allowing an acyclic chain", () => {
    const graph = [
      { publicId: "a", sourcePath: "/a", destinationPath: "/b" },
      { publicId: "b", sourcePath: "/b", destinationPath: "/c" },
    ];
    expect(createsRedirectCycle("/c", "/a", graph)).toBe(true);
    expect(createsRedirectCycle("/new", "/a", graph)).toBe(false);
    expect(createsRedirectCycle("/same", "/same", [])).toBe(true);
    expect(createsRedirectCycle("/b", "/done", graph, "b")).toBe(false);
  });

  it("preserves or clears the incoming query without changing origin", () => {
    expect(
      buildRedirectDestination(
        "https://store.example/old?utm_source=test&item=1",
        "/new",
        true,
        "https://store.example",
      ).toString(),
    ).toBe("https://store.example/new?utm_source=test&item=1");
    expect(
      buildRedirectDestination(
        "https://store.example/old?utm_source=test",
        "/new",
        false,
        "https://store.example",
      ).toString(),
    ).toBe("https://store.example/new");
  });

  it("uses the configured trusted origin even when the request Host is hostile", () => {
    expect(
      buildRedirectDestination(
        "https://evil.example/legacy?campaign=1",
        "/products",
        true,
        "https://store.example",
      ).toString(),
    ).toBe("https://store.example/products?campaign=1");
  });
});
