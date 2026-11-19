import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const assets = path.join(root, "docs", "assets");

// GitHub Open Graph / social preview (recommended 1280×640)
const WIDTH = 1280;
const HEIGHT = 640;
const MARGIN = 80; // ~40pt+ safe crop margin

async function build() {
  const also = await sharp(path.join(assets, "also-logo.png"))
    .resize({ height: 120, fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });

  const alsoLeft = Math.round((WIDTH - also.info.width) / 2);
  const alsoTop = MARGIN + 70;

  const svg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#0A0A0A"/>

  <text x="640" y="360" text-anchor="middle"
        fill="#FFFFFF"
        font-family="Segoe UI, Helvetica Neue, Arial, sans-serif"
        font-size="52" font-weight="700">MCP Server for ALSO Cloud Marketplace</text>

  <text x="640" y="430" text-anchor="middle"
        fill="#C0C0C0"
        font-family="Segoe UI, Helvetica Neue, Arial, sans-serif"
        font-size="24" font-weight="400">Full automation and support — directly from the developer</text>

  <text x="640" y="${HEIGHT - MARGIN - 12}" text-anchor="middle"
        fill="#666666"
        font-family="Segoe UI, Helvetica Neue, Arial, sans-serif"
        font-size="18" font-weight="400">Pedrett IT+Web AG · www.pitw.ch</text>
</svg>`);

  const base = await sharp(svg).png().toBuffer();

  await sharp(base)
    .composite([{ input: also.data, left: alsoLeft, top: alsoTop }])
    .png()
    .toFile(path.join(assets, "social-preview.png"));

  console.log(`Wrote docs/assets/social-preview.png (${WIDTH}x${HEIGHT})`);
}

await build();
