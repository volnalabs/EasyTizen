# Known limitations

This page separates what is implemented from what has been confirmed, and lists real limits.

## Not yet confirmed on hardware

1. **No physical Samsung TV was available.** Discovery, connection, DUID retrieval, upload, installation, verification and launch were verified against a protocol-level TV emulator (`crates/easytizen-core/src/sdb/mock.rs`) and a stand-in for Samsung's device API, written from the SDB protocol, Samsung's tools and the independent `tizen-app-installer-cli` — not against a television. The device commands (`0 getduid`, `0 vd_appinstall`, `0 vd_applist`, `0 was_execute`) are the ones those tools use on real TVs, and the signature's `#prop` digests match theirs byte for byte, but behaviour on specific models and firmware years is unverified.
2. **No real Android device.** The APK builds; the manifest was inspected. The app has not been run on a phone: the document picker hand-off, the browser round trip for Samsung sign-in, LAN discovery on Android 14–16 and interface enumeration on vendor ROMs are unconfirmed.
3. **Samsung's services were not contacted.** OAuth and certificate issuance were tested against a local stand-in whose CA role is played by the OpenSSL CLI.
4. **Windows installer** was cross-built and its executable checked (GUI subsystem), but not installed and run on Windows by hand. macOS builds only in CI.

## Real limits of this version

* **Developer Mode and Host PC IP** are read from Samsung's device API (port 8001, TVs since 2016). A TV that does not answer it is still found through SDB when ready, but a TV with Developer Mode off is then only "not ready", without the exact reason.
* **Discovery** sweeps networks up to /22 whole and only the /24 around this device's address in larger networks; SSDP covers the rest of the broadcast domain. TVs behind another router, on a guest network or behind client isolation cannot be found — enter the IP.
* **Android multicast**: SSDP answers are unicast and need no multicast lock; some vendor ROMs may still drop them. The TCP sweep works regardless.
* **Android 17 (API 37)** makes local-network access a runtime permission for apps that target it. EasyTizen targets API 36, where this does not apply; the permission flow must be added before raising the target.
* **Samsung sign-in on Android** returns to `http://localhost:<port>`. If the phone freezes background apps aggressively, the browser page keeps loading until you switch back to EasyTizen.
* **One connection at a time** in the SDB client; no persistent connection is kept between operations. Long uploads continue while the app is in the background only as long as Android keeps the process alive.
* **App list check**: after a confirmed installation EasyTizen looks for the app in `0 vd_applist`. Its output format differs between firmwares; when it cannot be interpreted the result says "confirmed by the TV's installer" instead of "found in the app list".
* **Certificate password** is asked once per app session and never stored. A forgotten password cannot be recovered — create a new certificate.
* **Certificates from the Tizen SDK era** must be transferred once with their password. If the SDK keystore was moved, import the `.p12` files instead.
* **Signature check before installation** is structural plus, with the additional checks on and when installing as is, a comparison of the signature's file digests with the package. The RSA signature value and the certificate chain are not validated — the TV does that.
* **Additional package checks are not an antivirus.**
* **Only `.wgt`** packages are supported (`.tpk` is not).
* **Self-update needs the project's update key** (see RELEASING.md); local builds only link to the installer. Android self-update requires a stable signing key.
* **Product name**: the app is still called EasyTizen and keeps its identifier and release file names, so existing installations update in place.

## Release gate

`1.0.0` must not be published until the hands-on [acceptance checklist](ACCEPTANCE-CHECKLIST.md) is completed on at least one physical Samsung TV with both the desktop and the Android app.
