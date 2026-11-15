# EasyTizen design system — "Signal" (1.0)

EasyTizen is a precise tool for one job: getting an app onto a TV. The interface reads like an instrument panel — warm paper and graphite neutrals, one signal-blue accent taken from the logo, status colours that only ever mean status, and type and spacing doing the work that borders and boxes do elsewhere. Every visual value comes from the tokens below; components never use raw colours, radii or font sizes. The Claude Code skill in `.claude/skills/easytizen-ui/` follows the same rules.

## Where things live

| File | Contents |
|---|---|
| `src/styles/index.css` | tokens (`:root` / `[data-theme="dark"]`), the Tailwind theme mapping, base styles, component classes (`.btn`, `.icon-btn`, `.panel`, `.input`, `.chip`, `.data`, `.eyebrow`, `.row-btn`), motion |
| `src/components/ui.tsx` | `Button`, `IconButton`, `Spinner`, `Segmented`, `Toggle`, `Pill`, `StatusDot`, `DataList`/`Row`, `CopyButton`, `Field`, `PasswordInput`, `Progress`, `Notice`, `Details`, `EmptyState`, `PageHeader`, `Section`, `Modal` + `DialogCancel`, toasts, `useMediaQuery` |
| `src/components/SplitView.tsx` | master–detail layout (`SplitView`, `ListItem`, `useSplit`) for TVs and certificates |
| `src/i18n/{en,ru}.ts` | every user-visible string |

Base styles are in `@layer base` and component classes in `@layer components`, so Tailwind utilities always win. Do not add unlayered element selectors — they silently override utilities.

## Colour

Use the tokens through Tailwind: `bg-surface`, `text-muted`, `bg-fill`, `border-line`, `text-accent-text` …

| Token | Utility | Light | Dark | Use |
|---|---|---|---|---|
| `--bg` | `bg-bg` | `#f4f4f1` warm paper | `#0d0e11` graphite | window background |
| `--surface` | `bg-surface` | `#ffffff` | `#15161a` | panels, bars, dialogs |
| `--raised` | `bg-raised` | `#ffffff` | `#2a2c33` | selected segment, active sidebar item, switch knob |
| `--dialog` | `bg-dialog` | `#ffffff` | `#1d1e23` | dialogs and bottom sheets — a step above the scrim, so they need no outline |
| `--fill-1/2/3` | `bg-fill` / `bg-fill-2` / `bg-fill-3` | ink at 4.5 / 7.5 / 12 % | white at 5 / 8.5 / 13 % | hover · secondary buttons and pressed · switch and progress tracks. Alpha, so they work on any surface |
| `--line` / `--line-strong` | `border-line` / `border-line-strong` | ink 8 % / 16 % | white 7.5 % / 15 % | hairlines / input outlines, the drop zone |
| `--text` / `--muted` / `--faint` | `text-fg` / `text-muted` / `text-faint` | `#111216` / `#5c5f67` (6.4:1) / `#8e9098` | `#ecedef` / `#a1a4ac` (7.3:1) / `#6d7078` | primary / secondary / placeholders and disabled only |
| `--accent` | `bg-accent` | `#1a63e6` (white ink 5.3:1) | `#2a68e8` (4.95:1) | primary buttons, current step, switches, selection |
| `--accent-text` | `text-accent-text` | `#155acf` (6.2:1) | `#7fb0ff` (8.2:1) | accent as text or icon |
| `--accent-soft` | `bg-accent-soft` | `#eaf1fe` | `#14233f` | selected rows, active nav pill, info notices |
| `--ok`, `--warn`, `--err` + `-soft` | `text-ok`, `bg-warn-soft` … | | | status — always with an icon or a word, never colour alone |
| `--brand-2` | `.brand-gradient` | `#12b8a6` | `#2fd6c3` | the logo's teal: progress fills and the logo only |

The accent is a signal blue (hue ≈ 217°), between the two stops of the logo. There is one accent: no second brand colour, no decorative gradients, no purple. The logo keeps its own cobalt-to-teal gradient.

## Shape and elevation

| Token | Value | Use |
|---|---|---|
| `rounded-chip` | pill | status chips |
| `rounded-control` | 12 px | buttons (`sm` 10 px, `lg` 14 px), inputs, selectable rows |
| `rounded-card` | 18 px | panels |
| `rounded-dialog` | 24 px | dialogs and bottom sheets |

Icon tiles are 9–16 px squircles sized with the tile. Shapes follow purpose: a chip is a pill, a control a soft square, a panel calm.

Elevation is quiet and layered — `shadow-card` (panels: a 1–3 px whisper), `shadow-raised` (selected segment, knob, dock, copy chips), `shadow-pop` (dialogs, toasts). No outlines around buttons or dialogs, no dark halos, no glow. In dark mode depth comes from lighter surfaces, not shadows: panels have only their hairline, dialogs a lighter surface and one soft shadow.

## Type

Inter 4 variable (bundled, OFL; Latin + Cyrillic), optical sizing on, `cv11` (single-storey a) and `ss03` (round quotes).

| Utility | Size | Use |
|---|---|---|
| `text-micro` | 11 px | navigation labels, eyebrows (uppercase, +0.07 em) |
| `text-caption` | 12 px | timestamps, meta — never for actions |
| `text-small` | 13 px | secondary text, hints, small buttons |
| `text-body` | 14 px | default |
| `text-emph` | 15 px | item and step titles |
| `text-title` | 17 px | panel and dialog titles |
| `text-heading` | 26 px | page titles, tracking −0.025 em |
| `text-display` | 32 px | first run, success, tracking −0.03 em |

All sizes are `rem`. On touch devices (`:root[data-touch]`, set on Android and coarse pointers) the root is 17 px, so text, controls and spacing grow together; Android's system font size scales the WebView on top. Weight carries hierarchy (400 / 500 / 600). Technical values (IP, DUID, IDs, versions, sizes) use `.data`: tabular figures, slashed zero, disambiguated I/l, and they wrap instead of being cut off.

## Components

**Buttons** — one obvious primary per area.

| Variant | Look | Use |
|---|---|---|
| `primary` | accent fill, white ink, faint top highlight | the next step: Find TVs, Install on TV, Create certificate |
| `secondary` | tonal (`fill-2`), no border | alternatives: Change, Other file, Import, Check connection |
| `ghost` | text only, fill on hover | tertiary: Cancel in dialogs, History, Clear history |
| `danger` | solid error colour | the confirming button of a destructive dialog |
| `link` | accent text | inline navigation, help |
| `IconButton` | 36 px (44 px touch), `tone="danger"` reddens on hover | compact actions; always labelled |

States: hover (darker fill), pressed (`scale(.975)` + darker), focus (2 px outline, 2 px offset), disabled (its own neutral look — `fill-1` and faint text, not a faded primary), loading (`busy`: the `icon` turns into a spinner, label stays, `aria-busy`). Sizes `sm` 32 / `md` 40 / `lg` 48 px; on touch 40 / 46 / 52 px. Labels may wrap; never shrink the text. A destructive action is a ghost button in red at the bottom of a detail and always opens a confirmation.

**Inputs** — 42 px (48 px touch), 12 px radius, hairline outline, accent border + 4 px soft ring on focus, error border and an icon + message below. `enterKeyHint` and `inputMode` set for the on-screen keyboard. Passwords use `PasswordInput` (show/hide button that keeps focus and the keyboard).

**Switches** — `Toggle`: the whole row is the control (`role="switch"`), 44 × 26 px track, spring-eased knob with a check.

**Segmented** — 2–4 options with a sliding thumb (measured, animated), arrow keys move the choice. `stretch` fills the row.

**Lists** — a panel with hairline dividers; rows are buttons (`.row-btn`) with a 40 px tile, a title that wraps and one meta line. Status is a word in a chip or a dot with a word. No card per item.

**Panels** — `.panel`: surface, hairline, 18 px radius, whisper shadow. Never nest a panel inside a panel; inside a panel use dividers, `bg-fill` wells or plain spacing.

**Notices** — tinted wells without borders. The title says what happened, the body why and what to do next; technical text goes into `Details`. `DiagnosisPanel` adds numbered steps and the collapsible "What was checked".

**Disclosure** — `Details`: default (monospaced technical text in a scrollable well), `prose` (long readable text, release notes), `inline` (lists and key/value data in place).

**Dialogs and sheets** — `Modal` renders in a portal, traps focus and restores it, closes on Escape and on the scrim. Under 600 px it is a bottom sheet with a grab handle, full-width stacked footer buttons and the safe area; from 600 px a centred dialog. `DialogCancel` (and Escape/scrim/×) play the closing animation before `onClose`.

**Toasts** — bottom centre, above the phone dock; slide in, fade out; errors stay 6 s.

**Progress** — 4–6 px track, the brand gradient as fill; a travelling stripe when indeterminate, a static bar with reduced motion. Installation shows the current stage, its percentage and every stage with done/active/waiting marks.

**Status dot** — `StatusDot` with `live` adds a soft pulse for a connected TV.

**Icons** — lucide only: 16 px in buttons, 18–21 px in navigation and tiles, stroke 1.9 (2.2 when active).

## Layout

| Width | Navigation | Composition |
|---|---|---|
| < 600 px (phones) | top bar (logo, demo badge, History) + floating four-tab dock with a sliding pill; the dock hides while the keyboard is up | one column, 16 px gutters, dialogs as bottom sheets, list → detail as separate screens |
| 600–1023 px (tablets portrait, narrow windows) | navigation rail with all five sections and a TV indicator | one column up to 46 rem, centred dialogs |
| ≥ 1024 px (desktop, tablets landscape) | 264 px sidebar with the connected-TV card | TVs and certificates as master–detail; from 1280 px the install page adds a side column (Host PC IP, recent installations) |

Pages share one container (max 74 rem, 32–40 px gutters), so titles never jump between sections; reading pages keep 46 rem. Safe areas: `safe-top`, `safe-bottom`, `safe-x` on bars, sheets and the dock — never on the same element as padding for that side (one would silently replace the other; `scripts/safe-area.test.ts` enforces it): put the inset on a wrapper or use `calc(… + env(safe-area-inset-…))`; `dvh` and `adjustResize` for the keyboard. Use `min-w-0` on flex children with text, `flex-wrap` for action rows and container queries (`@container`) for components that appear at different widths.

### The install page

A rail of four steps — **TV → App → Signature → Install** — each with a mark (number, ✓ done, ! attention, faded when locked) and its panel. A done step collapses into a one-line summary with a "Change" action and details on demand; the next step is highlighted; a locked step says in one line what it is waiting for. The package check is a single status line ("File checked — no problems found") that expands to the full list, and opens by itself when something is wrong. While an installation runs, earlier steps are locked; the result replaces the install panel and scrolls into view.

## Motion

Short and purposeful, 120–260 ms, `--ease-out` `cubic-bezier(.22,1,.36,1)` (exits use `--ease-in`, the switch knob `--ease-spring`).

| Where | Animation |
|---|---|
| page change | `page-in`: fade + 4 px rise, 200 ms |
| dock / segmented / switch | sliding indicator 200–240 ms |
| dialogs | scrim fade; sheet slides up (260 ms) / dialog pops in (200 ms); exit 140–180 ms |
| toasts | `toast-in` / `toast-out` |
| steps | marks change colour (300 ms), the ✓ pops in, the rail turns green; panels `fade-up` |
| connection | `signal` pulse on the live dot |
| success | the circle pops, the check draws itself |
| buttons | pressed scale, colour transitions 160 ms |

`prefers-reduced-motion` turns animations off (indeterminate progress becomes static, dialogs close at once). No artificial delays.

## Accessibility

Visible focus outline everywhere (never a shadow), labels for icon buttons, `role="switch"` rows, radio groups for segmented controls and certificate choice, `aria-current` for navigation and the current step (plus a hidden word for each step state), `aria-live` for search, checks, progress and results, status never by colour alone, touch targets ≥ 44 px on touch devices.

## Language

All copy is in `src/i18n`; components contain no Russian or English text. Short, plain, no bureaucratic phrasing; technical detail goes into disclosures. `npm test` checks that both languages have the same keys and placeholders, that every code the backend can return is translated, and that dock labels fit a 320 px screen (≤ 11 Cyrillic / 12 Latin characters). Logical alignment (`text-start`, `ms-*`/`me-*`) where it matters; right-to-left languages are not supported yet.

## Checking a change

1. `npm run dev`, then open `http://localhost:1420/?lang=ru` and `?lang=en`, with `&platform=android` for the phone build, `&demo=fresh` for first run, `&update=available`, `&checks=off` or `&checks=fail`, `&legacy=1`, `&theme=light|dark`.
2. Look at 320, 360, 375, 390, 412, 480 px; 600, 768, 834, 1024 px portrait and landscape; 1024×640, 1280×720, 1366×768, 1440×900, 1920×1080 — both themes, both languages. `node scripts/ui-audit.mjs` (with `npx vite preview --port 4173`) walks all of them automatically and fails on sideways scrolling, elements off screen and clipped labels.
3. Regenerate the README screenshots with `node scripts/screenshots.mjs` (desktop, phone and tablet, both languages) when screens change.
