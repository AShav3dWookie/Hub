/**
 * Rasterises client/assets/icon.svg into the PWA icon set under client/public/.
 * Run when the source SVG changes:  node client/scripts/gen-icons.mjs
 * (sharp comes from the server workspace — it's a shared devDependency of the repo.)
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(path.join(root, "assets", "icon.svg"));
const outDir = path.join(root, "public");
mkdirSync(outDir, { recursive: true });

const bg = { r: 15, g: 23, b: 42, alpha: 1 }; // #0f172a

async function png(name, size, { pad = 0 } = {}) {
  const inner = Math.round(size * (1 - pad));
  const logo = await sharp(svg).resize(inner, inner).png().toBuffer();
  const offset = Math.round((size - inner) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: logo, top: offset, left: offset }])
    .png()
    .toFile(path.join(outDir, name));
  console.log("wrote", name);
}

await png("pwa-192x192.png", 192);
await png("pwa-512x512.png", 512);
await png("pwa-maskable-512x512.png", 512, { pad: 0.2 }); // 10% safe margin each side + rounding
await png("apple-touch-icon.png", 180);

// favicon.ico — a 32px PNG renamed; browsers accept PNG data in .ico for modern use,
// but a real multi-size ICO is nicer. sharp can't write .ico, so ship a 32px png + link both.
await png("favicon-32x32.png", 32);
writeFileSync(path.join(outDir, "favicon.ico"), readFileSync(path.join(outDir, "favicon-32x32.png")));
console.log("wrote favicon.ico (32px png payload)");
