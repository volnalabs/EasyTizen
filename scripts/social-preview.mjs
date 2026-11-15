#!/usr/bin/env node
// Renders the repository cover (GitHub "Social preview", 1280×640) in Russian and English.
//
//   node scripts/screenshots.mjs        (first — the cover uses those real screenshots)
//   node scripts/social-preview.mjs     (needs Playwright with Chromium)
//
// Output: docs/readme/social-preview-ru.png and social-preview-en.png. The pictures on the cover
// are the real interface from docs/img/<lang>; colours and type follow docs/DESIGN-SYSTEM.md.
// Upload one of them in GitHub → Settings → General → Social preview.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const { chromium } = createRequire(import.meta.url)("playwright");

const COPY = {
  ru: {
    tagline: "Устанавливайте свои приложения на телевизоры Samsung — с компьютера или прямо с телефона",
    points: ["Без Tizen SDK и Tizen Studio", "Находит телевизор в сети", "Сертификат, подпись и проверка .wgt"],
  },
  en: {
    tagline: "Install your own apps on Samsung TVs — from a computer or straight from your phone",
    points: ["No Tizen SDK or Tizen Studio", "Finds your TV on the network", "Certificate, signing and .wgt checks"],
  },
};

const data = (path, type) => `data:${type};base64,${readFileSync(path).toString("base64")}`;
const font = (subset) => data(`node_modules/@fontsource-variable/inter/files/inter-${subset}-opsz-normal.woff2`, "font/woff2");

// The app icon (same drawing as src/components/Logo.tsx and assets/logo.svg).
const LOGO = `<svg width="76" height="76" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3F5BF6"/><stop offset="1" stop-color="#12B8A6"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#g)"/><rect x="12" y="16" width="40" height="26" rx="5" fill="none" stroke="#fff" stroke-width="4"/><path d="M24 50h16" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M32 21.5v12M26.5 28.5l5.5 5.5 5.5-5.5" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHECK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4cd497" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

function html(lang) {
  const c = COPY[lang];
  const version = JSON.parse(readFileSync("package.json", "utf8")).version.replace(/\.0$/, "");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; font-weight: 100 900; src: url(${font("latin")}) format("woff2"); unicode-range: U+0000-00FF, U+2010-2027, U+2190-21FF; }
@font-face { font-family: Inter; font-weight: 100 900; src: url(${font("cyrillic")}) format("woff2"); unicode-range: U+0400-04FF; }
* { box-sizing: border-box; margin: 0; }
body { width: 1280px; height: 640px; overflow: hidden; background: #0d0e11; color: #ecedef; font-family: Inter, sans-serif; font-feature-settings: "cv11" 1, "ss03" 1; -webkit-font-smoothing: antialiased; position: relative; }
.text { position: absolute; left: 72px; top: 72px; width: 520px; }
.brand { display: flex; align-items: center; gap: 20px; }
h1 { font-size: 68px; font-weight: 650; letter-spacing: -0.035em; line-height: 1; }
.ver { margin-left: -6px; align-self: flex-start; margin-top: 4px; padding: 5px 12px; border-radius: 999px; background: #14233f; color: #7fb0ff; font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.tagline { margin-top: 34px; font-size: 29px; line-height: 1.3; letter-spacing: -0.015em; color: #c9cbd1; text-wrap: balance; }
ul { list-style: none; padding: 0; margin-top: 34px; display: grid; gap: 14px; }
li { display: flex; align-items: center; gap: 12px; font-size: 21px; font-weight: 500; color: #ecedef; }
li span { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: #10261d; flex-shrink: 0; }
.foot { position: absolute; left: 72px; bottom: 60px; font-size: 19px; font-weight: 600; color: #a1a4ac; letter-spacing: 0.01em; }
.shot { position: absolute; border-radius: 16px; overflow: hidden; border: 1px solid rgb(255 255 255 / 0.1); box-shadow: 0 24px 64px -16px rgb(0 0 0 / 0.75); background: #15161a; }
.shot img { display: block; width: 100%; }
.desktop { left: 650px; top: 72px; width: 740px; }
.phone { left: 596px; top: 236px; width: 206px; border-radius: 26px; border-color: rgb(255 255 255 / 0.14); }
</style></head><body>
<div class="text">
  <div class="brand">${LOGO}<h1>EasyTizen</h1><span class="ver">${version}</span></div>
  <p class="tagline">${c.tagline}</p>
  <ul>${c.points.map((p) => `<li><span>${CHECK}</span>${p}</li>`).join("")}</ul>
</div>
<p class="foot">Windows · macOS · Linux · Android</p>
<div class="shot desktop"><img src="${data(`docs/img/${lang}/desktop-package.png`, "image/png")}" alt=""></div>
<div class="shot phone"><img src="${data(`docs/img/${lang}/android-success.png`, "image/png")}" alt=""></div>
</body></html>`;
}

const browser = await chromium.launch();
for (const lang of ["ru", "en"]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await page.setContent(html(lang), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `docs/readme/social-preview-${lang}.png` });
  console.log(`docs/readme/social-preview-${lang}.png`);
  await page.close();
}
await browser.close();
