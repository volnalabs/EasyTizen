# Test report — EasyTizen 0.9.1

Date: 2026-11-14. Environment of the local runs: Linux x86_64 (Ubuntu 24.04 container), Rust 1.97, Node.js 22.23, OpenSSL 3, xmlsec1, Android SDK platform 36 / NDK 27.2.

This report states what was actually run and what it proves. Anything not listed under "Verified" has not been verified.

## Verified automatically (all passing)

| Suite | Command | Result |
|---|---|---|
| Core (`easytizen-core`) | `EASYTIZEN_REQUIRE_INTEROP=1 cargo test --workspace --features easytizen-core/mock-tv` | 79 tests passed (68 before the redesign) |
| App backend (`easytizen`) | same command | 24 tests passed (18 before) |
| Interface and release scripts | `npm test` | 27 tests passed (13 before) |
| Types | `npm run typecheck` | no errors |
| Lints | `cargo fmt --all -- --check`; `cargo clippy --workspace --all-targets --features easytizen-core/mock-tv -- -D warnings`; the same for `-p easytizen` with `EASYTIZEN_UPDATER_PUBKEY` set (updater code path compiled in) | clean |
| Android Rust code | `cargo clippy -p easytizen --lib --target aarch64-linux-android` and `armv7-linux-androideabi`, with and without an update key, `-D warnings` | clean |

What the important tests establish:

* **SDB client ↔ TV emulator** — handshake, `capability:`, DUID retrieval, a 300 kB byte-exact push, device-side refusal of a bad path, install → launch, cleanup of the uploaded copy, cancellation, recognition of Android ADB endpoints. The emulator is our own implementation of the device side, so this proves internal consistency and correct framing, **not** behaviour of a real TV.
* **WGT signing verified by an independent implementation** — keys and `.p12` files are produced by the OpenSSL CLI with the flags Samsung's CLI uses; both signature documents are then verified by `xmlsec1`, and a tampered file makes verification fail. This proves the XML-DSig output is cryptographically valid.
* **Certificate issuance against an OpenSSL stand-in** — our CSRs are checked (`openssl req -verify`) and signed by OpenSSL acting as the CA; the test asserts the endpoint order, form fields, RSA-2048/SHA-512, and the `URN:tizen:deviceid=` SAN, then signs a package with the issued pair and installs it on the emulator. Keystores written by EasyTizen are read back by OpenSSL. Samsung's real service is **not** contacted.
* **A package signed for one TV is refused by another** (emulated DUID check).
* **WGT safety** — zip-slip names, DTD/entity bombs, oversized XML, non-ZIP input, duplicate entries; the original file is byte-identical after inspection and signing.
* **SDK installer** — progress parsing, streaming of stdout/stderr, failure reporting, and cancellation that stops the installer's background children (process group kill). This test caught a real defect during development.
* **Samsung OAuth callback** — loopback round trip, single decoding of the `code` value, timeout, cancellation, token redaction in debug output.
* **Settings upgrade** from the TV Deploy 0.1 schema and **data-folder migration** from the old identifier.
* **Additional package checks** (`checks.rs`, `api::package_gate`) — app-ID rules, missing start page (advisory), ELF/PE/Mach-O recognised by content, duplicate names found in the raw central directory, existing signature digests verified/mismatched/incomplete when installing as is. With the checks **on**, a blocking finding refuses installation even if a skip was "confirmed"; with them **off**, installation is refused without confirmation and allowed with it. Zip slip, a DTD/entity bomb, a missing `config.xml`, a non-ZIP file and an oversized `config.xml` are refused in **every** combination of setting and confirmation.
* **Settings** — a 0.9 settings file loads with the additional checks on and keeps the user's existing update choice; both new settings survive save/load.
* **Updates** — GitHub release parsing drops assets that are not this repository's downloads; `SHA256SUMS.txt` parsing; minisign signatures made by `tauri signer` verify and a one-byte change fails; status reports only newer releases; the manifest URL is the official release location; builds without the key report no self-update. Frontend: with automatic updates off no timer is created at all; on, the first check runs after 8 s and then every 6 h; only automatic checks of installable updates start a download.
* **Localisation** — every finding code in `checks.rs`, every update error and manual-update reason in the Rust sources has Russian and English text; no string calls the checks an antivirus; bottom-bar labels stay within the measured limit.
* **Release tooling** — a release is blocked when an installer is missing, too small or unexpected; every published file name appears in both READMEs, the release notes template and the in-app update check; repository versions agree.

## Verified by building and running locally

| Target | What was done | Result |
|---|---|---|
| Linux `.deb` and `.AppImage` | `npx tauri build --bundles deb,appimage` | built: 48 MB and 118 MB; package `easy-tizen`, depends on `libwebkit2gtk-4.1-0`, `libgtk-3-0` |
| Linux binary | started under Xvfb; window captured (`docs/img/linux-window.png`) | starts, first-run guide rendered, data folder `io.github.volnalabs.easytizen` created |
| Android APK + AAB (arm64 + armv7) | `npx tauri android build --apk --aab --target aarch64 armv7` with a throw-away signing key, as CI does | built: APK 18 MB, AAB 9.7 MB; `apksigner verify` passes; `aapt2` shows package `io.github.volnalabs.easytizen`, version 0.9.0, permissions INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE; no Samsung CLI inside |
| Signed Linux build | `npx tauri build --bundles appimage,deb` with `createUpdaterArtifacts`, a throw-away update key and `EASYTIZEN_UPDATER_PUBKEY` | AppImage (125 MB) and `.deb` (51 MB) plus `.AppImage.sig` and `.deb.sig`; both verify with EasyTizen's own `verify_minisign`, a modified `.deb` fails; the signature's trusted comment carries `version:0.9.0` (hence `requireSignedVersion`); `release.mjs` builds `latest.json` from them. This build found that the bundler needs `plugins.updater` in the config — fixed in `build.yml` |
| Linux binary (redesign) | started under Xvfb (WebKitGTK); window captured to `docs/img/linux-window.png` | first-run guide renders with the bundled Inter font |
| Interface | `scripts/screenshots.mjs` drives the real frontend (demo backend) through 28 scenes per language | all scenes rendered in Russian and English without console errors |
| Visual audit | Playwright at 320, 360, 375, 390, 412, 480 px (phone layout) and 1024×640, 1280×720, 1366×768, 1440×900, 1920×1080, RU and EN, 14 screens each (308 captures); every element checked for horizontal overflow, clipped text and touch targets < 32 px | 0 page overflows, 0 clipped labels, 0 small targets. Before the redesign: 325 clipped labels and 157 small targets on phones. Extra states checked by hand: connection diagnosis, failed additional checks, install without checks, light theme, 130 % font size at 320/360 px, 768 px tablet |

## Attempted, blocked by the environment

* **Android APK build.** `npx tauri android build --apk --target aarch64 armv7` stopped while Gradle configured `buildSrc`: Maven Central answered the sandbox with HTTP 429 and spurious 404s on HEAD requests (`kotlin-stdlib:2.3.21` and other Kotlin artifacts), even with retries and a local pre-fetch. Nothing in the project was changed for this. The Rust side for both Android targets passes clippy; the Kotlin plugin (`ApkInstallerPlugin.kt`) and the manifest change were **not compiled** here — CI builds the APK on GitHub's runners.

## Not verified

* **Physical Samsung TV:** nothing — connection, DUID, certificate acceptance, installation, launch.
* **Real Android device:** the APK was not installed or run; the redesigned UI was not seen in the Android System WebView, the system-font following and the APK hand-over to the package installer did not run.
* **The update itself:** no signed release exists yet, so no app has downloaded and applied an update (restart, Windows installer, `.deb` via pkexec, Android installer). Checking, signature verification and manifest generation were exercised as described above.
* **Other webviews:** the redesign was reviewed in Chromium and briefly in WebKitGTK; WKWebView (macOS) and WebView2 (Windows) were not checked.
* **Real Samsung Account / Samsung CA.**
* **Windows and macOS:** installers are produced by CI only; not run by hand. Code-signing steps in CI have never run with real certificates.
* **Real Tizen SDK installation** through the app (15 GB download) and the SDK engine's signing/installing with the genuine `tz`/`sdb`.

## Tested TV models

None yet. Please report results (model, year, Tizen version, EasyTizen version, engine) in an issue so this table can be filled.

See [ACCEPTANCE-CHECKLIST.md](ACCEPTANCE-CHECKLIST.md) for the hands-on checks and [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md) for limits.
