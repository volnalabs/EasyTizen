<div align="center">

<img src="docs/readme/hero-en.svg" width="100%" alt="EasyTizen — the easy way to install apps on Samsung Smart TVs">

<br><br>

<a href="README.md"><img src="docs/readme/lang-ru.svg" width="49%" alt="🇷🇺 Русская версия"></a>&nbsp;<a href="README.en.md"><img src="docs/readme/lang-en-active.svg" width="49%" alt="🇬🇧 English version — you are reading it"></a>

<br>

[![Latest version](https://img.shields.io/github/v/release/volnalabs/TV-Deploy?label=version&color=3F5BF6&style=for-the-badge)](https://github.com/volnalabs/TV-Deploy/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/volnalabs/TV-Deploy/ci.yml?branch=main&label=build&style=for-the-badge&color=1E2230)](https://github.com/volnalabs/TV-Deploy/actions/workflows/ci.yml)
[![Downloads](https://img.shields.io/github/downloads/volnalabs/TV-Deploy/total?label=downloads&color=1E2230&style=for-the-badge)](https://github.com/volnalabs/TV-Deploy/releases)
[![License Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1E2230?style=for-the-badge)](LICENSE)

**[Download](#download)** &nbsp;·&nbsp; [Features](#features) &nbsp;·&nbsp; [Screenshots](#look) &nbsp;·&nbsp; **[Installation](#install)** &nbsp;·&nbsp; [Android](#android) &nbsp;·&nbsp; [Windows](#windows) &nbsp;·&nbsp; [macOS](#macos) &nbsp;·&nbsp; [Linux](#linux) &nbsp;·&nbsp; [Samsung TV](#samsung-tv) &nbsp;·&nbsp; [FAQ](#faq) &nbsp;·&nbsp; [For developers](#dev)


<br>

<img src="docs/img/en/desktop-check.png" width="100%" alt="EasyTizen: TV connected, package checked, ready to install">

<sub>The TV is connected and the file passed the mandatory and the additional checks — press “Install on TV”.</sub>

</div>

> [!IMPORTANT]
> **Status: preview.** Every feature is implemented and covered by automated tests (including tests against a protocol-level TV emulator), but installation on a **physical Samsung TV** and operation on a **real Android device** have not yet been confirmed by the author. What was verified and how is listed in the [test report](docs/TEST-REPORT.md); what still needs hands-on verification is in the [checklist](docs/ACCEPTANCE-CHECKLIST.md).

EasyTizen works right after installation: **no Tizen SDK, no Tizen Studio, no Node.js or Python, no 15 GB download.** TV discovery, Samsung certificates, signing and `.wgt` installation are done by its own built-in engine — the same on Windows, macOS, Linux and Android.

EasyTizen is an independent open-source tool. It ships no TV apps and downloads none for you: you always choose the `.wgt` file yourself.

<p align="center"><img src="docs/readme/divider.svg" width="100%" height="24" alt=""></p>

<a name="download"></a>

## <img src="docs/readme/s-download.svg" width="36" height="36" align="top" alt=""> Download

<table>
<tr>
<td width="50%"><a href="https://github.com/volnalabs/TV-Deploy/releases/latest/download/EasyTizen-Android.apk"><img src="docs/readme/d-android-en.svg" width="100%" alt="EasyTizen-Android.apk — Android"></a></td>
<td width="50%"><a href="https://github.com/volnalabs/TV-Deploy/releases/latest/download/EasyTizen-Windows-x64-Setup.exe"><img src="docs/readme/d-windows-en.svg" width="100%" alt="EasyTizen-Windows-x64-Setup.exe — Windows"></a></td>
</tr>
<tr>
<td width="50%"><a href="https://github.com/volnalabs/TV-Deploy/releases/latest/download/EasyTizen-macOS.app.tar.gz"><img src="docs/readme/d-mac-en.svg" width="100%" alt="EasyTizen-macOS.app.tar.gz — macOS (Apple silicon and Intel)"></a></td>
<td width="50%"><a href="https://github.com/volnalabs/TV-Deploy/releases/latest/download/EasyTizen-Linux-x64.AppImage"><img src="docs/readme/d-appimage-en.svg" width="100%" alt="EasyTizen-Linux-x64.AppImage — Linux"></a></td>
</tr>
<tr>
<td colspan="2"><a href="https://github.com/volnalabs/TV-Deploy/releases"><img src="docs/readme/p-all-en.svg" width="50%" alt="All versions and source code"></a></td>
</tr>
</table>

The links always point at the latest version. Not sure which one to take? See [Installation](#install). SHA-256 checksums are on every [release](https://github.com/volnalabs/TV-Deploy/releases) page.

<p align="center"><img src="docs/readme/divider.svg" width="100%" height="24" alt=""></p>

<a name="features"></a>

## <img src="docs/readme/s-features.svg" width="36" height="36" align="top" alt=""> Features

<table>
<tr>
<td width="50%" valign="top">

<img src="docs/readme/f-phone.svg" width="52" height="52" align="left" alt="">

**Works straight from a phone**<br>
The Android app does everything itself — search, certificate, signing, installation — no computer, no Termux.

</td>
<td width="50%" valign="top">

<img src="docs/readme/f-sdk.svg" width="52" height="52" align="left" alt="">

**Nothing else to download**<br>
Its own engine: no Tizen SDK, no Tizen Studio, no external programs. Install it and start.

</td>
</tr>
<tr>
<td width="50%" valign="top">

<img src="docs/readme/f-scan.svg" width="52" height="52" align="left" alt="">

**Finds TVs on the network**<br>
All network interfaces, SSDP and Samsung's device service: finds TVs even with Developer Mode off and says what to set up.

</td>
<td width="50%" valign="top">

<img src="docs/readme/f-ip.svg" width="52" height="52" align="left" alt="">

**Connect by IP, with diagnostics**<br>
Checks the network, Developer Mode and Host PC IP one by one and says exactly what to fix.

</td>
</tr>
<tr>
<td width="50%" valign="top">

<img src="docs/readme/f-duid.svg" width="52" height="52" align="left" alt="">

**Reads the DUID**<br>
Fetches the TV's device ID that Samsung needs to issue a certificate.

</td>
<td width="50%" valign="top">

<img src="docs/readme/f-cert.svg" width="52" height="52" align="left" alt="">

**Creates certificates**<br>
Sign in to your Samsung Account in the browser — the certificate for one or several TVs is ready.

</td>
</tr>
<tr>
<td width="50%" valign="top">

<img src="docs/readme/f-import.svg" width="52" height="52" align="left" alt="">

**Imports certificates**<br>
Already have `author.p12` and `distributor.p12` from Tizen Studio? Plug them in.

</td>
<td width="50%" valign="top">

<img src="docs/readme/f-check.svg" width="52" height="52" align="left" alt="">

**Two-layer WGT checks**<br>
Always: archive structure, zip-bomb and path-traversal protection, safe XML. Additionally (can be turned off): app ID, start page, embedded programs, existing signature.

</td>
</tr>
<tr>
<td width="50%" valign="top">

<img src="docs/readme/f-sign.svg" width="52" height="52" align="left" alt="">

**Signs apps**<br>
Signs a temporary copy with your certificate. Your original file is never changed.

</td>
<td width="50%" valign="top">

<img src="docs/readme/f-install.svg" width="52" height="52" align="left" alt="">

**Installs, verifies and launches**<br>
Streams the package with real progress, shows the TV's own install progress, checks the TV's app list, starts the app.

</td>
</tr>
<tr>
<td width="50%" valign="top">

<img src="docs/readme/f-devices.svg" width="52" height="52" align="left" alt="">

**Several TVs**<br>
Saves devices and their names; one certificate can cover several TVs.

</td>
<td width="50%" valign="top">

<img src="docs/readme/f-history.svg" width="52" height="52" align="left" alt="">

**Installation history**<br>
What was installed where and with what result — including the TV's error text.

</td>
</tr>
<tr>
<td width="50%" valign="top">

<img src="docs/readme/f-diag.svg" width="52" height="52" align="left" alt="">

**Diagnostics**<br>
A report without passwords or keys: copy it or save it to a file for a bug report.

</td>
<td width="50%" valign="top">

<img src="docs/readme/f-update.svg" width="52" height="52" align="left" alt="">

**Automatic updates**<br>
Downloads and verifies a signed update and applies it on restart. On Android — through the system installer. Can be turned off in Settings.

</td>
</tr>
</table>

> [!NOTE]
> You need a free Samsung Account (for the certificate) and a Samsung Tizen TV with Developer Mode. No ads, no accounts of our own, no data collection — see [privacy](#privacy).

<p align="center"><img src="docs/readme/divider.svg" width="100%" height="24" alt=""></p>

<a name="look"></a>

## <img src="docs/readme/s-look.svg" width="36" height="36" align="top" alt=""> Screenshots

### On desktop (Windows, macOS, Linux)

<table>
<tr>
<td width="50%" valign="top"><img src="docs/img/en/desktop-welcome.png" alt="First launch"><br><sub><b>First launch.</b> Three steps, language choice, light theme</sub></td>
<td width="50%" valign="top"><img src="docs/img/en/desktop-find.png" alt="Finding a TV"><br><sub><b>Finding the TV.</b> Network search, manual address and saved devices</sub></td>
</tr>
<tr>
<td valign="top"><img src="docs/img/en/desktop-connected.png" alt="TV connected"><br><sub><b>TV connected.</b> Model and Device ID (DUID) with copy</sub></td>
<td valign="top"><img src="docs/img/en/desktop-check.png" alt="Package check"><br><sub><b>WGT check.</b> Mandatory file safety plus the additional checks</sub></td>
</tr>
<tr>
<td valign="top"><img src="docs/img/en/desktop-progress.png" alt="Installing"><br><sub><b>Installation.</b> Stages: signing, sending, installing, launching</sub></td>
<td valign="top"><img src="docs/img/en/desktop-success.png" alt="Installed"><br><sub><b>Done.</b> The app is installed and running</sub></td>
</tr>
<tr>
<td valign="top"><img src="docs/img/en/desktop-cert-new.png" alt="New certificate"><br><sub><b>Certificate.</b> Pick the TVs and a password — then sign in to Samsung in the browser</sub></td>
<td valign="top"><img src="docs/img/en/desktop-tvs.png" alt="TVs"><br><sub><b>TVs.</b> Names, addresses, DUIDs and last connection</sub></td>
</tr>
<tr>
<td valign="top"><img src="docs/img/en/desktop-updates.png" alt="Updates"><br><sub><b>Updates.</b> Automatic mode, last check, verified signature</sub></td>
<td valign="top"><img src="docs/img/en/desktop-security.png" alt="Security check"><br><sub><b>Security.</b> Turning the additional checks off requires confirmation</sub></td>
</tr>
</table>

### On Android

<table>
<tr>
<td width="25%" valign="top"><img src="docs/img/en/android-welcome.png" alt="First launch"><br><sub><b>First launch</b></sub></td>
<td width="25%" valign="top"><img src="docs/img/en/android-home.png" alt="Home"><br><sub><b>Home</b></sub></td>
<td width="25%" valign="top"><img src="docs/img/en/android-find.png" alt="Finding a TV"><br><sub><b>Finding the TV</b></sub></td>
<td width="25%" valign="top"><img src="docs/img/en/android-connected.png" alt="Connected"><br><sub><b>Connected</b></sub></td>
</tr>
<tr>
<td valign="top"><img src="docs/img/en/android-package.png" alt="WGT chosen"><br><sub><b>File chosen</b></sub></td>
<td valign="top"><img src="docs/img/en/android-check.png" alt="Package check"><br><sub><b>Package check</b></sub></td>
<td valign="top"><img src="docs/img/en/android-progress.png" alt="Installing"><br><sub><b>Progress</b></sub></td>
<td valign="top"><img src="docs/img/en/android-success.png" alt="Installed"><br><sub><b>Installed</b></sub></td>
</tr>
<tr>
<td valign="top"><img src="docs/img/en/android-settings.png" alt="Settings"><br><sub><b>Settings</b></sub></td>
<td valign="top"><img src="docs/img/en/android-updates.png" alt="Updates"><br><sub><b>Updates</b></sub></td>
<td valign="top"><img src="docs/img/en/android-security.png" alt="Security"><br><sub><b>Security check</b></sub></td>
<td valign="top"><img src="docs/img/en/android-devmode.png" alt="Developer Mode"><br><sub><b>TV guide</b> with the phone's address</sub></td>
</tr>
</table>

<sub>About the screenshots: this is EasyTizen's real interface in English, captured automatically (<code>scripts/screenshots.mjs</code>) in demo mode — the TV, the certificate, the <i>My App</i> package and the newer release are emulated, and the “Demo” label is visible. They were taken in a browser at desktop-window and phone-screen sizes; the app has not yet been photographed on a real phone and TV. The packaged Linux app in a test environment: <a href="docs/img/linux-window.png">linux-window.png</a>. Russian screenshots are in the <a href="README.md#look">Russian version</a>.</sub>

<p align="center"><img src="docs/readme/divider.svg" width="100%" height="24" alt=""></p>

<a name="install"></a>

## <img src="docs/readme/s-install.svg" width="36" height="36" align="top" alt=""> Installation

Install EasyTizen on your device first, then prepare the TV and run your first installation.

<table>
<tr>
<td width="50%"><a href="#android"><img src="docs/readme/p-android-en.svg" width="100%" alt="Android"></a></td>
<td width="50%"><a href="#windows"><img src="docs/readme/p-windows-en.svg" width="100%" alt="Windows"></a></td>
</tr>
<tr>
<td width="50%"><a href="#macos"><img src="docs/readme/p-macos-en.svg" width="100%" alt="macOS"></a></td>
<td width="50%"><a href="#linux"><img src="docs/readme/p-linux-en.svg" width="100%" alt="Linux"></a></td>
</tr>
<tr>
<td width="50%"><a href="#samsung-tv"><img src="docs/readme/p-tv-en.svg" width="100%" alt="Samsung TV"></a></td>
<td width="50%"><a href="#first-install"><img src="docs/readme/p-first-en.svg" width="100%" alt="First installation"></a></td>
</tr>
</table>

| | Android | Desktop |
|---|---|---|
| Extra downloads | none | none |
| Who signs and installs | EasyTizen's built-in engine | EasyTizen's built-in engine |
| Samsung Account | needed for the certificate | needed for the certificate |
| Network | Wi-Fi, the TV's network | Wi-Fi or cable, the TV's network |

> [!IMPORTANT]
> **The computer or phone and the TV must reach each other on one local network** — connected to the same router (Wi-Fi or cable). These do not work: mobile data on the phone, guest Wi-Fi, a network with client isolation, a VPN that captures all traffic, or a second router that creates a separate network. EasyTizen shows its own address and warns when the TV is in another network.

<a name="android"></a>

### <img src="docs/readme/s-android.svg" width="28" height="28" align="top" alt=""> Android

A phone or tablet with Android 7.0 or newer. No computer needed.

1. Download [`EasyTizen-Android.apk`](https://github.com/volnalabs/TV-Deploy/releases/latest/download/EasyTizen-Android.apk) on the phone.
2. Open the file. If Android asks about “unknown sources”, allow installation for the browser or file manager you open it from.
3. Start EasyTizen and go through the welcome guide. The phone must be on the same Wi-Fi network as the TV (not mobile data, not a guest network).
4. **The TV's Host PC IP is the phone's address**, not a computer's. EasyTizen shows it above the “Find TVs” button and refreshes it when you return to the app after switching Wi-Fi networks.

| Permission | Why |
|---|---|
| Network access | talking to the TV on the local network (ports `26101` and `8001`) and to Samsung's certificate service |
| Network and Wi-Fi state | knowing the phone is online before searching for TVs |

No other permissions are requested: the `.wgt` file is picked through the system document picker.

> [!WARNING]
> If an APK was built without the project's permanent key (the release notes say so), a new version cannot be installed over the old one: Android asks you to uninstall first. Uninstalling removes the app's certificates — create them again or import your `.p12` files.

<sub><a href="#install">↑ back to devices</a></sub>

<a name="windows"></a>

### <img src="docs/readme/s-windows.svg" width="28" height="28" align="top" alt=""> Windows

Windows 10 and 11, 64-bit.

1. Download [`EasyTizen-Windows-x64-Setup.exe`](https://github.com/volnalabs/TV-Deploy/releases/latest/download/EasyTizen-Windows-x64-Setup.exe) and run it.
2. It installs for the current user; administrator rights are not required.
3. On the first TV search Windows may ask about network access — allow it for **private** networks. If your home network is marked “Public”, the firewall may block discovery (SSDP) — switch it to “Private” in the network settings.

The app starts like any Windows program, without a black console window. Errors go to a log file — **Settings → Diagnostics → “Open log folder”**.

> [!NOTE]
> Until the installer is signed with a publisher certificate, SmartScreen shows “Windows protected your PC”. Click **More info → Run anyway**. Whether a particular release is signed is stated in its release notes.

<sub><a href="#install">↑ back to devices</a></sub>

<a name="macos"></a>

### <img src="docs/readme/s-macos.svg" width="28" height="28" align="top" alt=""> macOS

macOS 10.15 or newer.

1. Download [`EasyTizen-macOS.app.tar.gz`](https://github.com/volnalabs/TV-Deploy/releases/latest/download/EasyTizen-macOS.app.tar.gz) — one file for Macs with Apple silicon and Intel.
2. Double-click it (Safari often unpacks it by itself) — **EasyTizen** appears. Drag it to Applications.
3. **First launch.** Until the app is notarized by Apple, macOS blocks it. Open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to the EasyTizen message.

If macOS says the app is damaged, run in Terminal:

```sh
xattr -cr /Applications/EasyTizen.app
```

<sub><a href="#install">↑ back to devices</a></sub>

<a name="linux"></a>

### <img src="docs/readme/s-linux.svg" width="28" height="28" align="top" alt=""> Linux

64-bit, with WebKitGTK 4.1 (Ubuntu 22.04+, Debian 12, Fedora 38+).

One file for every distribution — an AppImage, nothing to install:

```sh
chmod +x EasyTizen-Linux-x64.AppImage
./EasyTizen-Linux-x64.AppImage
```

If it does not start on Ubuntu 22.04 or newer, install `libfuse2`: `sudo apt install libfuse2`. The AppImage updates itself.

> [!NOTE]
> The `.deb` package is no longer published. If you installed EasyTizen from the `.deb`, remove it (`sudo apt remove easy-tizen`) and use the AppImage — your settings, TVs and certificates are kept.

<sub><a href="#install">↑ back to devices</a></sub>

<a name="samsung-tv"></a>

### <img src="docs/readme/s-tv.svg" width="28" height="28" align="top" alt=""> Samsung TV: Developer Mode

Samsung TVs do not install apps from a USB stick. An app that is not in the store is installed over the network through Developer Mode.

#### <img src="docs/readme/step-1.svg" width="28" height="28" align="top" alt="Step 1"> Find the address of the device running EasyTizen

EasyTizen shows it — in the **“Host PC IP for the TV”** box above the search button, in the welcome guide and in **“How to enable Developer Mode”**. It looks like `192.168.1.23` — the TV will trust this address. Installing from a phone, it is the phone's address; from a computer, the computer's. The TV remembers only one.

To look it up yourself: Windows — `ipconfig` (the “IPv4 Address” of the Wi-Fi or Ethernet adapter); macOS — System Settings → Network; Linux — `ip -4 addr`; Android — Settings → Wi-Fi → your network → IP address.

#### <img src="docs/readme/step-2.svg" width="28" height="28" align="top" alt="Step 2"> Turn Developer Mode on

1. Open **Apps** on the TV.
2. Press **1 2 3 4 5** on the remote. No number keys? Press **123** and enter them on screen.
3. Switch **Developer Mode** on.
4. Enter the address from step 1 as **Host PC IP**.
5. Press OK.

#### <img src="docs/readme/step-3.svg" width="28" height="28" align="top" alt="Step 3"> Restart the TV

Hold the power button on the remote until the TV turns off and on again. Apps will show a **Develop mode** label.

> [!TIP]
> The TV's own address (if search cannot find it): **Settings → General → Network → Network Status → IP Settings**.

<details>
<summary><b>If the TV does not connect</b></summary>

<br>

EasyTizen checks every condition separately and shows a “What was checked” list: this device's network, whether the TV is in the same network, whether it answers, whether Developer Mode is on, which Host PC IP the TV has, whether the installation port is open and whether the TV accepts the connection. Developer Mode and Host PC IP are read from the TV itself (Samsung's device service on port `8001`) — the app never claims what it could not check.

| What happens | What to check |
|---|---|
| “No Samsung TV found on this network” | The TV is on and not in deep standby · both devices on the same, non-guest network · VPN off · enter the address manually |
| “Developer Mode off” | The TV itself reported Developer Mode off — turn it on (step 2) |
| “Wrong Host PC IP” / “The TV expects another device” | The TV has another device's address — EasyTizen shows both. Enter the right one and restart the TV |
| “The TV closed the connection” | TVs do this when Host PC IP does not match. Enter this device's address, turn Developer Mode off and on, restart the TV |
| “The TV seems to be in another network” | The TV's address is outside this device's network — check it and connect both devices to the same router |
| It worked before, not now | The phone's or computer's address changed — enter the new one as Host PC IP and restart the TV. The TV's address may have changed too: “TVs” → “Change address” |
| Host PC IP is saved backwards | Some firmwares with right-to-left languages need the address entered in reverse |
| Firewall | Allow EasyTizen outgoing connections to ports `26101` and `8001` on the local network |

</details>

<sub><a href="#install">↑ back to devices</a></sub>

<a name="first-install"></a>

### <img src="docs/readme/s-first.svg" width="28" height="28" align="top" alt=""> Your first installation

Nothing to prepare: EasyTizen works right after installation on every platform.

#### <img src="docs/readme/step-1.svg" width="28" height="28" align="top" alt="Step 1"> Find the TV

Click **“Find TVs”**. EasyTizen detects the active network interfaces (Wi-Fi, Ethernet; VPN, virtual machines and mobile data are skipped), probes its local network in parallel and lists TVs as they are confirmed: name, IP, model, Tizen version and status — “Ready”, “Developer Mode off”, “Wrong Host PC IP”. The search can be cancelled and usually takes 3–6 seconds.

#### <img src="docs/readme/step-2.svg" width="28" height="28" align="top" alt="Step 2"> Connect — or enter the IP

Click **“Connect”** next to a found TV. Not in the list? Type its address (for example `192.168.1.100`) in the field on the right and click **“Connect”**. EasyTizen checks the address, reachability, Developer Mode and Host PC IP, reads the model, Tizen version and device ID (DUID) and saves the TV — no need to search next time.

#### <img src="docs/readme/step-3.svg" width="28" height="28" align="top" alt="Step 3"> Choose the `.wgt` file

Drop the file onto the window or click **“Choose file”**. EasyTizen inspects the archive and shows the name, version, app ID and signature state.

#### <img src="docs/readme/step-4.svg" width="28" height="28" align="top" alt="Step 4"> Create a certificate

Done once per TV.

1. In the “Install” step click **“Create certificate”**.
2. Tick the TVs it is for, choose a name and a password (at least 8 characters with an uppercase letter, a lowercase letter and a digit). This is the certificate file's password, not your Samsung Account password.
3. Click **“Sign in with Samsung and create”** — Samsung's sign-in page opens in the browser. Sign in or create a free account, then return to EasyTizen.

> [!NOTE]
> Already have a certificate pair from Tizen Studio? Click **“Import existing”** and choose `author.p12`, `distributor.p12` and their passwords. The distributor certificate must have been issued for your TV's DUID.

#### <img src="docs/readme/step-5.svg" width="28" height="28" align="top" alt="Step 5"> Install

Click **“Install on TV”**. The stages match the real operations: signing a working copy → connecting → upload (real byte progress) → installation (percentage reported by the TV) → checking the result in the TV's app list → launch. “Installed” appears only after the TV confirmed the installation. The working copy is removed from the computer or phone and from the TV — also after an error, a dropped connection or a cancel.

<details>
<summary><b>If installation fails</b></summary>

<br>

| Message | What to do |
|---|---|
| The TV rejected the signature | The certificate was issued for another TV or has expired. Create a new certificate for this TV |
| Signed by a different author | The app is already on the TV with someone else's signature. Click “Remove the old copy…” under the error — EasyTizen removes it and retries |
| Not enough space on the TV | Remove unused apps on the TV |
| The TV stopped answering / closed the connection | Check Wi-Fi and that the TV did not go to standby, then retry. No partial file is left on the TV |
| The TV did not confirm the installation | Look under Apps; open “Technical details” and attach them to a bug report |

The TV's full answer is under the error in “Technical details” and in History.

</details>

<sub><a href="#install">↑ back to devices</a></sub>

<p align="center"><img src="docs/readme/divider.svg" width="100%" height="24" alt=""></p>

<a name="faq"></a>

## <img src="docs/readme/s-faq.svg" width="36" height="36" align="top" alt=""> FAQ

<details>
<summary><b>Which TVs are supported?</b></summary>

<br>

Samsung TVs running Tizen with Developer Mode — roughly 2016 models and newer. Samsung TVs on other systems (Orsay, before 2015) and other brands are not supported. The list of models verified with EasyTizen will appear in the [test report](docs/TEST-REPORT.md) — it is empty for now.

</details>

<details>
<summary><b>How do I enable Developer Mode?</b></summary>

<br>

Apps → press **1 2 3 4 5** on the remote → switch Developer Mode on → enter the address of the device running EasyTizen as Host PC IP → restart the TV. Details are in [Samsung TV](#samsung-tv); the app shows the same guide with your address filled in.

</details>

<details>
<summary><b>Why is my TV not found?</b></summary>

<br>

Search stays on your local network and combines three methods: parallel probing of every Wi-Fi/Ethernet network (whole networks up to /22, larger ones within the /24 around your address) for the installation port `26101` and Samsung's service on `8001`; an SSDP query that Samsung TVs answer; and a re-check of saved TVs at their last address. Every candidate is confirmed by a real SDB handshake or Samsung's device service, so unrelated devices are never listed. A TV is not found when it is off or in deep standby, or when the devices are on different networks (guest Wi-Fi, client isolation, VPN, a second router). In those cases enter the TV's address manually.

</details>

<details>
<summary><b>Why is Host PC IP needed?</b></summary>

<br>

The TV accepts developer connections from a single address — the one you entered in the Developer Mode window. That is its protection: other devices on the network cannot install anything. So when your phone's or computer's address changes, update Host PC IP and restart the TV.

</details>

<details>
<summary><b>What is a DUID?</b></summary>

<br>

Device Unique ID — the TV's unique number. Samsung writes it into the distributor certificate, and a TV accepts only packages whose certificate lists its number. EasyTizen reads the DUID when it connects.

</details>

<details>
<summary><b>Why are certificates needed?</b></summary>

<br>

Tizen installs signed apps only. Two certificates are required: an **author** certificate (who built the package) and a **distributor** certificate (which TVs may run it). Samsung issues both for free for your account. Private keys are generated on your device and never leave it.

</details>

<details>
<summary><b>Why is a certificate tied to a TV?</b></summary>

<br>

That is how Samsung limits installation of apps from outside the store: a distributor certificate is valid only on TVs whose DUIDs it lists. For a new TV create a new certificate — or tick several TVs when creating one.

</details>

<details>
<summary><b>Which WGT files can be installed?</b></summary>

<br>

Tizen web apps in `.wgt` format (a ZIP archive with `config.xml`) up to 512 MB. Signed or not does not matter: EasyTizen signs a copy with your certificate. `.tpk` and apps for other platforms are not supported. Whether an app runs depends on your TV's Tizen version — the required version is shown in the file details.

</details>

<details>
<summary><b>Why did installation fail?</b></summary>

<br>

Most often because of the certificate (issued for another TV, or expired), a conflict with a copy already installed by another author, or a lost connection. EasyTizen states the reason in plain language and keeps the TV's full answer under “Technical details”. See the table in [Your first installation](#first-install).

</details>

<details>
<summary><b>Can I install apps straight from Android?</b></summary>

<br>

Yes — the Android version is a standalone installer: the same Rust engine as on desktop finds the TV on Wi-Fi, speaks SDB to it, issues certificates and signs packages. The `.wgt` file is picked with the system file picker (Downloads and cloud folders included). One important caveat: it has been verified by automated tests and an APK build, not on a real phone with a real TV — see [known limitations](docs/KNOWN-LIMITATIONS.md).

</details>

<details>
<summary><b>Do I need a computer?</b></summary>

<br>

Not if you have Android. The Windows, macOS and Linux versions do the same for those who prefer a computer.

</details>

<details>
<summary><b>Where are certificates stored?</b></summary>

<br>

In the app data folder, `certificates/<name>/author.p12` and `distributor.p12`, encrypted with your password. The password is not saved — EasyTizen remembers it until you close the app and asks again after a restart. A valid certificate is reused for every installation on the TVs it was issued for.

Certificates that earlier versions created through the Tizen SDK are kept: the Certificates page marks them “Needs transfer”. Click **“Transfer”** and enter the password — EasyTizen copies them from the Tizen SDK keystore (or Tizen Studio's `~/SamsungCertificate/<name>/`) into its own storage without changing the originals. If the files are not found, import `author.p12` and `distributor.p12` manually.

App data folder: Windows — `%APPDATA%\io.github.volnalabs.easytizen`, macOS — `~/Library/Application Support/io.github.volnalabs.easytizen`, Linux — `~/.local/share/io.github.volnalabs.easytizen`, Android — the app's internal storage, inaccessible to other apps.

</details>

<details>
<summary><b>How does EasyTizen update?</b></summary>

<br>

Settings → **App updates**. In automatic mode (on by default) EasyTizen asks GitHub for the latest version every few hours, downloads the update and verifies its signature with the project's key. On Windows, macOS and Linux it is applied on restart — EasyTizen asks first and never restarts during an installation on the TV. On Android the downloaded APK is checked against the release checksum and handed to the system installer: Android itself asks you to confirm (and, once, to allow installs from EasyTizen). If the app came from Google Play, updates come from there. Turn the switch off and there are no background checks or downloads at all; “Check now” always works. Builds without the update-signing key (for example, ones you build yourself) never install anything by themselves and offer the installer as a download instead.

</details>

<details>
<summary><b>What does EasyTizen check before installing, and can I turn it off?</b></summary>

<br>

There are two layers.

- **Safe file handling — always.** ZIP structure, path-traversal (Zip Slip) protection, limits on file count, size and compression ratio (zip bombs), damaged archives, `config.xml` without DTDs or entities. These cannot be turned off.
- **Additional checks — on by default.** The Tizen app ID format and its match with the package ID, the start page being present, no executable programs for other systems (ELF, Windows PE, Mach-O), no duplicate file names and — when installing without re-signing — that the existing signature matches the files. A package with problems is not installed.

The additional checks can be turned off in **Settings → Security → “Additional app safety checks”**. EasyTizen asks you to confirm, shows a warning on every package and asks you to confirm that you trust the file before every installation. These are integrity and consistency checks, not an antivirus scan.

</details>

<details>
<summary><b>How do I diagnose problems?</b></summary>

<br>

**Settings → Diagnostics → “Copy report”** (or “Save to file”). The report lists the version, system, network interfaces and the Host PC IP address, saved TVs, certificates, recent installations with errors and the end of the log. It contains no passwords, keys or tokens, and device IDs are shortened. The log is kept in the app data folder (`logs/easytizen.log`); on desktop “Open log folder” opens it. Attach it to a [bug report](https://github.com/volnalabs/TV-Deploy/issues).

</details>

<details>
<summary><b>I used TV Deploy. What about my data?</b></summary>

<br>

EasyTizen is TV Deploy's new name. On first launch it migrates your settings, saved TVs and certificate profiles. The Tizen SDK is no longer needed; remove it once you have transferred your certificates (Certificates → “Transfer”). EasyTizen never deletes anything from the SDK itself.

</details>

<p align="center"><img src="docs/readme/divider.svg" width="100%" height="24" alt=""></p>

<a name="dev"></a>

## <img src="docs/readme/s-dev.svg" width="36" height="36" align="top" alt=""> For developers

<details>
<summary><b>Architecture, layout, tests and builds</b></summary>

<br>

```
React/TS interface ──typed commands──▶ src-tauri (Rust) ──▶ easytizen-core (Rust, everywhere)
                                                            TV discovery · SDB client · WGT signer
                                                            Samsung CA certificate flow
```

One engine on every platform; the app starts no child processes.

```
crates/easytizen-core/   UI-independent core: TV discovery, SDB client, WGT inspection and
                         signing, Samsung CA, diagnostics, TV emulator for tests
src-tauri/               Tauri 2 shell: commands, settings, history, log, updates
src-tauri/gen/android/   Android project (Gradle)
src/                     interface (React, TypeScript, Tailwind), browser demo backend
scripts/                 release checks, README artwork generator, guard tests
docs/                    documentation, screenshots, README artwork
```

Building from source (not needed to use a release) takes Node.js 22 and Rust stable; for desktop the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), for Android JDK 21, Android SDK (platform 36, build-tools 35) and NDK 27.

```sh
npm ci

# Tests
cargo test --workspace --features easytizen-core/mock-tv   # Rust: core and backend
npm test                                                   # interface and release scripts
npm run typecheck

# Interface in a browser with an emulated TV (no Rust needed)
npm run dev            # http://localhost:1420 · ?platform=android · ?demo=fresh · ?update=available · ?checks=off|fail

# TV emulator (SDB on 26101 and Samsung's device service on 8001 — found by the search)
cargo run -p easytizen-core --example mock_tv --features mock-tv -- 0.0.0.0 26101

# Desktop
npx tauri dev
npx tauri build --bundles appimage         # nsis | app (--target universal-apple-darwin)

# Android
export ANDROID_HOME=… NDK_HOME=$ANDROID_HOME/ndk/27.2.12479018
npx tauri android build --apk --target aarch64 armv7
```

More: [architecture](docs/ARCHITECTURE.md) · [design system](docs/DESIGN-SYSTEM.md) · [test report](docs/TEST-REPORT.md) · [known limitations](docs/KNOWN-LIMITATIONS.md) · [releasing and signing](docs/RELEASING.md) · [dependencies](docs/DEPENDENCIES.md) · [changelog](CHANGELOG.md).

</details>

<a name="privacy"></a>
<a name="license"></a>

## <img src="docs/readme/s-license.svg" width="36" height="36" align="top" alt=""> License and privacy

**License.** [Apache-2.0](LICENSE). EasyTizen is an independent project; it is not affiliated with or endorsed by Samsung. Samsung and Tizen are trademarks of their owners.

**Third-party components**

| Component | Used in | License |
|---|---|---|
| Public Samsung VD CA certificates from [Samsung tizen-agent-skills](https://github.com/Samsung/tizen-agent-skills) | embedded into the user's certificates | Apache-2.0, see [`LICENSE`](crates/easytizen-core/assets/samsung-tv-ca/LICENSE) and [`NOTICE`](crates/easytizen-core/assets/samsung-tv-ca/NOTICE) |
| [Tauri](https://tauri.app/) 2 with the dialog, fs and opener plugins | application shell | MIT / Apache-2.0 |
| [React](https://react.dev/), [lucide](https://lucide.dev/), [Tailwind CSS](https://tailwindcss.com/) | interface | MIT / ISC |
| RustCrypto (`rsa`, `sha2`, `x509-cert`), `p12-keystore`, `ureq`, `rustls`, `zip`, `roxmltree`, `if-addrs`, `socket2` | core | MIT / Apache-2.0 / BSD-3-Clause |

The Tizen SDK is neither used nor downloaded. Full list: [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).

**What is stored on your device.** Settings, the TV list (address, name, model, DUID), certificate metadata, the installation history and the log — in the app data folder. Certificates — as encrypted `.p12` files. EasyTizen never writes certificate passwords or the Samsung token to disk; secrets never reach the log or the history.

**Where the app connects**

| Address | When | What is sent |
|---|---|---|
| Your TV, port `26101`, local network | search, connection, installation | SDB commands and your package |
| Your TV, port `8001`, local network | search and connection check | a device-information request (model, Developer Mode, Host PC IP) |
| Addresses of your local network, ports `26101` and `8001`; SSDP `239.255.255.250:1900` | only when you press “Find TVs” | a TCP connection attempt; an M-SEARCH query |
| `account.samsung.com` (in your browser) | creating a certificate | you sign in yourself on Samsung's site |
| `svdca.samsungqbe.com` | creating a certificate | the certificate request (public key, author name, DUID) and the Samsung token |
| `api.github.com`, `github.com` and GitHub's file storage | checking for and downloading updates (can be disabled) | nothing beyond a standard request |

EasyTizen has no servers of its own, no analytics and no telemetry.
