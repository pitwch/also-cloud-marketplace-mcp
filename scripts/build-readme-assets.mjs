import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const assets = path.join(root, "docs", "assets");
const alsoSource = path.join(assets, "also-logo-source.png");
const alsoLogo = path.join(assets, "also-logo.png");

/** Keep ALSO wordmark clean: drop only the low-contrast tagline, no recoloring. */
async function extractAlsoLogo() {
  const meta = await sharp(alsoSource).metadata();
  const { data, info } = await sharp(alsoSource)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let maxX = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const lum = (r + g + b) / 3;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (a > 200 && (sat > 40 || lum > 90)) maxX = Math.max(maxX, x);
    }
  }

  const width = Math.min(meta.width, maxX + 12);
  await sharp(alsoSource)
    .extract({ left: 0, top: 0, width, height: meta.height })
    .trim({ threshold: 8 })
    .png()
    .toFile(alsoLogo);
}

async function buildIcon() {
  await sharp(path.join(assets, "icon.svg")).resize(512, 512).png().toFile(path.join(assets, "icon.png"));
}

async function buildBanner() {
  const width = 1600;
  const height = 480;

  const also = await sharp(alsoLogo)
    .resize({ height: 150, fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });

  const logoLeft = 80;
  const logoTop = Math.round((height - also.info.height) / 2);
  const textLeft = logoLeft + also.info.width + 64;

  const svg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#0A0A0A"/>
  <line x1="${textLeft - 32}" y1="150" x2="${textLeft - 32}" y2="330" stroke="#3A3A3A" stroke-width="2"/>
  <text x="${textLeft}" y="215" fill="#FFFFFF" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="64" font-weight="700">MCP Server</text>
  <text x="${textLeft}" y="280" fill="#E8E8E8" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="34" font-weight="500">for ALSO Cloud Marketplace</text>
</svg>`);

  const base = await sharp(svg).png().toBuffer();
  await sharp(base)
    .composite([{ input: also.data, left: logoLeft, top: logoTop }])
    .png()
    .toFile(path.join(assets, "banner.png"));
}

await extractAlsoLogo();
await buildIcon();
await buildBanner();
console.log("OK — banner (ALSO logo + MCP Server text), icon (MCP mark)");
