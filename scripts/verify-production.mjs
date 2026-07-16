import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { productionMetadataFailures } from "./verify-production-metadata.mjs";

const port = Number.parseInt(process.env.SEO_TEST_PORT ?? "3100", 10);
const baseUrl = `http://127.0.0.1:${port}`;
const publicOrigin = new URL(process.env.SITE_URL ?? baseUrl).origin;
const serverPath = fileURLToPath(
  new URL("../.next/standalone/server.js", import.meta.url),
);

const server = spawn(process.execPath, [serverPath], {
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-8_000);
  });
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Production server exited early.\n${serverOutput}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The listener may not be ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Production server did not become ready.\n${serverOutput}`);
}

function isNoIndex(html) {
  return /<meta[^>]+name="robots"[^>]+content="[^"]*noindex|<meta[^>]+content="[^"]*noindex[^>]+name="robots"/i.test(
    html,
  );
}

async function verifyProduction() {
  const sitemapResponse = await fetch(`${baseUrl}/sitemap.xml`);
  if (!sitemapResponse.ok) {
    throw new Error(`sitemap.xml returned ${sitemapResponse.status}`);
  }

  const sitemap = await sitemapResponse.text();
  const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(
    (match) => match[1],
  );
  const failures = [];
  const requiredStaticPaths = [
    "/",
    "/products",
    "/about",
    "/blog",
    "/faq",
    "/contact",
    "/shipping",
    "/returns",
    "/privacy",
    "/terms",
    "/payment-policy",
    "/research-use",
  ];
  const sitemapUrlSet = new Set(urls);

  if (urls.length !== sitemapUrlSet.size) {
    failures.push("sitemap contains duplicate canonical URLs");
  }
  for (const path of requiredStaticPaths) {
    if (!sitemapUrlSet.has(new URL(path, publicOrigin).toString())) {
      failures.push(`${path}: required static URL missing from sitemap`);
    }
  }
  if (urls.some((url) => new URL(url).origin !== publicOrigin)) {
    failures.push("sitemap contains a canonical URL from another origin");
  }

  if (
    urls.some((url) =>
      /\/(?:admin|account|login|register|checkout|api)(?:\/|$)/i.test(
        new URL(url).pathname,
      ),
    )
  ) {
    failures.push("sitemap contains a private or non-indexable route");
  }

  for (const canonicalUrl of urls) {
    const expected = new URL(canonicalUrl);
    const response = await fetch(
      `${baseUrl}${expected.pathname}${expected.search}`,
      { redirect: "manual" },
    );
    const html = await response.text();

    if (response.status !== 200) {
      failures.push(`${expected.pathname}: HTTP ${response.status}`);
    }
    for (const failure of productionMetadataFailures(html, expected.href)) {
      failures.push(`${expected.pathname}: ${failure}`);
    }
    if (isNoIndex(html)) {
      failures.push(`${expected.pathname}: unexpected noindex`);
    }
    if (response.headers.has("set-cookie")) {
      failures.push(`${expected.pathname}: public response set an auth cookie`);
    }
    if (response.headers.has("x-powered-by")) {
      failures.push(`${expected.pathname}: framework disclosure header is present`);
    }
  }

  const rootResponse = await fetch(baseUrl);
  const rootHtml = await rootResponse.text();
  if (
    !rootHtml.includes('"@type":"WebSite"') ||
    !rootHtml.includes(`"@id":"${publicOrigin}/#website"`)
  ) {
    failures.push("root page is missing the WebSite JSON-LD graph node");
  }
  if (rootHtml.includes('"SearchAction"')) {
    failures.push("root page claims an unimplemented SearchAction");
  }

  for (const path of ["/account", "/admin"]) {
    const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
    if (response.status !== 307 || !response.headers.get("location")?.startsWith("/login")) {
      failures.push(`${path}: unauthenticated boundary failed`);
    }
  }

  const unauthenticatedCheckout = await fetch(`${baseUrl}/api/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: publicOrigin,
    },
    body: "{}",
  });
  const checkoutBody = await unauthenticatedCheckout.json();
  if (
    unauthenticatedCheckout.status !== 401 ||
    checkoutBody.code !== "AUTH_REQUIRED" ||
    unauthenticatedCheckout.headers.get("cache-control") !== "no-store"
  ) {
    failures.push("unauthenticated checkout boundary did not fail closed");
  }

  const legacyCheckout = await fetch(`${baseUrl}/checkout/success`);
  const legacyHtml = await legacyCheckout.text();
  if (!isNoIndex(legacyHtml)) {
    failures.push("legacy checkout page is indexable");
  }
  if (
    /payment (?:was|is) (?:successful|received)|thank you for your order/i.test(
      legacyHtml,
    )
  ) {
    failures.push("legacy checkout page makes an unverified success claim");
  }

  for (const path of [
    "/products/not-a-product",
    "/categories/not-a-category",
    "/blog/not-a-post",
    "/not-a-page",
  ]) {
    const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
    if (response.status !== 404) failures.push(`${path}: expected 404`);
  }

  if (failures.length) {
    throw new Error(failures.join("\n"));
  }

  console.info(`Validated ${urls.length} public URLs and private route boundaries.`);
}

try {
  await waitUntilReady();
  await verifyProduction();
} finally {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      once(server, "exit"),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
}
