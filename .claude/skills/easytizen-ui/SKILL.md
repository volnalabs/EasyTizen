---
name: easytizen-ui
description: Work on the EasyTizen desktop/Android interface — screens, components, styles, copy, localisation, responsive layout, accessibility, screenshots — without breaking the design system or the backend contracts. Use for any change under src/, docs/img or the README visuals.
---

# EasyTizen UI

EasyTizen (Tauri 2 + React + Tailwind 4) installs `.wgt` apps on Samsung TVs from a computer or an Android phone. The interface is a calm, precise utility. Polish, do not reinvent.

## Before editing

1. Read `docs/DESIGN-SYSTEM.md` (tokens, components, layout rules) and the component you touch in `src/components/ui.tsx`.
2. Run the real UI: `npm run dev` → `http://localhost:1420/?lang=ru` (add `&platform=android`, `&demo=fresh`, `&update=available`, `&checks=off|fail`, `&theme=light`). The demo backend (`src/services/demo.ts`) emulates a TV.
3. Look at the screen before changing it — in both languages, on a phone width and a desktop size.

## Rules

- **Tokens only.** Colours, radii, type sizes and shadows come from `src/styles/index.css` through Tailwind (`bg-surface`, `text-muted`, `border-line`, `rounded-card`, `text-body` …). No hex values or arbitrary font sizes in components.
- **Cascade layers.** New global CSS goes into `@layer base` or `@layer components`; unlayered selectors override every utility.
- **Copy lives in `src/i18n/en.ts` and `ru.ts`** with identical keys and placeholders. Never hard-code text. Backend error codes map to `err_<code>`.
- **No truncation of meaning.** Long names, IPs, DUIDs, paths wrap (`.data`, `break-words`, `DataList`); ellipsis only where the full value stays reachable (title, copy button, detail view). Do not shrink text to make it fit — reflow instead (`flex-wrap`, `min-w-0`, container queries).
- **Touch:** ≥ 44 px targets on phones (`.btn`/`.icon-btn` already grow under `:root[data-touch]`), safe areas via `safe-top/-bottom/-x`, dialogs as bottom sheets.
- **Accessibility:** visible focus outline, labels for icon buttons, `role="switch"` rows via `Toggle`, status never by colour alone, `aria-live` for progress and results, reduced motion respected.
- **Protected:** Rust commands and their arguments/return shapes, SDB, DUID, Samsung OAuth/certificates, WGT signing/installation, storage formats, identifiers, release file names. A UI change must not change a backend contract. Report unrelated bugs instead of fixing them on the side.
- **Package checks:** mandatory file safety (Zip Slip, size/ratio limits, damaged archives, XML without DTD) is never optional. Only the additional checks (`easytizen-core/src/checks.rs`) follow the `extra_package_checks` setting. Never call them an antivirus.
- **Updates:** only signed artifacts from the official GitHub Releases; no background activity when automatic updates are off; never interrupt a TV operation (`busy` in the app context).

## Verify

```bash
npm run typecheck && npm test && npm run build
```

- Visual check at 320, 360, 375, 390, 412, 480 px and 1024×640 … 1920×1080, dark and light, RU and EN; no horizontal scroll, no overlap, no clipped labels.
- `node scripts/screenshots.mjs` (needs `npx vite preview --port 4173`) regenerates `docs/img/ru` and `docs/img/en` — the same scenes in both languages; README.md uses `ru`, README.en.md uses `en`. Screenshots are always real captures, never edited images.
- Rust side when touched: `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --features easytizen-core/mock-tv -- -D warnings`, `cargo test --workspace --features easytizen-core/mock-tv`.
- Say what was not verified (physical TV, real phone, Samsung services) — do not imply it.
