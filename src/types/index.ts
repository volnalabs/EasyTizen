export type Diagnosis =
  | "no_network" | "tv_unreachable" | "other_network" | "dev_mode_off" | "host_ip_mismatch" | "port_closed"
  | "connection_dropped" | "network_unreachable" | "connection_rejected" | "operation_timed_out" | "cancelled"
  | "not_a_tv" | "unknown";

export interface ApiError { code: string; detail?: string | null }
export interface Outcome<T> { ok: boolean; data: T | null; diagnosis: Diagnosis | null; technical: string | null }

export type Platform = "android" | "windows" | "macos" | "linux";
export interface AppInfo {
  version: string; platform: Platform | string; arch: string; mobile: boolean;
  /** This device's LAN address — the value for "Host PC IP" on the TV. */
  host_ip: string | null;
  log_dir: string | null;
}

export type InterfaceKind = "wifi" | "ethernet" | "hotspot" | "mobile" | "vpn" | "virtual" | "other";
export interface LocalInterface { name: string; ip: string; prefix_len: number; kind: InterfaceKind; primary: boolean; private: boolean }
export interface NetworkInfo { host_ip: string | null; interfaces: LocalInterface[] }

/** What a found TV is ready for. */
export type TvStatus = "ready" | "dev_mode_off" | "host_ip_mismatch" | "sdb_rejected" | "sdb_unavailable";
export type FoundSource = "network_scan" | "ssdp" | "saved";
export interface FoundTv {
  ip: string; port: number; name: string | null; model: string | null; tizen_version: string | null;
  status: TvStatus; developer_mode: boolean | null; developer_ip: string | null; host_ip: string | null; sources: FoundSource[];
}
export interface ScanData { devices: FoundTv[]; networks: string[]; interfaces: LocalInterface[]; swept_hosts: number }

export type Probe = "open" | "refused" | "timed_out" | "network_unreachable" | "other";
export interface SamsungTvInfo {
  name: string | null; model_name: string | null; model_code: string | null; os: string | null; firmware: string | null;
  developer_mode: boolean | null; developer_ip: string | null; network_type: string | null;
}
export interface SdbInfo { model: string | null; tizen_version: string | null; secure_protocol: boolean; capability_known: boolean }
export interface TvIdentity { duid: string | null; model: string | null; platform_version: string | null; secure_protocol: boolean }
/** Every condition checked for one TV address. */
export interface TvCheck {
  ip: string; port: number; host_ip: string | null; interface: string | null; same_network: boolean | null; reachable: boolean;
  samsung: SamsungTvInfo | null; sdb_port: Probe; sdb_ok: boolean; sdb: SdbInfo | null; identity: TvIdentity | null;
  host_ip_matches: boolean | null; diagnosis: Diagnosis | null; technical: string | null;
}
export interface TvInfo { ip: string; port: number; duid: string | null; name: string; model: string | null; tizen_version: string | null; host_ip: string | null }
export type ConnectOutcome = Outcome<TvInfo> & { host_ip: string | null; check: TvCheck };

export type SignatureState = "unsigned" | "signed_structure" | "partial" | "malformed";
export interface Finding { code: string; detail: string | null }
export interface PackageReport {
  file_name: string; size_bytes: number; entry_count: number; uncompressed_bytes: number;
  app_name: string | null; app_id: string | null; package_id: string | null; version: string | null;
  required_api_version: string | null; signature: SignatureState;
  has_author_signature: boolean; has_distributor_signature: boolean; has_index_html: boolean;
  warnings: Finding[];
}
export interface OpenedPackage { path: string; report: PackageReport }

export interface SavedDevice { ip: string; port: number; name: string; duid: string | null; model: string | null; tizen_version: string | null; last_connected: number | null }
/** "sdk": made by an older version through the Tizen SDK — must be transferred once before use. */
export type CertStore = "sdk" | "builtin";
/** "samsung": issued by Samsung after sign-in, bound to TVs (DUIDs) · "tizen": the Tizen SDK's own developer
 * certificate, no account and no DUID — accepted by TVs before Tizen 7. */
export type CertKind = "samsung" | "tizen";
export interface CertificateProfile {
  name: string; identity: string; duids: string[]; engine: CertStore;
  created_at: number | null; expires_at: number | null; imported: boolean;
  /** Missing in data from older versions: treat as "samsung". */
  kind?: CertKind;
}
export interface Settings {
  theme: "system" | "light" | "dark"; language: "auto" | "ru" | "en";
  default_port: number; timeout_ms: number; devices: SavedDevice[];
  certificate_profiles: CertificateProfile[]; onboarding_done: boolean;
  /** Automatic updates: periodic check plus background download and verification. */
  check_updates: boolean;
  /** Additional (optional) package checks before installation; mandatory file safety always runs. */
  extra_package_checks: boolean;
  /** Unix seconds of the last update check, successful or not. */
  last_update_check: number | null;
}
export interface InstallResult {
  app_name: string | null; app_id: string | null; version: string | null; tv_ip: string;
  /** The TV's app list shows the app after installation; null when it could not be read. */
  in_app_list: boolean | null;
  launched: boolean | null;
}
export type InstallStage = "signing" | "connecting" | "uploading" | "installing" | "verifying" | "launching";
export interface InstallProgress { op_id: string | null; stage: InstallStage; fraction: number }
export type CertStage = "signin" | "author" | "distributor" | "saving" | "download" | "reading";
export interface CertProgress { op_id: string | null; stage: CertStage; url: string | null }
export interface HistoryEntry {
  time: number; app_name: string | null; app_id: string | null; version: string | null; file_name: string;
  tv_name: string; tv_ip: string; result: "success" | "failed" | "cancelled"; error_code: string | null; detail: string | null;
}
/** How this installation can be updated. */
export type UpdateInstall = "self" | "apk" | "manual";
export type ManualReason = "no_key" | "linux_package" | "play" | "arch" | "unsupported";
export interface UpdateStatus {
  current: string; latest: string; available: boolean;
  notes: string | null; published_at: string | null; size: number | null;
  release_url: string; download_url: string;
  install: UpdateInstall; manual_reason: ManualReason | null; checked_at: number;
}
/** "restart": installed on disk, applies on restart · "installer": Windows installer ready · "apk": APK verified. */
export interface UpdateReady { version: string; apply: "restart" | "installer" | "apk" }
export interface UpdateProgress { op_id: string | null; downloaded: number; total: number | null }

export type CheckCode = "app_id" | "entry_point" | "native_code" | "duplicates" | "signature";
export interface CheckFinding { check: CheckCode; code: string; detail: string | null; blocking: boolean }
export interface ExtraChecks {
  /** False when the user turned the additional checks off; nothing optional ran then. */
  enabled: boolean;
  ran: CheckCode[];
  findings: CheckFinding[];
}

export interface UpdateInfo { current: string; latest: string; update_available: boolean; release_url: string; download_url: string }
