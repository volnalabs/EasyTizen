# EasyTizen design system

The interface is a calm, precise utility: clear hierarchy, restrained colour, hairline borders, moderate radii. Every visual value comes from the tokens below — components never use raw colours, radii or font sizes. Read this before changing the UI; the Claude Code skill in `.claude/skills/easytizen-ui/` follows the same rules.

## Where things live

| File | Contents |
|---|---|
| `src/styles/index.css` | tokens (`:root` / `[data-theme="dark"]`), the Tailwind theme mapping, base styles, component classes (`.btn`, `.card`, `.input`, `.chip`, `.data`, `.eyebrow`) |
| `src/components/ui.tsx` | `Button`, `IconButton`, `Toggle`, `Segmented`, `Pill`, `IconTile`, `DataList`/`Row`, `CopyButton`, `Field`, `Progress`, `Notice`, `Details`, `EmptyState`, `PageHeader`, `Section`, `Modal`, toasts |
| `src/i18n/{en,ru}.ts` | every user-visible string |

Base styles are in `@layer base` and component classes in `@layer components`, so Tailwind utilities always win. Do not add unlayered element selectors — they silently override utilities (this once broke every button's font size).

## Tokens

Use them through Tailwind: `bg-surface`, `text-muted`, `border-line`, `rounded-card`, `text-body`, `shadow-pop` …

**Colour** (light / dark values in `index.css`)

| Token | Utility | Use |
|---|---|---|
| `--bg` | `bg-bg` | window background |
| `--surface` | `bg-surface` | cards, bars, dialogs |
| `--surface-2` | `bg-surface-2` | sunken areas, hover, segmented track |
| `--surface-3` | `bg-surface-3` | pressed, switch track off, progress track |
| `--border` / `--border-strong` | `border-line` / `border-line-strong` | hairlines / inputs and secondary buttons |
| `--text` / `--muted` / `--faint` | `text-fg` / `text-muted` / `text-faint` | primary / secondary (≥ 6.4:1) / placeholders and disabled only |
| `--accent` / `--accent-ink` | `bg-accent text-accent-ink` | primary buttons, active switch (white ink ≥ 4.8:1) |
| `--accent-text` | `text-accent-text` | accent as text or icon on a surface (≥ 7:1 in dark) |
| `--accent-soft` / `--accent-line` | `bg-accent-soft` / `border-accent-line` | selection, info notices |
| `--ok`, `--warn`, `--err` + `-soft` | `text-ok`, `bg-warn-soft` … | status; always paired with an icon or word, never colour alone |
| `--brand-2` | `.brand-gradient` | second stop of the logo gradient — decorative, progress bars only |

**Radius:** `rounded-chip` 6 px (chips) · `rounded-control` 10 px (buttons, inputs) · `rounded-card` 14 px (cards) · `rounded-dialog` 20 px (dialogs, sheets). Inner panels inside a card use 10–12 px.

**Type** — Inter 4 variable (bundled, OFL; Latin + Cyrillic), optical sizing on.

| Utility | Size | Use |
|---|---|---|
| `text-caption` | 12 px | timestamps, step labels, meta — never for actions |
| `text-small` | 13 px | secondary text, hints, small buttons |
| `text-body` | 14 px | default |
| `text-emph` | 15 px | item titles (TV, app, certificate) |
| `text-title` | 17 px | card and dialog titles |
| `text-heading` | 22 px | page titles |
| `text-display` | 28 px | first run, success |

All sizes are `rem`. On touch devices (`:root[data-touch]`, set on Android and coarse pointers) the root is 17 px, so text and spacing grow together; Android's system font size scales the WebView text on top (`MainActivity.onWebViewCreate`). Weight carries hierarchy (400 / 500 / 600), tracking is slightly negative only from `text-title` up.

Technical values (IP, DUID, IDs, paths, versions) use `.data`: tabular figures, slashed zero, disambiguated I/l, and they wrap instead of being cut off.

**Elevation:** `shadow-card` (cards), `shadow-raised` (selected segment, switch knob), `shadow-pop` (dialogs, toasts). Borders do most of the work; shadows are subtle.

**Motion:** `fade-up`, `fade-in`, `pop-in`, `sheet-in` (bottom sheet on phones), 150–300 ms ease-out. `prefers-reduced-motion` turns animations off; indeterminate progress then shows a static bar.

**Focus:** keyboard focus is a 2 px outline (`--focus`) with 2 px offset — never a box-shadow, so it cannot be hidden by component shadows. Inputs show a soft ring instead.

## Components and patterns

- **Buttons:** one primary action per area. `sm` 32 px / `md` 40 px / `lg` 48 px; on touch `sm` 38 px and `md` 44 px. Labels may wrap; never shrink the text. Destructive actions use `danger` and sit behind a confirmation.
- **Switches:** `Toggle` — the whole row (title + description) is the control, `role="switch"`.
- **Key/value data:** `DataList` + `Row`. Side by side in wide containers, stacked when narrow (container query) — values are never truncated. Long IDs get a `CopyButton`.
- **Notices:** say what happened, why, and what to do next; technical text goes into `Details`. Plain-language error strings live in the locale files (`err_*`).
- **Dialogs:** `Modal` renders in a portal, traps focus, restores it on close, is a bottom sheet under 640 px with full-width stacked footer buttons, and respects the safe area.
- **Lists of devices/apps:** names wrap (two lines are fine), status is a word plus colour.
- **Settings:** `Section` = small uppercase heading above a card. Segmented controls stretch to the full width on phones.
- **Icons:** lucide only, 16 px in buttons, 18–20 px in navigation and tiles, default stroke (1.8–2.1 in navigation).

## Layout

- Desktop (`md` and up, ≥ 768 px): 240 px sidebar with the TV status card; content column max 50 rem (54 rem from `xl`), 32 px gutters.
- Phones: top bar (logo, demo badge, History), four-tab bottom bar (Install, TVs, Certificates, Settings), 16 px gutters, `safe-top`/`safe-bottom`/`safe-x` for system bars and cut-outs, `adjustResize` + `dvh` for the keyboard.
- Use `min-w-0` on flex children that hold text, `flex-[1_1_Nrem]` + `flex-wrap` for action rows, container queries (`@container`) for components that appear in different widths.

## Language

All copy is in `src/i18n`; components contain no Russian or English text. `npm test` checks that both languages have the same keys and placeholders and that every code the backend can return is translated. Bottom-bar labels must stay within 11 Cyrillic / 12 Latin characters (tested). The UI uses logical alignment (`text-start`, `justify-start`) where it matters; right-to-left languages are not supported yet.

## Checking a change

1. `npm run dev`, then open `http://localhost:1420/?lang=ru` and `?lang=en`, with `&platform=android` for the phone layout, `&demo=fresh` for first run, `&update=available`, `&checks=off` or `&checks=fail` for those states.
2. Look at 320, 360, 375, 390, 412, 480 px and at 1024×640, 1280×720, 1366×768, 1440×900, 1920×1080, in both themes and both languages.
3. Regenerate the README screenshots with `node scripts/screenshots.mjs` (both languages) when screens change.
