/**
 * Demo backend for running the real interface in a plain browser (`npm run dev`) — used for
 * UI development and for documentation screenshots. It keeps everything in memory and
 * emulates one TV on the network. It is never used inside the packaged application.
 *
 * `?demo=fresh` starts from first-run state; `?platform=android` mimics the phone build.
 * `?update=available` announces a newer release, `?checks=off` starts with the additional
 * package checks turned off and `?checks=fail` makes the demo package fail one of them.
 * `?legacy=1` adds a certificate profile made through the Tizen SDK by an older version.
 *
 * The emulated network: 192.168.1.57 is ready, 192.168.1.84 has Developer Mode on for another
 * computer, 192.168.1.112 has Developer Mode off. Any other address does not answer.
 */
import type {
  AppInfo, CertificateProfile, ConnectOutcome, Diagnosis, FoundTv, HistoryEntry, InstallResult, NetworkInfo, OpenedPackage, Outcome, ScanData,
  ExtraChecks, Settings, TvCheck, UpdateInfo, UpdateReady, UpdateStatus,
} from "../types";

declare const __APP_VERSION__: string;
const VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
const android = params.get("platform") === "android";
const fresh = params.get("demo") === "fresh";
const updateAvailable = params.get("update") === "available";
const checksFail = params.get("checks") === "fail";
const TV = { ip: "192.168.1.57", port: 26101, duid: "QK4EMULATEDTV0001", model: "UE55TU7100UXRU" };
const HOST_IP = "192.168.1.23";
interface DemoTv { ip: string; name: string; model: string; tizen: string; status: FoundTv["status"]; devIp: string | null; duid: string }
const NETWORK: DemoTv[] = [
  { ip: TV.ip, name: "Samsung 7 Series (55)", model: TV.model, tizen: "6.0", status: "ready", devIp: HOST_IP, duid: TV.duid },
  { ip: "192.168.1.84", name: "Samsung Q60 (43)", model: "QE43Q60AAUXRU", tizen: "6.5", status: "host_ip_mismatch", devIp: "192.168.1.30", duid: "QK4EMULATEDTV0002" },
  { ip: "192.168.1.112", name: "Samsung Crystal UHD (50)", model: "UE50AU7100UXRU", tizen: "6.0", status: "dev_mode_off", devIp: null, duid: "QK4EMULATEDTV0003" },
];
const found = (tv: DemoTv): FoundTv => ({
  ip: tv.ip, port: 26101, name: tv.name, model: tv.model, tizen_version: tv.status === "ready" ? tv.tizen : null, status: tv.status,
  developer_mode: tv.status !== "dev_mode_off", developer_ip: tv.devIp, host_ip: HOST_IP, sources: ["network_scan"],
});
function demoCheck(ip: string): TvCheck {
  const tv = NETWORK.find((n) => n.ip === ip);
  const local = ip.startsWith("192.168.1.");
  const diagnosis: Diagnosis | null = !tv ? (local ? "tv_unreachable" : "other_network") : tv.status === "ready" ? null : tv.status === "dev_mode_off" ? "dev_mode_off" : "host_ip_mismatch";
  return {
    ip, port: 26101, host_ip: HOST_IP, interface: android ? "wlan0" : "Wi-Fi", same_network: local, reachable: !!tv,
    samsung: tv ? { name: tv.name, model_name: tv.model, model_code: "20_NIKEM2_UHD", os: "Tizen", firmware: null, developer_mode: tv.status !== "dev_mode_off", developer_ip: tv.devIp, network_type: "wireless" } : null,
    sdb_port: !tv ? "timed_out" : tv.status === "ready" ? "open" : "refused", sdb_ok: tv?.status === "ready",
    sdb: tv?.status === "ready" ? { model: tv.model, tizen_version: tv.tizen, secure_protocol: true, capability_known: true } : null,
    identity: tv?.status === "ready" ? { duid: tv.duid, model: tv.model, platform_version: tv.tizen, secure_protocol: true } : null,
    host_ip_matches: tv?.devIp ? tv.devIp === HOST_IP : null, diagnosis, technical: null,
  };
}
const now = () => Math.floor(Date.now() / 1000);
/** The emulated newer release: the next minor version after this build. */
const NEXT_VERSION = (() => { const [major, minor] = VERSION.split(".").map((n) => Number.parseInt(n, 10) || 0); return `${major}.${minor + 1}.0`; })();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const settings: Settings = {
  theme: (params.get("theme") as Settings["theme"]) || "system",
  language: (params.get("lang") as Settings["language"]) || "auto",
  default_port: 26101,
  timeout_ms: 3000,
  devices: fresh ? [] : [
    { ip: TV.ip, port: TV.port, name: "Living room TV", duid: TV.duid, model: TV.model, tizen_version: "6.0", last_connected: now() - 3600 },
    { ip: "192.168.1.84", port: 26101, name: "Bedroom TV", duid: "QK4EMULATEDTV0002", model: "QE43Q60AAUXRU", tizen_version: "6.5", last_connected: now() - 86400 * 9 },
  ],
  certificate_profiles: fresh ? [] : [
    { name: "EasyTizen-57", identity: "Demo Author", duids: [TV.duid], engine: "builtin", created_at: now() - 86400 * 20, expires_at: now() + 86400 * 345, imported: false },
    ...(params.get("legacy") === "1" ? [{ name: "TizenStudio-Old", identity: "Demo Author", duids: ["QK4EMULATEDTV0002"], engine: "sdk" as const, created_at: null, expires_at: null, imported: false }] : []),
  ],
  onboarding_done: !fresh,
  check_updates: true,
  extra_package_checks: params.get("checks") !== "off",
  last_update_check: fresh ? null : now() - 3 * 3600,
};
let history: HistoryEntry[] = fresh ? [] : [
  { time: now() - 5400, app_name: "My App", app_id: "AbCdE12345.MyApp", version: "1.4.0", file_name: "MyApp.wgt", tv_name: "Living room TV", tv_ip: TV.ip, result: "success", error_code: null, detail: null },
  { time: now() - 86400 * 2, app_name: "Media Player", app_id: "XyZ9876543.Player", version: "2.0.1", file_name: "player.wgt", tv_name: "Bedroom TV", tv_ip: "192.168.1.84", result: "failed", error_code: "tv_cert_rejected", detail: "app_id[XyZ9876543.Player] install failed[118, -12], reason: Check certificate error : :Invalid certificate chain with certificate in signature" },
  { time: now() - 86400 * 6, app_name: "My App", app_id: "AbCdE12345.MyApp", version: "1.3.2", file_name: "MyApp.wgt", tv_name: "Living room TV", tv_ip: TV.ip, result: "success", error_code: null, detail: null },
];
const cancelled = new Set<string>();
const listeners = new Map<string, Set<(p: unknown) => void>>();
const emit = (event: string, payload: unknown) => listeners.get(event)?.forEach((h) => h(payload));

export function demoListen(event: string, handler: (p: unknown) => void): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(handler);
  return () => listeners.get(event)?.delete(handler);
}

const fail = (code: string, detail: string | null = null) => Promise.reject({ code, detail });
const guard = (opId: unknown) => (typeof opId === "string" && cancelled.has(opId) ? fail("cancelled") : Promise.resolve());

type Args = Record<string, any>;
const handlers: Record<string, (a: Args) => unknown> = {
  app_info: (): AppInfo => ({ version: VERSION, platform: android ? "android" : "linux", arch: "x86_64", mobile: android, host_ip: HOST_IP, log_dir: android ? null : "/home/demo/.local/share/io.github.volnalabs.easytizen/logs" }),
  network_info: (): NetworkInfo => ({ host_ip: HOST_IP, interfaces: [{ name: android ? "wlan0" : "Wi-Fi", ip: HOST_IP, prefix_len: 24, kind: "wifi", primary: true, private: true }] }),
  get_settings: () => structuredClone(settings),
  save_preferences: (a) => { Object.assign(settings, { theme: a.theme, language: a.language, default_port: a.defaultPort, timeout_ms: a.timeoutMs, check_updates: a.checkUpdates }); },
  complete_onboarding: () => { settings.onboarding_done = true; },
  cancel_operation: (a) => { cancelled.add(a.opId); },
  scan_tvs: async (a): Promise<Outcome<ScanData>> => {
    const at: Record<number, DemoTv> = { 3: NETWORK[0], 6: NETWORK[1], 8: NETWORK[2] };
    for (let i = 1; i <= 10; i++) {
      await wait(160);
      if (typeof a.opId === "string" && cancelled.has(a.opId)) return { ok: false, data: null, diagnosis: "cancelled", technical: null };
      if (at[i]) emit("scan-found", { op_id: a.opId, device: found(at[i]) });
      emit("scan-progress", { op_id: a.opId, fraction: i / 10 });
    }
    return { ok: true, data: { devices: NETWORK.map(found), networks: ["192.168.1.0/24"], interfaces: [], swept_hosts: 253 }, diagnosis: null, technical: null };
  },
  connect_tv: async (a): Promise<ConnectOutcome> => {
    await wait(700);
    const check = demoCheck(a.ip);
    const tv = NETWORK.find((n) => n.ip === a.ip);
    if (!check.sdb_ok || !tv) return { ok: false, data: null, diagnosis: check.diagnosis, technical: null, host_ip: HOST_IP, check };
    let saved = settings.devices.find((d) => d.ip === a.ip);
    if (!saved) { saved = { ip: a.ip, port: TV.port, name: tv.name, duid: tv.duid, model: tv.model, tizen_version: tv.tizen, last_connected: now() }; settings.devices.push(saved); }
    saved.last_connected = now();
    return { ok: true, data: { ip: a.ip, port: TV.port, duid: tv.duid, name: saved.name, model: tv.model, tizen_version: tv.tizen, host_ip: HOST_IP }, diagnosis: null, technical: null, host_ip: HOST_IP, check };
  },
  check_tv: async (a): Promise<TvCheck> => { await wait(500); return { ...demoCheck(a.ip), identity: null }; },
  remove_device: (a) => { settings.devices = settings.devices.filter((d) => d.ip !== a.ip); },
  rename_device: (a) => { const d = settings.devices.find((x) => x.ip === a.ip); if (d) d.name = a.name; },
  update_device_address: (a) => {
    if (settings.devices.some((d) => d.ip === a.newIp && d.ip !== a.ip)) return fail("device_exists");
    const d = settings.devices.find((x) => x.ip === a.ip); if (d) { d.ip = a.newIp; d.port = a.newPort; }
  },
  open_package: async (a): Promise<OpenedPackage> => {
    await wait(350);
    return { path: a.source, report: { file_name: "MyApp.wgt", size_bytes: 4_812_300, entry_count: 148, uncompressed_bytes: 9_300_000, app_name: "My App", app_id: "AbCdE12345.MyApp", package_id: "AbCdE12345", version: "1.4.0", required_api_version: "6.0", signature: "unsigned", has_author_signature: false, has_distributor_signature: false, has_index_html: true, warnings: [] } };
  },
  create_certificate: async (a): Promise<CertificateProfile> => {
    const stages = ["signin", "author", "distributor", "saving"];
    for (const stage of stages) {
      emit("cert-progress", { op_id: a.opId, stage, url: stage === "signin" ? "https://account.samsung.com/" : null });
      await wait(stage === "signin" ? 1600 : 700);
      await guard(a.opId);
    }
    const profile: CertificateProfile = { name: a.args.profileName, identity: a.args.identity, duids: a.args.duids, engine: "builtin", created_at: now(), expires_at: now() + 86400 * 365, imported: false };
    settings.certificate_profiles.push(profile);
    return profile;
  },
  create_tizen_certificate: async (a): Promise<CertificateProfile> => {
    for (const stage of [a.args.packageSource ? "reading" : "download", "author", "saving"]) {
      emit("cert-progress", { op_id: a.opId, stage, url: null });
      await wait(stage === "download" ? 1200 : 500);
      await guard(a.opId);
    }
    if (settings.certificate_profiles.some((p) => p.name === a.args.profileName)) return fail("profile_exists");
    const profile: CertificateProfile = { name: a.args.profileName, identity: a.args.identity, duids: [], engine: "builtin", created_at: now(), expires_at: Date.UTC(2027, 0, 1) / 1000, imported: false, kind: "tizen" };
    settings.certificate_profiles.push(profile);
    return profile;
  },
  import_certificate: async (a): Promise<CertificateProfile> => {
    await wait(500);
    const profile: CertificateProfile = { name: a.args.profileName, identity: "Imported Author", duids: [TV.duid], engine: "builtin", created_at: now(), expires_at: now() + 86400 * 200, imported: true };
    settings.certificate_profiles.push(profile);
    return profile;
  },
  transfer_legacy_certificate: async (a): Promise<CertificateProfile> => {
    await wait(500);
    if (a.password.length < 4) return fail("cert_password_wrong");
    const p = settings.certificate_profiles.find((x) => x.name === a.profileName);
    if (!p) return fail("certificate_profile_missing");
    Object.assign(p, { engine: "builtin", imported: true, expires_at: now() + 86400 * 300 });
    return structuredClone(p);
  },
  remove_certificate: (a) => { settings.certificate_profiles = settings.certificate_profiles.filter((p) => p.name !== a.profileName); },
  install_package: async (a): Promise<InstallResult> => {
    const p = (stage: string, fraction = 0) => emit("install-progress", { op_id: a.opId, stage, fraction });
    for (let i = 0; i <= 5; i++) { p("signing", i / 5); await wait(110); }
    p("connecting"); await wait(400); await guard(a.opId);
    for (let i = 0; i <= 12; i++) { p("uploading", i / 12); await wait(110); await guard(a.opId); }
    for (const f of [0, 0.18, 0.61, 1]) { p("installing", f); await wait(380); await guard(a.opId); }
    p("verifying"); await wait(400);
    if (a.args.runAfterInstall) { p("launching"); await wait(500); }
    history.unshift({ time: now(), app_name: "My App", app_id: "AbCdE12345.MyApp", version: "1.4.0", file_name: "MyApp.wgt", tv_name: settings.devices.find((d) => d.ip === a.args.ip)?.name ?? a.args.ip, tv_ip: a.args.ip, result: "success", error_code: null, detail: null });
    return { app_name: "My App", app_id: "AbCdE12345.MyApp", version: "1.4.0", tv_ip: a.args.ip, in_app_list: true, launched: a.args.runAfterInstall ? true : null };
  },
  uninstall_app: () => wait(600),
  get_history: () => structuredClone(history),
  clear_history: () => { history = []; },
  diagnostics_report: () => `EasyTizen ${VERSION} — diagnostics (demo mode)\nPlatform: browser\nHost PC IP to enter on the TV: ${HOST_IP}\nNetwork interfaces:\n  Wi-Fi ${HOST_IP}/24 Wifi primary searched\n\nSaved TVs: 2\n  192.168.1.57:26101  model=UE55TU7100UXRU  tizen=6.0  duid=…0001\n  192.168.1.84:26101  model=QE43Q60AAUXRU  tizen=6.5  duid=…0002\n\nCertificate profiles: 1\n  EasyTizen-57  ready  tvs=…0001`,
  save_text_file: () => undefined,
  open_log_folder: () => undefined,
  verify_package: async (a): Promise<ExtraChecks> => {
    await wait(300);
    if (!settings.extra_package_checks) return { enabled: false, ran: [], findings: [] };
    const ran: ExtraChecks["ran"] = ["app_id", "entry_point", "native_code", "duplicates", ...(a.asIs ? ["signature" as const] : [])];
    return { enabled: true, ran, findings: checksFail ? [{ check: "native_code", code: "native_code", detail: "lib/helper.so (ELF)", blocking: true }] : [] };
  },
  set_extra_package_checks: (a) => { settings.extra_package_checks = a.enabled; },
  update_check: async (): Promise<UpdateStatus> => {
    await wait(700);
    settings.last_update_check = now();
    const latest = updateAvailable ? NEXT_VERSION : VERSION;
    return {
      current: VERSION, latest, available: updateAvailable,
      notes: updateAvailable ? "• Faster TV search on large networks\n• Clearer messages when a TV refuses a package\n• Small interface fixes" : null,
      published_at: new Date(Date.now() - 86400_000).toISOString(), size: android ? 18_400_000 : 48_200_000,
      release_url: `https://github.com/volnalabs/TV-Deploy/releases/tag/v${latest}`, download_url: "https://github.com/volnalabs/TV-Deploy/releases/latest",
      install: android ? "apk" : "self", manual_reason: null, checked_at: now(),
    };
  },
  update_download: async (a): Promise<UpdateReady> => {
    for (let i = 1; i <= 20; i++) { await wait(80); emit("update-progress", { op_id: a.opId, downloaded: i * 2_400_000, total: 48_000_000 }); }
    return { version: NEXT_VERSION, apply: android ? "apk" : "restart" };
  },
  update_apply: () => undefined,
  update_open_permission_settings: () => undefined,
  check_for_update: (): UpdateInfo => ({ current: VERSION, latest: VERSION, update_available: false, release_url: "https://github.com/volnalabs/TV-Deploy/releases/latest", download_url: "https://github.com/volnalabs/TV-Deploy/releases/latest" }),
  open_external: (a) => { window.open(a.url, "_blank", "noopener"); },
};

export async function demoInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const handler = handlers[command];
  if (!handler) return Promise.reject({ code: "internal", detail: `demo backend has no command ${command}` });
  return (await handler((args ?? {}) as Args)) as T;
}
