# Hands-on acceptance checklist

**Status: NOT YET EXECUTED on a physical TV.** Record the TV model and year, Tizen version, host device and OS, and the EasyTizen build for every run. Do not tick a box on the strength of automated tests.

Preparation: TV and test device on the same router; note the TV's IP (Settings → General → Network → Network Status). Keep a `.wgt` that is known to work (for example a self-built "hello world" web app) and its SHA-256.

## A. Android app — no computer involved

- [ ] APK installs on Android 7–16; app starts; the "Host PC IP for the TV" box shows the phone's Wi-Fi address (compare with Settings → Wi-Fi → network details).
- [ ] With Wi-Fi off (mobile data only): the box says Wi-Fi is off; "Find TVs" reports "No local network".
- [ ] Switching to another Wi-Fi and returning to the app updates the address.
- [ ] "Find TVs" with Developer Mode **off**: the TV is listed as "Developer Mode off" (TV 2016+). Connecting shows the readiness list with Developer Mode ✗.
- [ ] Developer Mode on with **another** Host PC IP: listed as "Wrong Host PC IP"; the explanation names both addresses.
- [ ] Developer Mode on with the phone's IP, TV restarted: listed as "Ready" with model and Tizen version; progress bar moves; Cancel stops the search.
- [ ] Connect by IP works; model, Tizen version and DUID are shown; the TV is saved.
- [ ] Wrong IP in the same network → "The TV is not answering"; IP of another network → "another network"; `300.1.1.1` → input error.
- [ ] Picking a `.wgt` through the system picker (Downloads, a cloud folder) shows its details; a non-WGT file is rejected with a clear message; returning from the picker keeps the connected TV.
- [ ] "Create certificate" opens Samsung sign-in in the browser; after signing in and returning to the app the certificate appears. Note whether the app had to be brought to the foreground manually.
- [ ] Install: stages advance; upload percentage moves; installation percentage moves; "Checking the result"; success says the TV lists the app; **the app appears on the TV and launches**.
- [ ] Turn Wi-Fi off during the upload: the installation fails with a clear message, history records it, and after reconnecting a retry succeeds.
- [ ] Cancel during the upload: no app installed; retry works.
- [ ] After restarting the app, installing asks for the certificate password once; a wrong password is reported as such.
- [ ] A package signed for TV A is refused by TV B with the "signature rejected" message.
- [ ] Installing over an app signed by another author offers "Remove the old copy…", which works.
- [ ] Saved TVs: rename, change address, "Check availability", forget — all persist after restarting the app.
- [ ] History shows app, file, TV, IP, date, time, result and the TV's error text.
- [ ] Minimise the app during an installation for 30 s and return: the installation finished or failed with a message, never stuck.
- [ ] Rotation, dark/light theme, Russian/English, back gesture, 320 px width, font size 130 %.

## B. Windows 10 and 11 (x64), standard user account

- [ ] Installer runs without administrator rights; the app starts **without a console window** (also when started from the Start menu and from Explorer).
- [ ] No console window appears during search, connection, certificate creation, signing, installation or an update.
- [ ] The Windows firewall prompt appears on the first search (private network allowed); with the network set to "Public" the TCP search still finds the TV.
- [ ] The same flow as in section A (search, manual IP, diagnostics, certificate, install, verify, launch) succeeds from the computer.
- [ ] A `.wgt` in a folder with Cyrillic letters and spaces (e.g. `C:\Users\Иван\Мои приложения\Тест app.wgt`) installs; the original file is byte-identical afterwards (compare SHA-256).
- [ ] Settings → Diagnostics → "Open log folder" opens a folder with `easytizen.log`; the log contains the search and installation lines and no passwords or tokens.
- [ ] Two network adapters (Ethernet + Wi-Fi) or a VPN: the Host PC IP shown is the LAN address; the search finds the TV.
- [ ] Upgrade from 0.9.x with an SDK-engine certificate: the profile shows "Needs transfer"; "Transfer" with the password moves it and installation works; the Tizen SDK folder is unchanged.

## C. macOS and Linux

- [ ] `.dmg` (Apple silicon, Intel), `.deb` and AppImage install and start; the section A flow succeeds.

## D. Cross-cutting

- [ ] Additional checks on (default): a package with a native executable or a broken app ID is blocked with an explanation; a clean package installs.
- [ ] Turning the additional checks off asks for confirmation; every installation then asks to confirm; a zip-slip or DTD package is still refused.
- [ ] Self-update with a signed release (desktop and Android): found, downloaded, verified, applied after confirmation; never while a TV installation runs; TVs, certificates and settings kept.
- [ ] Keyboard only: every control reachable, visible focus, dialogs keep focus inside and return it.
- [ ] Diagnostics report contains no passwords, tokens or full DUIDs; Copy and Save work.
- [ ] Release workflow publishes exactly six installers plus `SHA256SUMS.txt`; every `releases/latest/download/…` link in the README downloads a file.
