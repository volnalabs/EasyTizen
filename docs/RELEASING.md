# Releasing EasyTizen

## Cutting a release

1. Set the new version in **three** places (they must match): `package.json`, `Cargo.toml` (`[workspace.package]`) and `src-tauri/tauri.conf.json`. Run `cargo check` so `Cargo.lock` follows, and `npm install --package-lock-only`.
2. Add a `## [X.Y.Z] — date` section to `CHANGELOG.md`. It becomes the "What changed" part of the release page.
3. Merge to `main` and wait for CI to pass.
4. GitHub → **Actions → Release → Run workflow**, enter `X.Y.Z`.

The workflow (`.github/workflows/release.yml`):

1. refuses to start if the version does not match the repository, the tag `vX.Y.Z` already exists, or the changelog section is missing;
2. runs all checks (`checks.yml`): Rust core on Linux/macOS/Windows, frontend, app backend;
3. builds one installer per platform (`build.yml`): Windows x64, macOS universal (Apple silicon + Intel), Linux AppImage, Android APK (+ AAB as a workflow artifact, never published);
4. `scripts/release.mjs verify` — all four installers present, plausibly sized, nothing unexpected;
5. writes `latest.json` (update signatures and the APK's SHA-256), renders the release notes with the SHA-256 table from `.github/release-notes.md` and removes the `.sig` files;
6. creates the tag and the GitHub Release and uploads the files.

If any check or any platform build fails, step 6 never runs: **no partial release is published.**

Published file names (do not rename — README links, the update check and release notes depend on them; `scripts/release.test.ts` enforces this):

```
EasyTizen-Android.apk
EasyTizen-Windows-x64-Setup.exe
EasyTizen-macOS.app.tar.gz
EasyTizen-Linux-x64.AppImage
latest.json
```

That is the whole release: one file per platform plus `latest.json`, the service file the in-app updater reads. Signatures are inside `latest.json`, not separate files. The macOS `.app.tar.gz` is both the download and the self-update package. Installed 0.9.x apps keep updating through `latest.json` on desktop; 0.9.x `.deb` installs and 0.9.x Android (which looked for `SHA256SUMS.txt` and `.apk.sig`) are offered the manual download once.

Permanent links: `https://github.com/volnalabs/TV-Deploy/releases/latest/download/<file>`.

The Android App Bundle (`EasyTizen-Android-GooglePlay.aab`) is deliberately not attached to the release — it cannot be installed by hand. Download it from the workflow run's artifacts (`google-play-bundle`) when uploading to Google Play.

## Code signing

Signing happens only when the secrets below exist (Settings → Secrets and variables → Actions). Without them nothing is faked; the release notes state the actual status of each platform.

### Android

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 easytizen.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password (also used as the key password) |
| `ANDROID_KEY_ALIAS` | key alias |

Create the key once and keep it safe — losing it means users must uninstall before updating:

```sh
keytool -genkeypair -v -keystore easytizen.jks -alias easytizen -keyalg RSA -keysize 4096 -validity 10000
```

Without these secrets the APK is signed with a throw-away key generated for that build (Android refuses unsigned APKs). Such builds cannot update one another.

### Windows

| Secret | Value |
|---|---|
| `WINDOWS_CERTIFICATE` | base64 of the code-signing `.pfx` |
| `WINDOWS_CERTIFICATE_PASSWORD` | its password |

The certificate is imported into the runner's user store and passed to Tauri by thumbprint. Without the secrets the installer is unsigned and SmartScreen warns. **This path has not yet run with a real certificate.**

### macOS

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | base64 of the Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | its password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Apple ID, app-specific password and team for notarization |

All six are required; then Tauri signs and notarizes. Without them the app carries an ad-hoc signature only (`signingIdentity: "-"`), and users must allow the first launch manually. **This path has not yet run with real credentials.**

### In-app updates (all platforms)

EasyTizen updates itself only from artifacts signed with the project's update key (minisign, the format of `tauri signer`). Create the key once and keep the private half safe — losing it means installed apps cannot verify future updates:

```sh
npx tauri signer generate -w easytizen-updater.key
```

| Where | Name | Value |
|---|---|---|
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | contents of `easytizen-updater.key` |
| Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |
| **Variable** (not secret) | `EASYTIZEN_UPDATER_PUBKEY` | contents of `easytizen-updater.key.pub` |

With all three, the build workflow compiles the public key into every app, signs the installers for in-app updates (`.sig` next to the Windows installer, the macOS `.app.tar.gz` and the AppImage) and the APK. The release job writes all signatures and the APK's SHA-256 into `latest.json` (read by the app from `releases/latest/download/latest.json`) and publishes no separate `.sig` files; the Android updater checks the APK against the SHA-256 and signature there.

Without the key nothing is faked: the apps are built without a public key, show new releases and link to the installer, and `release.mjs verify` refuses update artifacts that appear without a signed build. Android updates additionally require the stable Android signing key above — Android refuses an update signed differently from the installed app. **The updater path has not yet run with a real key in CI.**

## Local helpers

```sh
node scripts/release.mjs check-version 1.0.0
node scripts/release.mjs verify <folder with the four installers>
node scripts/release.mjs notes <folder> 1.0.0 notes.md
node scripts/readme-assets.mjs      # regenerate README artwork
node scripts/release.mjs updater-manifest <folder> 1.0.0   # latest.json from the .sig files
node scripts/screenshots.mjs        # regenerate RU and EN screenshots (needs `vite preview` and Playwright)
```
