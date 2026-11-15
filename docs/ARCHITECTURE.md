# Architecture

```
React/TS interface ──invoke(typed)──▶ src-tauri (Rust) ──▶ easytizen-core (Rust)
 (no process, no fs access)           validates every argument,     discovery · sdb · sign
                                      owns state, log, history      samsung_ca · package · checks
                                                                          │
                                                       Samsung TV (SDB 26101, device API 8001)
```

There is **one engine**, compiled into the app for every platform (Windows, macOS, Linux,
Android). No Tizen SDK, Tizen Studio, `sdb` binary, Node.js or Python is used, bundled or
downloaded, and the app starts no child processes.

## Crates and folders

| Path | Role |
|---|---|
| `crates/easytizen-core` | No UI dependency. `discovery/*` (interfaces, LAN sweep, SSDP, Samsung device API, connection check), `sdb/*` (SDB protocol client, install helpers, TV emulator), `sign/*` (PKCS#12 identities, XML-DSig WGT signer), `samsung_ca/*` (Samsung Account OAuth callback, CSR, CA client), `package` (safe WGT inspection), `checks` (optional package checks), `validate`, `diagnostics`, `connectivity`, `update`. `assets/samsung-tv-ca` holds Samsung's public CA certificates (Apache-2.0). |
| `src-tauri` | Tauri 2 shell. `api.rs` — the only command surface, with validation; `builtin.rs` — runs the core's operations off the UI thread and emits progress events; `settings.rs`, `history.rs`, `migrate.rs` — state; `applog.rs` — log file; `updates.rs` — self-update. |
| `src-tauri/gen/android` | Generated and then adjusted Android project (permissions, target SDK, release signing, APK hand-over for self-update). Committed. |
| `src` | React interface. `services/api.ts` is the typed bridge; `services/demo.ts` is an in-memory backend used only in a plain browser; `lib/tv.ts` maps check results to the readiness list. |

## Discovery (`discovery/`)

1. **Interfaces** (`netif.rs`, `if-addrs`): every IPv4 interface that is up, classified by
   name as Wi-Fi, Ethernet, hotspot, mobile data, VPN, virtual or other. Only LAN interfaces
   with a private (RFC 1918) address are swept; the default-route interface is preferred for
   "Host PC IP". If the OS lists nothing, the default-route address is used as a /24.
2. **Sweep**: networks up to /22 whole, larger ones within the /24 around the device's own
   address. Each host is probed on the SDB port (26101) and on Samsung's device API (8001) by
   up to 128 parallel connects with a short timeout. Saved TVs are added to the targets.
3. **SSDP**: M-SEARCH for `urn:samsung.com:device:RemoteControlReceiver:1` and DIAL, sent on
   every LAN interface twice; replies from private addresses only.
4. **Verification** (8 workers, while the sweep continues): a real SDB handshake +
   `capability:` (one retry on timeout) and `GET /api/v2/` (name, model, `developerMode`,
   `developerIP`). Each TV is reported with a status — `ready`, `dev_mode_off`,
   `host_ip_mismatch`, `sdb_rejected`, `sdb_unavailable` — and streamed to the UI
   (`scan-found`) as soon as it is known. Unrelated services and Android ADB endpoints are
   never listed. Cancellation stops every worker within one connect timeout.

`check_connection` explains a single address (manual IP, saved TV): local address towards the
TV, same-network test, device API, TCP probe of 26101 (≥ 3 s so Windows reports "refused"
correctly), SDB handshake and DUID. `diagnose` turns the facts into one diagnosis; Developer
Mode is reported off only when the TV itself says so.

## SDB client (`sdb/`)

One TCP connection, one stream at a time: `CNXN` (`host::`, version `0x02000000`),
`capability:`, `shell:<cmd>` (also streamed line by line), `sync:` push (`SEND`/`DATA`/`DONE`,
32 KB DATA chunks split into WRTE frames no larger than the device accepts, waiting for each
OKAY). Deadlines and cancellation on every read; EOF is reported as `Closed` (what a TV does
when Host PC IP is another device's).

Installation (`install_wgt`): upload into `<sdk_toolpath>/tmp/` (falls back to
`<sdk_toolpath>/` if refused) with real byte progress → `0 vd_appinstall <app-id> <path>` with
the TV's own percentages → conservative verdict (anything but a success marker is a failure)
→ `0 vd_applist` check → optional `0 was_execute`. The uploaded copy is removed with
`0 rmfile` on success, failure, broken connection or cancel (over a fresh connection when
needed). A TV that does not answer `capability:` still gets the TV command set.

## Signing and certificates

`sign::wgt` writes `author-signature.xml` and `signature1.xml` (RSA-SHA512, SHA-512 digests,
exclusive C14N for `SignedInfo`, C14N 1.1 for `#prop`) directly in canonical form, raw-copying
the original entries into a working copy; the user's file is only read. The `#prop` digests are
asserted byte-identical to those of independent installers proven on TVs. `samsung_ca` ports
Samsung's open-source certificate flow: loopback OAuth callback on 127.0.0.1:4794–4813, keys
and SHA-512 CSRs generated locally, multipart requests to `svdca.samsungqbe.com` with TLS
verification, PKCS#12 packaging with the Samsung VD CA.

Profiles created by versions that used the Tizen SDK keep `engine: "sdk"` in `settings.json`
and are transferred once (`transfer_legacy_certificate`) from the SDK keystore or Tizen
Studio's `~/SamsungCertificate/<name>/` — copied, never moved or deleted.

## Security properties

* The frontend has no shell, filesystem or process permissions (`capabilities/default.json`): window events, progress events and the native pickers only. CSP forbids remote content.
* Arguments are validated in `api.rs` and again in the core; only validated words are spliced into device commands.
* WGT inspection reads the central directory, `config.xml` and signature XML into memory with hard caps (512 MB archive, 20 000 entries, 2 GB uncompressed, ratio guard, 1 MB XML) and rejects zip-slip names and DTDs. Nothing from a package is extracted to disk or executed.
* Secrets: certificate passwords stay in memory for the session; the Samsung access token lives in memory only. Private keys are written only inside password-protected `.p12` files (0600 on Unix). Error details, the log and the diagnostics report pass through a redactor.
* LAN requests are written by hand on TCP sockets: no system proxy is consulted, answers are size-capped. Discovery never touches public address space.
* Self-update (`src-tauri/src/updates.rs`) is unchanged: Tauri updater with the compiled-in minisign key on desktop; checksum-verified APK handed to the system installer on Android.

## Windows

`main.rs` sets `windows_subsystem = "windows"` for release builds, so no console window is
created; CI checks the PE subsystem of the built executable. Errors go to
`<app data>/logs/easytizen.log` (1 MB, one rotated file), which the diagnostics report includes.

## Data migration

The data folder is derived from the bundle identifier (`io.github.volnalabs.easytizen`,
unchanged). `migrate.rs` copies `settings.json` from TV Deploy 0.1's folder on first start;
`settings.rs` reads every older schema (single `duid`, removed `engine`/`pending_sdk_install`
fields). Old folders are never deleted.
