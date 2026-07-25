import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

import pg from "pg";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const productsPath = join(root, "src/data/products.json");
const templatePath = join(root, "public/brand/flintmarrow-product-template.png");
const contactSheetPath = join(root, "output/flintmarrow-catalog-contact-sheet.jpg");
const catalogProducts = JSON.parse(await readFile(productsPath, "utf8"));

async function loadDatabaseProducts() {
  const envPath = join(root, ".env");
  if (!process.env.DATABASE_URL && existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
  if (!process.env.DATABASE_URL) return [];

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT DISTINCT ON (m.public_url)
        p.title AS name,
        p.subtitle AS presentation,
        m.public_url AS image
      FROM app.products p
      JOIN app.product_media pm
        ON pm.product_id = p.id
       AND pm.variant_id IS NULL
      JOIN app.media m ON m.id = pm.media_id
      WHERE p.deleted_at IS NULL
        AND m.deleted_at IS NULL
        AND m.public_url LIKE '/products/%'
      ORDER BY
        m.public_url,
        CASE WHEN p.status = 'active' THEN 0 ELSE 1 END,
        p.id
    `);
    return result.rows;
  } finally {
    await client.end();
  }
}

const productMap = new Map(catalogProducts.map((product) => [product.image, product]));
for (const product of await loadDatabaseProducts()) {
  if (!productMap.has(product.image)) productMap.set(product.image, product);
}
const products = [...productMap.values()];

// The source template was created with the built-in image generator and approved
// for the Flintmarrow catalog. Product names and strengths are rendered separately so
// every label remains exact while the photographic bottle, logo and visual system
// stay identical across the full catalog.
const generationSpec = {
  useCase: "product-mockup",
  assetType: "storefront catalog product image",
  scene: "single centered research vial on a white-to-cool-gray studio background",
  style: "clean premium product photography",
  brand: "Flintmarrow logo and wordmark in navy",
  palette: "white, cool gray, navy and cyan",
  invariant: "same bottle, cap, lighting, framing and label system for every product",
  footerText: "RESEARCH USE ONLY",
};

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function uppercaseDose(value) {
  return value.replace(/(mcg|mg|ml|iu)/giu, (unit) => unit.toUpperCase());
}

function splitLabel(name, presentation) {
  const finalDose = name.match(/\s(\d+(?:\.\d+)?(?:mcg|mg|ml|iu))$/iu)?.[1] ?? null;

  if (!/blend/iu.test(name)) {
    return finalDose
      ? { title: name.slice(0, -finalDose.length).trim(), dose: uppercaseDose(finalDose) }
      : { title: name, dose: "" };
  }

  const componentDoses = [...name.matchAll(/\d+(?:\.\d+)?(?:mcg|mg|ml|iu)/giu)].map(
    (match) => uppercaseDose(match[0]),
  );
  const totalDose = presentation?.match(/^(\d+(?:\.\d+)?(?:mcg|mg|ml|iu))/iu)?.[1] ?? null;
  let title = name;
  let dose = finalDose ? uppercaseDose(finalDose) : componentDoses.join(" + ");

  if (name.includes(" (")) {
    title = name.slice(0, name.indexOf(" ("));
  } else {
    title = name
      .replace(/\s\d+(?:\.\d+)?(?:mcg|mg|ml|iu)/giu, "")
      .replace(/\s*\+\s*(?=Blend)/giu, " ")
      .replace(/\s+/gu, " ")
      .trim();
  }

  if (!dose && totalDose) dose = uppercaseDose(totalDose);
  if (finalDose && componentDoses.length > 1 && !name.includes(" (")) {
    dose = componentDoses.slice(0, -1).join(" + ") || uppercaseDose(finalDose);
  }
  if (!finalDose && componentDoses.length > 1) dose = componentDoses.join(" + ");

  return { title, dose };
}

function wrapText(text) {
  const maxUnits = text.length > 42 ? 18 : text.length > 28 ? 20 : 24;
  const words = text.split(/\s+/u);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxUnits || line.length === 0) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function visualTextUnits(text) {
  return [...text].reduce((total, character) => {
    if (character === " ") return total + 0.32;
    if (/[MW@%&]/u.test(character)) return total + 0.9;
    if (/[mw]/u.test(character)) return total + 0.78;
    if (/[ilI1|]/u.test(character)) return total + 0.3;
    if (/[A-Z0-9]/u.test(character)) return total + 0.64;
    if (/[-+().,/]/u.test(character)) return total + 0.4;
    return total + 0.56;
  }, 0);
}

function fittedFontSize(text, preferredSize, minimumSize, safeWidth) {
  const measuredUnits = Math.max(visualTextUnits(text), 1);
  return Math.max(minimumSize, Math.min(preferredSize, Math.floor(safeWidth / measuredUnits)));
}

function labelSvg(product) {
  const { title, dose } = splitLabel(product.name, product.presentation);
  const lines = wrapText(title);
  const longest = Math.max(...lines.map((line) => line.length));
  const preferredTitleSize =
    lines.length === 1
      ? longest <= 11
        ? 46
        : longest <= 17
          ? 40
          : 34
      : lines.length === 2
        ? longest <= 17
          ? 32
          : 28
        : 24;
  const titleSize = Math.min(
    ...lines.map((line) =>
      fittedFontSize(line, preferredTitleSize, lines.length === 3 ? 20 : 22, 286),
    ),
  );
  const titleGap = titleSize * 1.05;
  const titleBlockHeight = (lines.length - 1) * titleGap;
  const titleCenterY = lines.length === 1 ? 659 : lines.length === 2 ? 655 : 651;
  const firstY = titleCenterY - titleBlockHeight / 2;
  const preferredDoseSize =
    dose.length > 22 ? 22 : dose.length > 15 ? 26 : dose.length > 9 ? 31 : 37;
  const doseSize = fittedFontSize(dose, preferredDoseSize, 20, 260);
  const doseLines =
    dose.length <= 8
      ? `<line x1="382" y1="738" x2="430" y2="738" stroke="#289eb4" stroke-width="2"/>` +
        `<line x1="594" y1="738" x2="642" y2="738" stroke="#15355d" stroke-width="2"/>`
      : "";
  const titleElements = lines
    .map(
      (line, index) =>
        `<text x="512" y="${Math.round(firstY + index * titleGap)}" text-anchor="middle" ` +
        `font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="${titleSize}" ` +
        `font-weight="700" fill="#15355d">${escapeXml(line)}</text>`,
    )
    .join("");

  return Buffer.from(`
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      <text x="512" y="578" text-anchor="middle"
        font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="39" font-weight="600" fill="#15355d">Flintmarrow</text>
      <line x1="410" y1="605" x2="614" y2="605" stroke="#289eb4" stroke-width="2"/>
      ${titleElements}
      ${
        dose
          ? doseLines +
            `<text x="512" y="749" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" ` +
            `font-size="${doseSize}" font-weight="700" fill="#2b9db4">${escapeXml(dose)}</text>` +
            ""
          : ""
      }
    </svg>
  `);
}

async function writeProductImage(template, product) {
  const outputPath = join(root, "public", product.image.replace(/^\//u, ""));
  await mkdir(dirname(outputPath), { recursive: true });
  const pipeline = sharp(template).composite([{ input: labelSvg(product) }]);
  const extension = extname(outputPath).toLowerCase();

  if (extension === ".webp") {
    await pipeline.webp({ quality: 90, effort: 5 }).toFile(outputPath);
  } else if (extension === ".png") {
    await pipeline.png({ compressionLevel: 9 }).toFile(outputPath);
  } else {
    await pipeline.jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true }).toFile(outputPath);
  }
}

const template = await sharp(templatePath)
  .resize(1024, 1024, { fit: "fill" })
  .jpeg({ quality: 96, chromaSubsampling: "4:4:4" })
  .toBuffer();

for (const product of products) {
  await writeProductImage(template, product);
}

const columns = 8;
const cellSize = 220;
const rows = Math.ceil(products.length / columns);
const sheet = sharp({
  create: {
    width: columns * cellSize,
    height: rows * cellSize,
    channels: 3,
    background: "#ffffff",
  },
});
const tiles = await Promise.all(
  products.map(async (product, index) => ({
    input: await sharp(join(root, "public", product.image.replace(/^\//u, "")))
      .resize(cellSize, cellSize, { fit: "contain", background: "#ffffff" })
      .toBuffer(),
    left: (index % columns) * cellSize,
    top: Math.floor(index / columns) * cellSize,
  })),
);

await mkdir(dirname(contactSheetPath), { recursive: true });
await sheet
  .composite(tiles)
  .jpeg({ quality: 82, chromaSubsampling: "4:4:4", mozjpeg: true })
  .toFile(contactSheetPath);

console.log(
  JSON.stringify(
    {
      generated: products.length,
      template: templatePath,
      contactSheet: contactSheetPath,
      generationSpec,
    },
    null,
    2,
  ),
);
