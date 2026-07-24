import { mkdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const productsPath = join(root, "src/data/products.json");
const templatePath = join(root, "public/brand/veripep-product-template.png");
const contactSheetPath = join(root, "output/flintmarrow-catalog-contact-sheet.jpg");
const products = JSON.parse(await readFile(productsPath, "utf8"));

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

function labelSvg(product) {
  const { title, dose } = splitLabel(product.name, product.presentation);
  const lines = wrapText(title);
  const longest = Math.max(...lines.map((line) => line.length));
  const titleSize =
    lines.length === 1
      ? longest <= 11
        ? 62
        : longest <= 17
          ? 48
          : 38
      : lines.length === 2
        ? longest <= 17
          ? 37
          : 31
        : 27;
  const titleGap = titleSize * 1.05;
  const titleBlockHeight = (lines.length - 1) * titleGap;
  const titleCenterY = lines.length === 1 ? 653 : lines.length === 2 ? 649 : 646;
  const firstY = titleCenterY - titleBlockHeight / 2;
  const doseSize = dose.length > 22 ? 25 : dose.length > 15 ? 30 : dose.length > 9 ? 36 : 45;
  const doseLines =
    dose.length <= 8
      ? `<line x1="360" y1="735" x2="411" y2="735" stroke="#289eb4" stroke-width="2"/>` +
        `<line x1="613" y1="735" x2="664" y2="735" stroke="#15355d" stroke-width="2"/>`
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
      <defs>
        <linearGradient id="paper" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#f7f7f7"/>
          <stop offset="0.52" stop-color="#f4f4f4"/>
          <stop offset="1" stop-color="#ededee"/>
        </linearGradient>
      </defs>
      <rect x="336" y="601" width="352" height="171" fill="url(#paper)"/>
      ${titleElements}
      ${
        dose
          ? doseLines +
            `<text x="512" y="748" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" ` +
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
