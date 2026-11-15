# Test report — EasyTizen

## 1.0.0 — interface redesign

Date: 2026-11-15. Linux x86_64 container (no KVM, no display), Rust 1.97, Node.js 22.23, Chromium + Playwright. The 1.0.0 changes are in the interface (`src/`), documentation and version numbers; the Rust engine is unchanged apart from one added assertion (`is_newer("v1.0.0", "0.9.8")`).

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | no errors |
| Interface, localisation, release scripts, "no SDK" guard | `npm test` | 58 tests passed (new: installation step states, history day grouping) |
| Production build | `npm run build` | built |
| Rust format / lints | `cargo fmt --all -- --check`; `cargo clippy --workspace --all-targets --features easytizen-core/mock-tv -- -D warnings` | clean |
| Rust tests | `cargo test --workspace --features easytizen-core/mock-tv` | 102 core + 26 app tests passed, 1 ignored (as before) |
| Versions | `node scripts/release.mjs check-version 1.0.0` | consistent: `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `tauri.conf.json` |
| Responsive audit | `node scripts/ui-audit.mjs` against `vite preview` | 17 sizes (320–480 px phones, 600–1194 px tablets in portrait and landscape, 1024×640–1920×1080 desktop) × RU/EN × light/dark: every section and the whole installation (find → connect → file → install → success) — no sideways scrolling, nothing off screen, no clipped labels, no page errors |
| States | Playwright, demo backend | first run, no TVs, search, slow-search hint, unreachable address, wrong Host PC IP, invalid IP, no certificate (Tizen certificate offered for Tizen 6), failed package check, checks off with the confirmation dialog, installation progress, success, update available/downloaded |
| Screenshots | `node scripts/screenshots.mjs` | desktop, phone and tablet scenes re-captured in Russian and English |

Not verified for 1.0.0: the redesigned interface on a **physical Android phone or tablet** (on-screen keyboard, system file picker, real safe areas and gesture bar were emulated in Chromium only), in the packaged desktop apps (WebView2, WKWebView, WebKitGTK) and against a **physical TV**. The update from 0.9.x to 1.0.0 was reasoned from the unchanged update code and data formats and the version comparison test, not performed with signed release builds.

---

## 0.9.x — single built-in engine (after 0.9.1)

Date: 2026-11-15. Environment of the local runs: Linux x86_64 (Ubuntu 24.04 container, no KVM), Rust 1.97, Node.js 22.23, OpenSSL 3, xmlsec1, MinGW-w64 + NSIS (Windows cross-build), Android SDK platform 36 / build-tools 35 / NDK 27.2, JDK 21.

This report states what was actually run and what it proves. Anything not listed under "Verified" has not been verified.

## Verified automatically (all passing)

| Suite | Command | Result |
|---|---|---|
| Core (`easytizen-core`) | `EASYTIZEN_REQUIRE_INTEROP=1 cargo test --workspace --features easytizen-core/mock-tv` | 94 tests passed |
| App backend (`easytizen`) | same command | 25 tests passed |
| Interface, localisation, release scripts, "no SDK" guard | `npm test` | 42 tests passed |
| Types | `npm run typecheck` | no errors |
| Lints | `cargo fmt --all -- --check`; `cargo clippy --workspace --all-targets --features easytizen-core/mock-tv -- -D warnings` | clean |
| Android Rust code | `cargo clippy -p easytizen --lib --target aarch64-linux-android` and `armv7-linux-androideabi`, `-D warnings` | clean |

What the important tests establish:

* **Discovery** (`discovery/*`) — interface classification (Wi-Fi, Ethernet, hotspot, mobile data, VPN, virtual; localized Windows names), network math, sweep bounds (≤ /22 whole, otherwise the own /24; never public, VPN, virtual or mobile networks), default-route fallback; a full `discover()` against the TV emulator and a stand-in for Samsung's device API: a ready TV with name, model and Tizen version, a TV with Developer Mode off (only the device API answers), deduplication of sweep + saved hosts, unrelated services never listed as ready, monotonic progress ending at 100 %, streamed results, prompt cancellation; nothing is run on the TV during a search.
* **Connection check** — ready TV with DUID; Developer Mode off read from the TV; wrong Host PC IP (both addresses); a TV that drops the connection (Host PC IP mismatch without the device API); closed port; unreachable / other network / no network diagnoses.
* **Samsung device API** — the real answer shape (`developerMode`, `developerIP`, model, name), `0.0.0.0` and missing fields treated as unknown, non-Samsung answers rejected, Content-Length and chunked HTTP parsing, refused port.
* **SSDP** — M-SEARCH shape, Samsung TV answers recognised, Chromecast/DIAL from others ignored, bounded wait and cancel.
* **Installation pipeline ↔ TV emulator** — real upload progress (monotonic, ends at 100 %), the TV's own installer percentages (18 → 61 → 100 %), stages Connecting → Uploading → Installing → Verifying → Launching, app found in `0 vd_applist`, launch confirmed, uploaded copy removed; **fallback** to the tool folder when the TV refuses `…/tmp`; **connection dropped mid-upload** → error, nothing installed, nothing left; **cancel during upload** → nothing installed or left; a TV that refuses `capability:` still gets the TV commands; unsigned package rejected with the certificate verdict.
* **WGT signing** — verified by an independent implementation (`xmlsec1`), and the `#prop` object digests are asserted byte-identical to the constants used by two independent installers that work on physical TVs (tizen.js, `tizen-app-installer-cli`).
* **Certificate issuance against an OpenSSL stand-in**, Samsung OAuth callback, keystore round trips — unchanged from 0.9.1 and passing.
* **Settings** — TV Deploy 0.1 schema, a settings file of the SDK era (`engine`, `sdk_path`, `pending_sdk_install`, Cyrillic path) loads; SDK-era profiles are kept and marked for transfer; legacy keystore locations (SDK data folder, `sdk.info`, `~/SamsungCertificate`).
* **Package gate** — mandatory safety in every mode; a package in `Мои приложения/TV apps (2026)/Приложение тест.wgt` is accepted.
* **Log** — lines are redacted, single-line, rotated at 1 MB; UTC timestamps.
* **Localisation** — every diagnosis, TV status and error code the backend can return has Russian and English text.
* **"No SDK" guard** (`scripts/no-sdk.test.ts`) — the SDK installer, Samsung CLI runner, bundled Node.js and `resources/` are gone; no source downloads or starts SDK tools or child processes; no bundled resources; the Windows GUI subsystem attribute is present.

## Verified by building and running locally

| Target | What was done | Result |
|---|---|---|
| **Windows x64** | `npx tauri build --target x86_64-pc-windows-gnu --bundles nsis` (cross-build; for MinGW only the `rlib` crate type was built — MSVC in CI builds all) | NSIS installer **3.65 MiB**, `easytizen.exe` 9.0 MiB. PE header: `Subsystem 2 (Windows GUI)` — no console window. Imports only system DLLs and `WebView2Loader.dll`; no child-process tooling. |
| **Android** APK (arm64 + armv7) | `npx tauri android build --apk --target aarch64 armv7` with a throw-away signing key (Maven Central reached through a local retrying mirror, because the sandbox proxy returns spurious 404s) | **APK 18.0 MiB** (18 902 020 bytes); `apksigner verify` passes; package `io.github.volnalabs.easytizen` 0.9.1 (unchanged), target SDK 36; permissions INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE, REQUEST_INSTALL_PACKAGES; contents: the Rust engine (`libeasytizen_lib.so`, 10.4 MB arm64 / 6.8 MB armv7), no Samsung CLI, no Node.js. The Kotlin side compiled. |
| **Linux** | `npx tauri build --bundles deb,appimage` | `.deb` **4.93 MiB** (was 48 MB with the bundled Node.js and Samsung CLI), AppImage 79.85 MiB (was 118 MB) |
| **Real app, end to end** (Linux release binary under Xvfb, WebKitGTK) against the TV emulator (`mock_tv` with SDB and the Samsung device API on a LAN address 192.168.77.50, Developer Mode for 192.168.77.1) | Driven with mouse clicks in the real window: start → "Find TVs" → connect → import an OpenSSL-made author/distributor pair for the emulator's DUID via the GTK file chooser → pick `Мои приложения/Тест app.wgt` → install | Host PC IP shown as the LAN address (not the public default-route address); search swept 253 hosts of 192.168.77.0/24 and listed the TV as "Ready" with model and Tizen 8.0; connection read the DUID and saved the TV; installation signed a copy, uploaded, installed, found the app in the TV's list and launched it ("Установлено … приложение есть в его списке"); the original file's SHA-256 is unchanged; the working copy was removed; `logs/easytizen.log` recorded start, search, connection and installation without secrets. |
| Interface (demo backend, Chromium) | Playwright scenario: search with three emulated TVs (ready, wrong Host PC IP, Developer Mode off), manual IP with wrong Host PC IP / invalid / other network, connect, choose file, install with progress, history, saved TVs (check availability, change address), legacy certificate transfer, settings without SDK remnants; Android first run at 390 px; 320 px | all steps passed, no page errors, no horizontal scroll at 390 and 320 px |
| README screenshots | `node scripts/screenshots.mjs` | all scenes re-captured in Russian and English with the new interface |

## Not verified

* **Physical Samsung TV: nothing.** Discovery, the device API answer, DUID, certificate acceptance, upload, installation, verification and launch were exercised only against the emulator. See [ACCEPTANCE-CHECKLIST.md](ACCEPTANCE-CHECKLIST.md).
* **Real Android device:** the APK was built and inspected, but not installed or run (no device; no KVM for an emulator). Interface enumeration, LAN search, the document picker and the Samsung sign-in round trip on a phone are unconfirmed.
* **Windows by hand:** the installer was cross-built and the executable inspected; it was not installed or started on Windows 10/11. The MSVC build is produced by CI only.
* **Real Samsung Account / Samsung CA** and a real signed self-update.
* **macOS** builds only in CI.

## Tested TV models

None yet. Please report results (model, year, Tizen version, EasyTizen version, phone or computer) in an issue so this table can be filled.

See [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md) for limits.
