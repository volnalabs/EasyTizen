import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  ApiError, AppInfo, CertificateProfile, ConnectOutcome, HistoryEntry, InstallResult, NetworkInfo, OpenedPackage, Outcome,
  ExtraChecks, ScanData, Settings, TvCheck, UpdateInfo, UpdateReady, UpdateStatus,
} from "../types";
import { demoInvoke, demoListen } from "./demo";

/** True inside the real application; false in a plain browser (`npm run dev`), where an
 *  in-memory demo backend with an emulated TV stands in for the Rust side. */
export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isDemo = !inTauri;

function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return inTauri ? invoke<T>(command, args) : demoInvoke<T>(command, args);
}

/** Subscribes to a backend progress event; resolves to an unsubscribe function. */
export function on<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  return inTauri ? listen<T>(event, (e) => handler(e.payload)) : Promise.resolve(demoListen(event, handler as (p: unknown) => void));
}

export function toApiError(e: unknown): ApiError {
  if (e && typeof e === "object" && "code" in e) return e as ApiError;
  return { code: "internal", detail: typeof e === "string" ? e : null };
}

export interface InstallArgs {
  packagePath: string; profileName: string | null; ip: string; port: number; duid: string | null;
  runAfterInstall: boolean; resign: boolean; password: string | null;
  /** Required when the additional checks are off: the user confirmed installing without them. */
  checksSkipConfirmed?: boolean;
}

/** Typed bridge to the Rust backend. The frontend has no other way to touch the system. */
export const api = {
  appInfo: () => call<AppInfo>("app_info"),
  getSettings: () => call<Settings>("get_settings"),
  savePreferences: (s: Pick<Settings, "theme" | "language" | "default_port" | "timeout_ms" | "check_updates">) =>
    call<void>("save_preferences", { theme: s.theme, language: s.language, defaultPort: s.default_port, timeoutMs: s.timeout_ms, checkUpdates: s.check_updates }),
  completeOnboarding: () => call<void>("complete_onboarding"),
  cancel: (opId: string) => call<void>("cancel_operation", { opId }),

  networkInfo: () => call<NetworkInfo>("network_info"),
  /** Searches the local network. Live results arrive as `scan-found` events. */
  scanTvs: (opId: string, subnet?: string) => call<Outcome<ScanData>>("scan_tvs", { opId, subnet: subnet ?? null }),
  /** Checks every readiness condition, reads the TV's identity and saves it on success. */
  connectTv: (ip: string, port: number | null, opId: string) => call<ConnectOutcome>("connect_tv", { ip, port, opId }),
  /** Availability of a saved TV, without changing anything. */
  checkTv: (ip: string, port: number, opId: string) => call<TvCheck>("check_tv", { ip, port, opId }),
  removeDevice: (ip: string, port: number) => call<void>("remove_device", { ip, port }),
  renameDevice: (ip: string, port: number, name: string) => call<void>("rename_device", { ip, port, name }),
  updateDeviceAddress: (ip: string, port: number, newIp: string, newPort: number) => call<void>("update_device_address", { ip, port, newIp, newPort }),

  openPackage: (source: string) => call<OpenedPackage>("open_package", { source }),
  /** Additional checks; mandatory file safety already ran in openPackage. `asIs`: installing without re-signing. */
  verifyPackage: (path: string, asIs: boolean) => call<ExtraChecks>("verify_package", { path, asIs }),
  setExtraPackageChecks: (enabled: boolean) => call<void>("set_extra_package_checks", { enabled }),

  createCertificate: (args: { profileName: string; identity: string; password: string; duids: string[] }, opId: string) =>
    call<CertificateProfile>("create_certificate", { args, opId }),
  importCertificate: (args: { profileName: string; authorSource: string; distributorSource: string; authorPassword: string; distributorPassword: string }) =>
    call<CertificateProfile>("import_certificate", { args }),
  /** Moves a profile made through the Tizen SDK by an older version into the app's own store. */
  transferLegacyCertificate: (profileName: string, password: string) => call<CertificateProfile>("transfer_legacy_certificate", { profileName, password }),
  removeCertificate: (profileName: string) => call<void>("remove_certificate", { profileName }),

  installPackage: (args: InstallArgs, opId: string) => call<InstallResult>("install_package", { args, opId }),
  uninstallApp: (ip: string, port: number, appId: string) => call<void>("uninstall_app", { ip, port, appId }),

  getHistory: () => call<HistoryEntry[]>("get_history"),
  clearHistory: () => call<void>("clear_history"),
  diagnosticsReport: () => call<string>("diagnostics_report"),
  saveTextFile: (path: string, content: string) => call<void>("save_text_file", { path, content }),
  openLogFolder: () => call<void>("open_log_folder"),
  checkForUpdate: () => call<UpdateInfo>("check_for_update"),
  updateCheck: () => call<UpdateStatus>("update_check"),
  /** Downloads and verifies the update. `background`: refused with update_busy while the TV is busy. */
  updateDownload: (opId: string, background: boolean) => call<UpdateReady>("update_download", { opId, background }),
  /** Restart (desktop), run the installer (Windows) or open Android's installer. */
  updateApply: () => call<void>("update_apply"),
  updateOpenPermissionSettings: () => call<void>("update_open_permission_settings"),
  openExternal: (url: string) => call<void>("open_external", { url }),
};

/** Native file pickers. On Android they return `content://` handles, which the backend reads. */
export async function pickFile(extensions?: string[], title?: string): Promise<string | null> {
  if (!inTauri) return extensions?.includes("wgt") ? "/demo/MyApp.wgt" : `/demo/${extensions?.[0] ?? "file"}.p12`;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple: false, directory: false, title, filters: extensions ? [{ name: extensions.map((e) => `.${e}`).join(", "), extensions }] : undefined });
  return typeof picked === "string" ? picked : null;
}

export async function pickSavePath(defaultName: string): Promise<string | null> {
  if (!inTauri) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return (await save({ defaultPath: defaultName, filters: [{ name: "Text", extensions: ["txt"] }] })) ?? null;
}
