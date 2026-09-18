// Draws the Tasbih Counts logo, app icons and social card from one bead-ring mark.
// Run: node scripts/make-brand.mjs  (needs sharp, which Next already installs)
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";

const pub = new URL("../public/", import.meta.url);
const R = 9, BEAD = 1.5, ACCENT = 2.4;
const beads = Array.from({ length: 12 }, (_, i) => {
  const a = -Math.PI / 2 + ((i + 1) * Math.PI * 2) / 13;
  return [12 + R * Math.cos(a), 12 + R * Math.sin(a)];
});
const mark = (ink, warm, t = "") =>
  `<g${t ? ` transform="${t}"` : ""}>${beads
    .map(([x, y]) => `<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${BEAD}" fill="${ink}" opacity=".85"/>`)
    .join("")}<circle cx="12" cy="3" r="${ACCENT}" fill="${warm}"/></g>`;

const SERIF = "Literata, Georgia, 'Times New Roman', serif";
const logo = (ink, warm) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 158" width="720" height="158">
${mark(ink, warm, "translate(8 15) scale(5.3)")}
<text x="158" y="104" font-family="${SERIF}" font-size="74" font-weight="600" letter-spacing="-1.5" fill="${ink}">Tasbih<tspan fill="${warm}">Counts</tspan></text>
</svg>`;

mkdirSync(new URL("images/", pub), { recursive: true });

// App icon: full-bleed emerald so the maskable crop never shows a corner.
const icon = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">
<rect width="24" height="24" fill="#17705e"/>${mark("#faf8f4", "#f0b27a", "translate(4.2 4.2) scale(0.65)")}</svg>`;
const png = (svg, file, w, h) =>
  sharp(Buffer.from(svg), { density: 300 }).resize(w, h ?? w).png().toFile(new URL(file, pub).pathname.replace(/^\/(\w:)/, "$1"));

for (const s of [32, 180, 192, 512]) await png(icon(s), `icons/icon-${s}.png`, s);
await png(icon(180), "apple-touch-icon.png", 180);
await png(icon(512), "../src/app/icon.png", 512);

// favicon.ico: one 32px PNG inside an ICO container.
const p32 = await sharp(Buffer.from(icon(32)), { density: 300 }).resize(32, 32).png().toBuffer();
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head.writeUInt8(32, 6); head.writeUInt8(32, 7); head.writeUInt8(0, 8); head.writeUInt8(0, 9);
head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12); head.writeUInt32LE(p32.length, 14); head.writeUInt32LE(22, 18);
writeFileSync(new URL("favicon.ico", pub), Buffer.concat([head, p32]));

// The header lock-ups, as PNG so next/image serves them at header size.
await png(logo("#1b1a17", "#17705e"), "images/logo-light.png", 720, 158);
await png(logo("#f2efe8", "#57b598"), "images/logo-dark.png", 720, 158);

// Schema.org logo, and the social card.
await png(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 158" width="1200" height="263"><rect width="720" height="158" fill="#ffffff"/>${logo("#1b1a17", "#17705e").replace(/<\/?svg[^>]*>/g, "")}</svg>`, "images/tasbih-counts-logo.png", 1200, 263);
await png(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="#faf8f4"/>
<circle cx="600" cy="250" r="230" fill="#17705e" opacity=".07"/>
${mark("#1b1a17", "#b9713a", "translate(480 90) scale(10)")}
<text x="600" y="440" text-anchor="middle" font-family="${SERIF}" font-size="84" font-weight="600" letter-spacing="-2" fill="#1b1a17">Tasbih<tspan fill="#17705e">Counts</tspan></text>
<text x="600" y="510" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="34" fill="#57514a">Free online tasbih &amp; dhikr counter · works offline</text>
</svg>`, "images/tasbih-counts-social.png", 1200, 630);
console.log("brand assets written");
