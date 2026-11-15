#!/usr/bin/env node
// Responsive audit of the real interface (demo backend) at every supported screen size.
//
//   npx vite build && npx vite preview --port 4173 &
//   node scripts/ui-audit.mjs                     (needs Playwright with Chromium)
//
// For phones (320–480 px), tablets (600–1194 px, portrait and landscape) and desktop windows
// (1024×640 … 1920×1080), in both languages and both themes, it opens every section and walks
// the installation (find → connect → choose file → install → success) and reports:
//   - horizontal scrolling of the page or the content area,
//   - elements that stick out of the screen,
//   - labels clipped by their own box (ellipsis or overflow: hidden),
//   - page errors.
// Exit code 1 when anything is found.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:4173";

function labels(lang) {
  const out = {};
  for (const m of readFileSync(`src/i18n/${lang}.ts`, "utf8").matchAll(/^\s+(\w+):\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)) out[m[1]] = m[2];
  return out;
}

/** [width, height, touch] — touch sizes run the Android build of the interface. */
const SIZES = [
  [320, 640, true], [360, 760, true], [375, 812, true], [390, 844, true], [412, 915, true], [480, 854, true],
  [600, 960, true], [768, 1024, true], [834, 1194, true], [960, 600, true], [1024, 768, true], [1194, 834, true],
  [1024, 640, false], [1280, 720, false], [1366, 768, false], [1440, 900, false], [1920, 1080, false],
];

const browser = await chromium.launch();
const findings = [];

for (const [width, height, touch] of SIZES) {
  for (const lang of ["ru", "en"]) {
    for (const theme of ["light", "dark"]) {
      const t = labels(lang);
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce", hasTouch: touch });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${BASE}/?lang=${lang}&theme=${theme}&update=available${touch && width < 1024 ? "&platform=android" : ""}`);
      await page.waitForTimeout(450);

      const check = async (where) => {
        const problems = await page.evaluate(() => {
          const out = [];
          const main = document.querySelector("main");
          if (main && main.scrollWidth > main.clientWidth + 1) out.push(`content scrolls sideways by ${main.scrollWidth - main.clientWidth}px`);
          if (document.documentElement.scrollWidth > innerWidth + 1) out.push("page scrolls sideways");
          for (const el of document.querySelectorAll("button, a, p, span, h1, h2, input, li, dd, dt")) {
            const r = el.getBoundingClientRect();
            if (!r.width || getComputedStyle(el).visibility === "hidden") continue;
            if (r.right > innerWidth + 1 || r.left < -1) out.push(`off screen: ${el.tagName} "${(el.textContent || "").trim().slice(0, 32)}"`);
          }
          for (const el of document.querySelectorAll("button span, p, h1, h2, dd span")) {
            const cs = getComputedStyle(el);
            if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && (cs.overflow === "hidden" || cs.textOverflow === "ellipsis")) out.push(`clipped: "${el.textContent.trim().slice(0, 32)}"`);
          }
          return [...new Set(out)];
        });
        for (const p of [...problems, ...errors.splice(0)]) findings.push(`${width}×${height} ${lang} ${theme} ${where}: ${p}`);
      };

      // The installation, step by step.
      await check("install");
      await page.getByRole("button", { name: t.tvFind }).first().click();
      await page.waitForTimeout(1700);
      await check("install/found");
      await page.getByRole("listitem").getByRole("button", { name: t.tvConnect }).first().click();
      await page.waitForTimeout(1000);
      await page.getByRole("button", { name: t.dropTitle }).click();
      await page.waitForTimeout(1000);
      await check("install/package");
      await page.getByRole("button", { name: t.installButton }).click();
      await page.waitForTimeout(1200);
      await check("install/progress");
      await page.getByRole("status").filter({ hasText: t.installSuccessTitle }).first().waitFor({ timeout: 15000 });
      await check("install/success");

      // Every other section.
      const nav = page.getByRole("navigation", { name: t.navMain });
      for (const key of ["navTvs", "navCerts", "navSettings"]) {
        await nav.getByRole("button", { name: t[key], exact: true }).first().click();
        await page.waitForTimeout(250);
        await check(key);
      }
      await page.close();
    }
  }
}

await browser.close();
for (const f of findings) console.log(f);
console.log(findings.length ? `${findings.length} problem(s)` : `No problems at ${SIZES.length} sizes × 2 languages × 2 themes.`);
process.exit(findings.length ? 1 : 0);
