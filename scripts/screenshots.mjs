#!/usr/bin/env node
// Regenerates the README screenshots from the real interface, in Russian and English.
//
//   npx vite build && npx vite preview --port 4173 &
//   node scripts/screenshots.mjs                 (needs Playwright with Chromium)
//   node scripts/screenshots.mjs --lang en       (one language only)
//
// Output: docs/img/<lang>/desktop-*.png and docs/img/<lang>/android-*.png — the same scenes in
// both languages, so README.md (ru) and README.en.md (en) show the interface in their language.
//
// The interface is the application's own frontend; the backend is the in-memory demo backend
// (src/services/demo.ts) with an emulated TV, so no television is required. Button labels are
// read from the locale files, so the script follows copy changes automatically.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";

// `require` so a globally installed Playwright (NODE_PATH) is found as well.
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:4173";
const argLang = process.argv.indexOf("--lang");
const LANGS = argLang > 0 ? [process.argv[argLang + 1]] : ["ru", "en"];

/** "key: "value"" pairs of a locale file (the values the screenshots click on). */
function labels(lang) {
  const out = {};
  for (const m of readFileSync(`src/i18n/${lang}.ts`, "utf8").matchAll(/^\s+(\w+):\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)) out[m[1]] = m[2];
  return out;
}

const browser = await chromium.launch();

for (const lang of LANGS) {
  const t = labels(lang);
  const OUT = `docs/img/${lang}`;
  mkdirSync(OUT, { recursive: true });

  const page = async ({ mobile = false, theme = "dark", query = "" }) => {
    const p = await browser.newPage({
      viewport: mobile ? { width: 412, height: 892 } : { width: 1280, height: 800 },
      deviceScaleFactor: mobile ? 2 : 1.5,
      colorScheme: theme,
      reducedMotion: "reduce",
    });
    p.on("pageerror", (e) => { throw e; });
    await p.goto(`${BASE}/?lang=${lang}&theme=${theme}${mobile ? "&platform=android" : ""}${query}`);
    await p.waitForTimeout(700);
    return p;
  };
  const shot = async (p, name) => { await p.waitForTimeout(450); await p.screenshot({ path: `${OUT}/${name}.png` }); console.log(`${lang}/${name}`); };
  const button = (p, name) => p.getByRole("button", { name, exact: false }).first();
  /** Scrolls the main area so `locator` sits near the top of the screen. */
  const reveal = async (p, locator, offset = 16) => {
    await locator.first().evaluate((el, off) => {
      const main = document.querySelector("main");
      if (main) main.scrollTop += el.getBoundingClientRect().top - main.getBoundingClientRect().top - off;
    }, offset);
    await p.waitForTimeout(250);
  };

  /** Install flow shared by both form factors. */
  async function flow(p, prefix) {
    await shot(p, `${prefix}-home`);
    await button(p, t.tvFind).click();
    await p.waitForTimeout(1500);
    await shot(p, `${prefix}-find`);
    await p.getByRole("listitem").getByRole("button", { name: t.tvConnect }).first().click();
    await p.waitForTimeout(1200);
    await shot(p, `${prefix}-connected`);
    await button(p, t.dropTitle).click();
    await p.waitForTimeout(1100);
    await reveal(p, p.getByRole("heading", { name: t.step2, exact: true }));
    await shot(p, `${prefix}-package`);
    await reveal(p, p.getByRole("group", { name: t.checksTitle }));
    await shot(p, `${prefix}-check`);
    await p.getByRole("button", { name: t.installButton }).click();
    await p.waitForTimeout(1900);
    await reveal(p, p.getByRole("heading", { name: t.step3, exact: true }));
    await shot(p, `${prefix}-progress`);
    await p.getByRole("status").filter({ hasText: t.installSuccessTitle }).first().waitFor({ timeout: 15000 });
    await reveal(p, p.getByRole("heading", { name: t.step3, exact: true }));
    await shot(p, `${prefix}-success`);
  }

  /** Settings: the update section with a newer release, then the security switch. */
  async function settings(p, prefix, openNav) {
    await openNav();
    await shot(p, `${prefix}-settings`);
    const updates = p.locator("#updates");
    await reveal(p, updates);
    await updates.getByRole("button", { name: t.updatesCheck }).click();
    // Download and verify (the automatic mode may already have started it).
    const install = updates.getByRole("button", { name: t.updateInstall });
    const ready = updates.getByRole("button", { name: prefix === "android" ? t.updateInstallApk : t.updateRestart });
    await install.or(ready).first().waitFor();
    if (await install.isVisible()) await install.click();
    await ready.waitFor({ timeout: 15000 });
    await reveal(p, updates);
    await shot(p, `${prefix}-updates`);
    await reveal(p, p.locator("#security"));
    await p.getByRole("switch", { name: t.extraChecksLabel }).click();
    await p.getByRole("dialog").waitFor();
    await shot(p, `${prefix}-security`);
  }

  // Desktop
  let p = await page({ theme: "light", query: "&demo=fresh" });
  await shot(p, "desktop-welcome");
  await p.close();

  p = await page({});
  await flow(p, "desktop");
  await button(p, t.navCerts).click();
  await shot(p, "desktop-certs");
  await button(p, t.certsCreate).click();
  await shot(p, "desktop-cert-new");
  await p.keyboard.press("Escape");
  await button(p, t.navTvs).click();
  await shot(p, "desktop-tvs");
  await button(p, t.navHistory).click();
  await shot(p, "desktop-history");
  await p.close();
  p = await page({ query: "&update=available" });
  await settings(p, "desktop", () => button(p, t.navSettings).click());
  await p.close();

  // Android
  p = await page({ mobile: true, theme: "light", query: "&demo=fresh" });
  await shot(p, "android-welcome");
  await button(p, t.next).click();
  await shot(p, "android-devmode");
  await p.close();

  p = await page({ mobile: true });
  await flow(p, "android");
  await button(p, t.navCerts).click();
  await shot(p, "android-certs");
  await p.close();
  p = await page({ mobile: true, query: "&update=available" });
  await settings(p, "android", () => p.getByRole("navigation", { name: t.navMain }).getByRole("button", { name: t.navSettings }).click());
  await p.close();
}

await browser.close();
