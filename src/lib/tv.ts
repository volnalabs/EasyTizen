import type { Key } from "../i18n";
import type { Diagnosis, FoundTv, SavedDevice, TvCheck, TvStatus } from "../types";

export type Tone = "ok" | "warn" | "err" | "neutral";

export const STATUS_TONE: Record<TvStatus, Tone> = {
  ready: "ok",
  dev_mode_off: "warn",
  host_ip_mismatch: "warn",
  sdb_rejected: "warn",
  sdb_unavailable: "neutral",
};

export function statusKey(status: TvStatus): Key {
  return `tvStatus_${status}` as Key;
}

export type CheckState = "ok" | "fail" | "unknown";
export interface CheckItem { key: Key; state: CheckState; params?: Record<string, string> }

/**
 * The readiness list for one TV address, in the order a person would fix things.
 * Only facts the backend actually established are marked ok or failed; everything it could not
 * determine stays "unknown" — the list never claims more than was checked.
 */
export function readiness(check: TvCheck): CheckItem[] {
  const items: CheckItem[] = [];
  const host = check.host_ip ?? "—";
  items.push({ key: "ck_local_network", state: check.host_ip ? "ok" : "fail", params: { hostIp: host } });
  if (check.same_network !== null) items.push({ key: "ck_same_network", state: check.same_network ? "ok" : "fail", params: { ip: check.ip } });
  items.push({ key: "ck_reachable", state: check.reachable ? "ok" : "fail", params: { ip: check.ip } });
  if (check.samsung) {
    const model = check.samsung.model_name ?? check.samsung.name ?? "Samsung TV";
    items.push({ key: "ck_samsung", state: "ok", params: { model } });
  }
  const devMode = check.samsung?.developer_mode ?? (check.sdb_ok ? true : null);
  items.push({ key: "ck_dev_mode", state: devMode === null ? "unknown" : devMode ? "ok" : "fail" });
  const matches = check.host_ip_matches ?? (check.sdb_ok ? true : null);
  items.push({
    key: matches === false ? "ck_host_ip_wrong" : "ck_host_ip",
    state: matches === null ? "unknown" : matches ? "ok" : "fail",
    params: { hostIp: host, tvHostIp: check.samsung?.developer_ip ?? "—" },
  });
  const port = check.sdb_port === "open" ? "ok" : check.reachable ? "fail" : "unknown";
  items.push({ key: "ck_sdb_port", state: port, params: { port: String(check.port) } });
  if (check.sdb_port === "open") items.push({ key: "ck_sdb_accepts", state: check.sdb_ok ? "ok" : "fail" });
  return items;
}

/** What a diagnosis asks the person to do, in steps (shown under the explanation). */
export const DIAGNOSIS_STEPS: Partial<Record<Diagnosis, Key[]>> = {
  no_network: ["dx_no_network_c1", "dx_no_network_c2"],
  tv_unreachable: ["dx_tv_unreachable_c1", "dx_tv_unreachable_c2", "dx_tv_unreachable_c3"],
  other_network: ["dx_other_network_c1", "dx_other_network_c2"],
  dev_mode_off: ["devStep1", "devStep2", "devStep3", "dx_set_host_ip", "devStep5"],
  host_ip_mismatch: ["devStep1", "devStep2", "dx_set_host_ip", "devStep5"],
  port_closed: ["dx_port_closed_c1", "dx_port_closed_c2", "dx_port_closed_c3"],
  connection_dropped: ["dx_set_host_ip", "devStep5", "dx_connection_dropped_c3"],
};

export interface ListedTv {
  ip: string; port: number; name: string | null; model: string | null; tizen: string | null;
  status: TvStatus | null; saved: boolean; live: boolean;
}

/** Saved and found TVs in one list: found ones first (ready first), each address once. */
export function mergeTvs(saved: SavedDevice[], found: FoundTv[] | null, showSaved: boolean): ListedTv[] {
  const map = new Map<string, ListedTv>();
  if (showSaved) for (const s of saved) map.set(`${s.ip}:${s.port}`, { ip: s.ip, port: s.port, name: s.name, model: s.model, tizen: s.tizen_version, status: null, saved: true, live: false });
  for (const f of found ?? []) {
    const key = `${f.ip}:${f.port}`;
    const known = saved.find((d) => d.ip === f.ip && d.port === f.port);
    map.set(key, { ip: f.ip, port: f.port, name: known?.name ?? f.name, model: f.model ?? known?.model ?? null, tizen: f.tizen_version ?? known?.tizen_version ?? null, status: f.status, saved: !!known, live: true });
  }
  const rank = (t: ListedTv) => (t.status === "ready" ? 0 : t.live ? 1 : 2);
  return [...map.values()].sort((a, b) => rank(a) - rank(b) || ipValue(a.ip) - ipValue(b.ip));
}

export function ipValue(ip: string): number {
  return ip.split(".").reduce((acc, part) => acc * 256 + (Number(part) || 0), 0);
}
