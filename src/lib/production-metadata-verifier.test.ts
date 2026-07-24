import { describe, expect, it } from "vitest";

import {
  inspectProductionMetadata,
  productionMetadataFailures,
} from "../../scripts/verify-production-metadata.mjs";

describe("production metadata verifier", () => {
  it("accepts equivalent page and Open Graph metadata and decodes entities", () => {
    const html = `
      <title>Products &amp; Documents | Flintmarrow</title>
      <meta content="Current products &amp; documents." name="description">
      <link href="https://example.test/products" rel="canonical">
      <meta content="Products &amp; Documents | Flintmarrow" property="og:title">
      <meta property="og:description" content="Current products &amp; documents.">
      <meta content="https://example.test/products" property="og:url">
    `;

    expect(inspectProductionMetadata(html)).toEqual({
      title: "Products & Documents | Flintmarrow",
      description: "Current products & documents.",
      canonical: "https://example.test/products",
      openGraphTitle: "Products & Documents | Flintmarrow",
      openGraphDescription: "Current products & documents.",
      openGraphUrl: "https://example.test/products",
    });
    expect(
      productionMetadataFailures(html, "https://example.test/products"),
    ).toEqual([]);
  });

  it("detects home-page Open Graph values inherited by another route", () => {
    const html = `
      <title>Shipping Policy | Flintmarrow</title>
      <meta name="description" content="Shipping details.">
      <link rel="canonical" href="https://example.test/shipping">
      <meta property="og:title" content="Flintmarrow | Home">
      <meta property="og:description" content="Home description.">
      <meta property="og:url" content="https://example.test/">
    `;

    expect(
      productionMetadataFailures(html, "https://example.test/shipping"),
    ).toEqual([
      "og:title does not match title",
      "og:description does not match description",
      "og:url does not match canonical",
    ]);
  });

  it("reports every required field that is absent", () => {
    expect(
      productionMetadataFailures("<html><head></head></html>", "https://example.test/"),
    ).toEqual([
      "missing title",
      "missing description",
      "missing canonical",
      "missing og:title",
      "missing og:description",
      "missing og:url",
    ]);
  });
});
