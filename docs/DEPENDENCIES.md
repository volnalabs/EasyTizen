# Direct dependencies

Exact versions are locked in `Cargo.lock` and `package-lock.json`; full trees: `cargo tree`, `npm ls`.

## Rust

### easytizen-core
| Crate | Purpose | License |
|---|---|---|
| serde, serde_json | data shapes, Samsung device API answers | MIT / Apache-2.0 |
| thiserror | error types | MIT / Apache-2.0 |
| zip (deflate) | reading and rewriting `.wgt` archives | MIT |
| roxmltree | `config.xml` and signature parsing (no DTD support by design) | MIT / Apache-2.0 |
| base64 | signature and certificate encoding | MIT / Apache-2.0 |
| rsa, sha2 | RSA-2048 keys, RSA-SHA512 signatures, digests | MIT / Apache-2.0 |
| x509-cert | CSR building, certificate parsing | MIT / Apache-2.0 |
| p12-keystore | reading and writing PKCS#12 keystores | MIT / Apache-2.0 |
| aes, cbc, md-5 | decrypting the Tizen SDK developer CA key (OpenSSL "traditional" AES-128-CBC PEM) for the Tizen certificate | MIT / Apache-2.0 |
| getrandom | system randomness for key generation | MIT / Apache-2.0 |
| ureq (rustls, webpki-roots) | HTTPS to Samsung's CA and GitHub's API | MIT / Apache-2.0 |
| minisign-verify | verifying update signatures (Android APK) | MIT |
| if-addrs | listing the network interfaces for discovery (Windows, macOS, Linux, Android) | MIT / BSD-3-Clause |
| socket2 | choosing the outgoing interface for SSDP multicast | MIT / Apache-2.0 |
| tempfile (dev) | tests | MIT / Apache-2.0 |

### easytizen (src-tauri)
| Crate | Purpose | License |
|---|---|---|
| tauri, tauri-build | application shell | MIT / Apache-2.0 |
| tauri-plugin-dialog | native open/save pickers | MIT / Apache-2.0 |
| tauri-plugin-fs | reading Android `content://` documents from Rust | MIT / Apache-2.0 |
| tauri-plugin-opener | opening the Samsung sign-in page and GitHub links | MIT / Apache-2.0 |
| tauri-plugin-updater (desktop only) | signed self-update; registered only in builds that carry the update key | MIT / Apache-2.0 |
| serde, serde_json | settings, history | MIT / Apache-2.0 |

## npm

| Package | Purpose | License |
|---|---|---|
| @tauri-apps/api, @tauri-apps/plugin-dialog | bridge to the backend, pickers | MIT / Apache-2.0 |
| react, react-dom | interface | MIT |
| lucide-react | interface icons | ISC |
| @fontsource-variable/inter | Inter 4 variable font, bundled (Latin, Cyrillic) | SIL OFL 1.1 |
| tailwindcss, @tailwindcss/vite (dev) | styling | MIT |
| vite, @vitejs/plugin-react, typescript, vitest, @tauri-apps/cli (dev) | build and tests | MIT / Apache-2.0 |

## Vendored

| Component | Where | License |
|---|---|---|
| Samsung VD CA certificates (`vd_tizen_dev_author_ca.cer`, `vd_tizen_dev_public2.crt`, `vd_tizen_dev_partner2.crt`) from Samsung `tizen-agent-skills` @ `1509f7b9…` | `crates/easytizen-core/assets/samsung-tv-ca`, compiled into the core | Apache-2.0 — `LICENSE`, `NOTICE` next to them |

Nothing is fetched at build or run time: the Tizen SDK, Samsung TV Extension, `sdb` and Node.js are not used.

## Files read at run time (not shipped)

| What | Where from | Used for |
|---|---|---|
| `tizen-developer-ca.cer`, `tizen-developer-ca-privatekey.pem`, `sdk-public/tizen-distributor-signer.p12` | Samsung's `certificate-generator_0.1.4_ubuntu-64.zip` on download.tizen.org, downloaded only when the user creates a Tizen certificate (or a copy the user picks); each file is checked against a pinned SHA-256 | issuing the user's author certificate and the public distributor signature of a Tizen certificate. The files are not redistributed with EasyTizen; only the user's own two keystores are stored |
