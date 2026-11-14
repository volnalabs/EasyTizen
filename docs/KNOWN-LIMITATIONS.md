# Known limitations — EasyTizen 0.9

This page separates what is implemented from what has been confirmed, and lists real limits.

## Not yet confirmed on hardware

1. **No physical Samsung TV was available.** Connection, DUID retrieval, installation and launch were verified against a protocol-level TV emulator (`crates/easytizen-core/src/sdb/mock.rs`) written from the SDB protocol and Samsung's tools — not against a television. The exact device commands (`0 getduid`, `0 vd_appinstall`, `0 was_execute`) are the ones Samsung's tooling uses, but their behaviour on specific models and firmware years is unverified.
2. **No real Android device.** The APK and AAB build (arm64 and armv7) and the manifest was inspected, but the app has not been run on a phone. In particular: the document picker → backend hand-off, the system browser round trip for Samsung sign-in, and LAN access on Android 14–16.
3. **Samsung's services were not contacted.** OAuth and certificate issuance were tested against a local stand-in whose CA role is played by the OpenSSL CLI. The request shapes follow Samsung's open-source CLI; a real Samsung Account sign-in and a real certificate were not exercised.
4. **Windows and macOS installers** are built only in CI; they have not been installed and run by hand. The Linux `.deb`/AppImage were built locally and the binary was started under Xvfb.
5. **The SDK engine's end-to-end path** (official `tz pack` signing and Samsung CLI install) still relies on the mock-`sdb` test inherited from 0.1 — no real SDK installation (15 GB) was performed in the authoring environment.

## Real limits of this version

* **Built-in engine is experimental.** Its signatures are verified by `xmlsec1`, but a TV is the final judge. Desktop defaults to the official Samsung tools for that reason.
* **Android 17 (API 37)** makes local-network access a runtime permission for apps that target it. EasyTizen targets API 36, where this does not apply. The permission flow must be added before raising the target.
* **Samsung sign-in on Android** returns to `http://localhost:<port>`. If the phone freezes background apps aggressively, the browser page keeps loading until you switch back to EasyTizen.
* **TV discovery** scans one /24 subnet of the primary interface. Larger or segmented networks need the TV's address typed in.
* **One connection at a time** in the built-in SDB client; no persistent connection is kept between operations.
* **Certificate password** (built-in engine) is asked once per app session and never stored. A forgotten password cannot be recovered — create a new certificate.
* **Certificates are per engine.** Moving between the SDK keystore and the built-in store means importing the `.p12` files.
* **Uninstalling an app from the TV** from within EasyTizen is available in the built-in engine only.
* **macOS + official tools** needs Bash 4+ (`brew install bash`); EasyTizen reports this but does not install it.
* **Signature check before installation** is structural plus, with the additional checks on and when installing as is, a comparison of the signature's file digests with the package. The RSA signature value and the certificate chain are not validated — the TV does that.
* **Additional package checks are not an antivirus.** They check identity and consistency (app ID, start page, executables for other systems, duplicate names, existing signature digests). They cannot tell whether a web app's JavaScript is benign.
* **Self-update needs the project's update key.** Only builds made by CI with `TAURI_SIGNING_PRIVATE_KEY` and `EASYTIZEN_UPDATER_PUBKEY` can update themselves; 0.9.0 and local builds show new releases and link to the installer. The signed path was tested locally with a throw-away key and in unit tests, not yet in a real release.
* **What "automatic" means per platform.** Windows: the update is downloaded and verified automatically; the installer runs after you confirm, because it closes the app. macOS and AppImage: installed on disk automatically (not while a TV operation runs), active after a restart you confirm. `.deb`/`.rpm`: installed through the package manager after you confirm (an administrator prompt appears). Android: downloaded and verified automatically; Android's installer always asks you, and once you must allow installs from EasyTizen.
* **Android self-update requires a stable signing key.** APKs signed with a per-build throw-away key cannot update each other; Android reports a conflict. Installs from Google Play are never updated by EasyTizen. For a Google Play build, `REQUEST_INSTALL_PACKAGES` needs a Play policy declaration or must be removed.
* **Android 130 % font size and larger:** bottom-bar labels may be shortened with an ellipsis on phones narrower than 412 px (the full name stays available to screen readers).
* **Right-to-left languages** are not supported; layouts use logical alignment where it matters, but no RTL locale has been tested.
* **Code signing** of Windows/macOS builds and a stable Android key depend on repository secrets (see RELEASING.md). Without them: unsigned Windows installer, ad-hoc signed macOS app, Android APK signed with a per-build throw-away key.
* **Node.js runtime integrity** (desktop) is checked against the SHA-256 published over HTTPS by nodejs.org; the GPG signature of that list is not verified.
* **Only `.wgt`** packages are supported.

## Not verified for this redesign

* The redesign was checked in Chromium (Playwright) at phone and desktop sizes, not in the Android System WebView of a real phone or in WebKitGTK/WKWebView/WebView2 windows of the packaged desktop apps (the Linux build was started under Xvfb only).
* The Android font-size following (`textZoom`) and the APK hand-over to the system installer were built but not run on a device.

## Release gate

`1.0.0` must not be published until the hands-on [acceptance checklist](ACCEPTANCE-CHECKLIST.md) is completed on at least one physical Samsung TV with both the desktop and the Android app.
