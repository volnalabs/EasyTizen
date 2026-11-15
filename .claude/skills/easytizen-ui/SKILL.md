---
name: easytizen-ui
description: Work on the EasyTizen desktop/Android interface — screens, components, styles, copy, localisation, responsive layout, accessibility, screenshots — without breaking the design system or the backend contracts. Use for any change under src/, docs/img or the README visuals.
---

# EasyTizen UI

EasyTizen (Tauri 2 + React + Tailwind 4) installs `.wgt` apps on Samsung TVs from a computer or an Android phone. Since 1.0 the interface follows the "Signal" design system: warm paper / graphite neutrals, one signal-blue accent from the logo, type and spacing instead of boxes. Extend the system; do not drift from it.

## Before editing

1. Read `docs/DESIGN-SYSTEM.md` (tokens, components, layout per form factor, motion) and the component you touch in `src/components/ui.tsx`.
2. Run the real UI: `npm run dev` → `http://localhost:1420/?lang=ru` (add `&platform=android`, `&demo=fresh`, `&update=available`, `&checks=off|fail`, `&legacy=1`, `&theme=light|dark`). The demo backend (`src/services/demo.ts`) emulates the network and a TV.
3. Look at the screen before changing it — both languages, on a phone, a tablet and a desktop size.

## Rules

- **Tokens only.** Colours, radii, type sizes and shadows come from `src/styles/index.css` through Tailwind (`bg-surface`, `bg-fill`, `text-muted`, `border-line`, `rounded-card`, `text-body` …). No hex values or arbitrary font sizes in components. One accent; no new gradients, glows, outlines around buttons or heavy shadows.
- **Structure over boxes.** One `.panel` per logical block; never a panel inside a panel. Inside a panel use dividers, `bg-fill` wells or spacing. Lists are one panel with hairline rows, not a card per item.
- **Buttons:** one `primary` per area; `secondary` (tonal) for alternatives, `ghost` for tertiary, `danger` only to confirm a destructive dialog. Pass icons through `icon` so `busy` can turn them into a spinner. Dialog dismiss buttons are `DialogCancel` (exit animation).
- **Cascade layers.** New global CSS goes into `@layer base` or `@layer components`; unlayered selectors override every utility.
- **Copy lives in `src/i18n/en.ts` and `ru.ts`** with identical keys and placeholders. Never hard-code text. Short and plain; technical detail into `Details`. Backend error codes map to `err_<code>`; remove keys you stop using.
- **No truncation of meaning.** Long names, IPs, DUIDs, file names wrap (`.data`, `break-words`, `DataList`); ellipsis only where the full value stays reachable. Do not shrink text to make it fit — reflow (`flex-wrap`, `min-w-0`, container queries).
- **Form factors:** phones < 600 px (top bar + dock, bottom sheets), tablets 600–1023 px (rail), ≥ 1024 px (sidebar, master–detail via `SplitView`), install side column from 1280 px. Touch targets ≥ 44 px (`.btn`/`.icon-btn`/inputs grow under `:root[data-touch]`), safe areas via `safe-top/-bottom/-x` — never on an element that also has padding on that side (wrap it or use `calc(… + env(…))`; tested), keyboard-aware dock.
- **Motion:** 120–260 ms with the `--ease-*` curves, CSS only; everything must work with `prefers-reduced-motion`.
- **Accessibility:** visible focus outline, labels for icon buttons, `role="switch"` via `Toggle`, radio groups for choices, status never by colour alone, `aria-live` for search, checks, progress and results.
- **Protected:** Rust commands and their arguments/return shapes, SDB, DUID, Samsung OAuth/certificates, WGT signing/installation, storage formats, identifiers, release file names. A UI change must not change a backend contract. Report unrelated bugs instead of fixing them on the side.
- **Package checks:** mandatory file safety (Zip Slip, size/ratio limits, damaged archives, XML without DTD) is never optional. Only the additional checks (`easytizen-core/src/checks.rs`) follow the `extra_package_checks` setting. Never call them an antivirus.
- **Updates:** only signed artifacts from the official GitHub Releases; no background activity when automatic updates are off; never interrupt a TV operation (`busy` in the app context).

## Verify

```bash
npm run typecheck && npm test && npm run build
```

- Visual check at 320, 360, 375, 390, 412, 480 px, tablets 600/768/834/1024 in portrait and landscape, and 1024×640 … 1920×1080, dark and light, RU and EN; no horizontal scroll, no overlap, no clipped labels (the dock labels at 320 px are the tightest spot). `node scripts/ui-audit.mjs` (needs `npx vite preview --port 4173`) checks every size, language and theme automatically.
- `node scripts/screenshots.mjs` (needs `npx vite preview --port 4173`) regenerates `docs/img/ru` and `docs/img/en` — desktop, phone and tablet scenes in both languages; README.md uses `ru`, README.en.md uses `en`. Screenshots are always real captures, never edited images.
- Rust side when touched: `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --features easytizen-core/mock-tv -- -D warnings`, `cargo test --workspace --features easytizen-core/mock-tv`.
- Say what was not verified (physical TV, real phone, Samsung services) — do not imply it.
