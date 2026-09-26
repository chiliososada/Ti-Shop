/**
 * Submit flintmarrow.com URLs to IndexNow (Bing, Yandex, Seznam, Naver…).
 * Google does not use IndexNow; use Search Console for Google.
 *
 *   npm run seo:indexnow                       # every page URL in the live sitemap
 *   npm run seo:indexnow -- /products/a /blog  # only these paths
 *   npm run seo:indexnow -- --dry-run          # print the payload, send nothing
 *
 * The key is the file name of public/<32 hex>.txt, which must be deployed
 * before submitting.
 */
import { readdir } from "node:fs/promises";

const origin = "https://flintmarrow.com";
const endpoints = ["https://api.indexnow.org/indexnow", "https://www.bing.com/indexnow"];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const paths = args.filter((arg) => !arg.startsWith("--"));

const keyFile = (await readdir("public")).find((name) => /^[0-9a-f]{32}\.txt$/u.test(name));
if (!keyFile) throw new Error("No IndexNow key file (public/<32 hex>.txt)");
const key = keyFile.slice(0, -4);
const keyLocation = `${origin}/${keyFile}`;

const served = await fetch(keyLocation);
if (!served.ok || (await served.text()).trim() !== key) {
  throw new Error(`${keyLocation} does not serve the key; deploy it first`);
}

async function sitemapUrls() {
  const response = await fetch(`${origin}/sitemap.xml`);
  if (!response.ok) throw new Error(`sitemap.xml returned ${response.status}`);
  const xml = await response.text();
  // <loc> only: <image:loc> entries are images, not pages.
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);
}

const urlList = paths.length
  ? paths.map((path) => new URL(path, origin).href)
  : await sitemapUrls();
const unique = [...new Set(urlList)];
if (!unique.length) throw new Error("No URLs to submit");
if (unique.length > 10_000) throw new Error("IndexNow accepts at most 10,000 URLs per request");
for (const url of unique) {
  if (new URL(url).origin !== origin) throw new Error(`${url} is not on ${origin}`);
}

const payload = { host: new URL(origin).host, key, keyLocation, urlList: unique };
if (dryRun) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

let failed = false;
for (const endpoint of endpoints) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  // 200 and 202 both mean accepted (202: key validation pending).
  const ok = response.status === 200 || response.status === 202;
  failed ||= !ok;
  console.log(`${endpoint}: ${response.status}${ok ? "" : ` ${await response.text()}`}`);
}
console.log(`${unique.length} URL(s) submitted.`);
process.exit(failed ? 1 : 0);
