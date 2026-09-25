import { mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  markSvg,
  markMonoSvg,
  markFace,
  bodyClip,
  markSize,
} from "../src/brand/mark.js";
import {
  hex,
  brandTokensCss,
  fontSans,
  fontMono,
} from "../src/brand/tokens.js";
import { claimType, sensType, taglineType } from "../src/brand/wordmark.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "assets");
const png = path.join(assets, "png");
const appIcons = path.join(root, "rust", "sens-app", "icons");
const appIconSource = path.join(root, "src", "brand", "app-icon.png");

const markPngSizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const monoPngSizes = [128, 256, 512, 1024];
const icoSizes = [256, 16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128];
const crispUpTo = 64;
const appIconFiles: [string, number][] = [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["256x256.png", 256],
  ["icon.png", 512],
];

const written: string[] = [];

function write(file: string, contents: string | Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
  written.push(path.relative(root, file).replace(/\\/g, "/"));
}

async function rasterize(svg: string, size: number): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 512 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function appIcon(size: number): Promise<Buffer> {
  const resized = sharp(appIconSource).resize(size, size, {
    kernel: "lanczos3",
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  return (size <= crispUpTo ? resized.sharpen({ sigma: 0.5 }) : resized)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function icoFrom(entries: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;

  entries.forEach((entry, index) => {
    const at = index * 16;
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    directory.writeUInt8(0, at + 2);
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(entry.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, directory, ...entries.map((e) => e.data)]);
}

function wordmarkSvg(): string {
  const gap = 15;
  const type = 78;
  const width = markSize + gap + type;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${markSize}" viewBox="0 0 ${width} ${markSize}" role="img" aria-label="sens">`,
    `<defs>${bodyClip("sens-wordmark-body")}</defs>`,
    `<g clip-path="url(#sens-wordmark-body)">`,
    markFace(),
    `</g>`,
    sensType(markSize + gap, 35, 34, hex("carbon-950")),
    `</svg>`,
  ].join("");
}

function bannerSvg(): string {
  const w = 1200;
  const h = 340;
  const markScale = 88 / markSize;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="sens — understand more, read less">`,
    `<defs>${bodyClip("sens-banner-body")}</defs>`,
    `<rect width="${w}" height="${h}" rx="20" fill="${hex("carbon-950")}"/>`,
    `<g clip-path="url(#sens-banner-body)" transform="translate(96 90) scale(${markScale})">`,
    markFace(hex("carbon-800")),
    `</g>`,
    sensType(212, 156, 62, hex("bone-50")),
    taglineType(212, 200, 26, hex("alloy-400")),
    `<rect x="96" y="252" width="1008" height="1" fill="${hex("carbon-700")}"/>`,
    claimType(96, 292, 19, hex("alloy-500")),
    `</svg>`,
  ].join("");
}

function previewSvgSheet(): string {
  const sample = (label: string, svg: string) =>
    `<figure>${svg}<figcaption>${label}</figcaption></figure>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>sens — the cut</title><style>
${brandTokensCss()}
body { margin: 0; padding: 48px; background: var(--sens-bg); color: var(--sens-text); font-family: ${fontSans}; }
h1 { font-size: 32px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 4px; }
p.lede { color: var(--sens-text-muted); margin: 0 0 40px; font-size: 15px; }
h2 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--sens-text-muted); margin: 0 0 12px; }
section { margin-bottom: 32px; }
.row { display: flex; align-items: flex-end; gap: 32px; flex-wrap: wrap; padding: 28px; border: 1px solid var(--sens-border); border-radius: 12px; background: var(--sens-surface); }
.row.dark { background: var(--sens-carbon-950); border-color: var(--sens-carbon-700); }
.row.bone { background: var(--sens-bone-50); border-color: var(--sens-bone-200); }
figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; }
figcaption { font-size: 11px; color: var(--sens-text-muted); font-family: ${fontMono}; }
.row.dark figcaption { color: var(--sens-alloy-400); }
</style></head><body>
<h1>the cut</h1><p class="lede">one compact carbon body, one precise S-shaped incision.</p>
<section><h2>primary on bone</h2><div class="row bone">${[160, 96, 64, 48, 32, 24].map((s) => sample(`${s} px`, markSvg({ size: s, id: `p${s}` }))).join("")}</div></section>
<section><h2>micro cut · 16–24 px</h2><div class="row">${[32, 24, 16].map((s) => sample(`${s} px`, markSvg({ size: s, micro: true, id: `m${s}` }))).join("")}</div></section>
<section><h2>dark ui</h2><div class="row dark">${[160, 64, 32].map((s) => sample(`${s} px`, markSvg({ size: s, body: hex("carbon-800"), id: `d${s}` }))).join("")}</div></section>
<section><h2>one color · negative space</h2><div class="row">${[160, 64, 32, 16].map((s) => sample(`${s} px`, `<span style="color:${hex("carbon-950")}">${markMonoSvg({ size: s, id: `o${s}` })}</span>`)).join("")}</div></section>
<section><h2>one color inverted</h2><div class="row dark">${[160, 64, 32, 16].map((s) => sample(`${s} px`, `<span style="color:${hex("bone-50")}">${markMonoSvg({ size: s, id: `i${s}` })}</span>`)).join("")}</div></section>
<section><h2>wordmark</h2><div class="row">${wordmarkSvg()}</div></section>
<section><h2>banner</h2><div class="row" style="display:block">${bannerSvg().replace('width="1200" height="340"', 'width="100%"')}</div></section>
</body></html>`;
}

function clearStaleAssets(): void {
  for (const file of readdirSync(png)) {
    if (file.startsWith("sens-logo") || file.startsWith("sens-mark-blue") || file.startsWith("sens-mark-white")) {
      rmSync(path.join(png, file));
    }
  }
  rmSync(path.join(assets, "sens-logo.svg"), { force: true });
}

async function main(): Promise<void> {
  const preview = process.argv[2];
  if (preview) {
    write(path.resolve(preview), previewSvgSheet());
    console.log(`preview  ${path.resolve(preview)}`);
    return;
  }

  mkdirSync(png, { recursive: true });
  clearStaleAssets();

  write(path.join(assets, "sens-mark.svg"), markSvg({ size: 128 }));
  write(path.join(assets, "sens-mark-micro.svg"), markSvg({ size: 24, micro: true, id: "sens-micro" }));
  write(path.join(assets, "sens-mark-mono.svg"), markMonoSvg({ size: 128 }));
  write(path.join(assets, "sens-wordmark.svg"), wordmarkSvg());
  write(path.join(root, "docs", "banner.svg"), bannerSvg());

  for (const size of markPngSizes) {
    const svg = markSvg({ size, micro: size <= 24, id: `s${size}` });
    write(path.join(png, `sens-mark-${size}.png`), await rasterize(svg, size));
  }

  for (const size of monoPngSizes) {
    write(
      path.join(png, `sens-mark-carbon-${size}.png`),
      await rasterize(markMonoSvg({ size, body: hex("carbon-950"), id: `c${size}` }), size),
    );
    write(
      path.join(png, `sens-mark-bone-${size}.png`),
      await rasterize(markMonoSvg({ size, body: hex("bone-50"), id: `b${size}` }), size),
    );
  }

  for (const [file, size] of appIconFiles) {
    write(path.join(appIcons, file), await appIcon(size));
  }

  const icoEntries = [];
  for (const size of icoSizes) {
    icoEntries.push({ size, data: await appIcon(size) });
  }
  write(path.join(appIcons, "icon.ico"), icoFrom(icoEntries));

  console.log(`brand assets · ${written.length} files`);
  for (const file of written) console.log(`  ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
