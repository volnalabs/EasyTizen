import { describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import type { FoundTv, SavedDevice, TvCheck } from "../types";
import { DIAGNOSIS_STEPS, mergeTvs, readiness, STATUS_TONE, statusKey } from "./tv";

const base: TvCheck = {
  ip: "192.168.1.57", port: 26101, host_ip: "192.168.1.23", interface: "wlan0", same_network: true, reachable: true,
  samsung: null, sdb_port: "open", sdb_ok: true, sdb: null, identity: null, host_ip_matches: null, diagnosis: null, technical: null,
};
const state = (c: TvCheck, key: string) => readiness(c).find((i) => i.key === key)?.state;

describe("readiness list", () => {
  it("a ready TV is all green", () => {
    expect(readiness(base).every((i) => i.state === "ok")).toBe(true);
  });

  it("developer mode off is a reliable fact only with the device API", () => {
    const off: TvCheck = { ...base, sdb_port: "refused", sdb_ok: false, samsung: { name: "TV", model_name: "UE55", model_code: null, os: "Tizen", firmware: null, developer_mode: false, developer_ip: null, network_type: null }, diagnosis: "dev_mode_off" };
    expect(state(off, "ck_dev_mode")).toBe("fail");
    expect(state(off, "ck_sdb_port")).toBe("fail");
    const unknown: TvCheck = { ...off, samsung: null, diagnosis: "port_closed" };
    expect(state(unknown, "ck_dev_mode")).toBe("unknown");
    expect(state(unknown, "ck_host_ip")).toBe("unknown");
  });

  it("a wrong Host PC IP names both addresses", () => {
    const wrong: TvCheck = { ...base, sdb_ok: false, host_ip_matches: false, samsung: { name: "TV", model_name: null, model_code: null, os: "Tizen", firmware: null, developer_mode: true, developer_ip: "192.168.1.30", network_type: null } };
    const item = readiness(wrong).find((i) => i.key === "ck_host_ip_wrong")!;
    expect(item.state).toBe("fail");
    expect(item.params).toEqual({ hostIp: "192.168.1.23", tvHostIp: "192.168.1.30" });
    expect(state(wrong, "ck_sdb_accepts")).toBe("fail");
  });

  it("an unreachable address in another network", () => {
    const far: TvCheck = { ...base, ip: "10.0.0.5", same_network: false, reachable: false, sdb_port: "timed_out", sdb_ok: false, diagnosis: "other_network" };
    expect(state(far, "ck_same_network")).toBe("fail");
    expect(state(far, "ck_reachable")).toBe("fail");
    expect(state(far, "ck_sdb_port")).toBe("unknown");
    expect(readiness(far).some((i) => i.key === "ck_sdb_accepts")).toBe(false);
  });

  it("every key used exists in the dictionary", () => {
    const keys = new Set<string>();
    for (const c of [base, { ...base, host_ip_matches: false }]) for (const i of readiness(c)) keys.add(i.key);
    for (const list of Object.values(DIAGNOSIS_STEPS)) for (const k of list!) keys.add(k);
    for (const s of Object.keys(STATUS_TONE)) keys.add(statusKey(s as keyof typeof STATUS_TONE));
    for (const k of ["ck_same_network", "ck_samsung"]) keys.add(k);
    for (const k of keys) expect(k in en, k).toBe(true);
  });
});

describe("TV list", () => {
  const saved: SavedDevice[] = [
    { ip: "192.168.1.84", port: 26101, name: "Bedroom", duid: "D2", model: "QE43", tizen_version: "6.5", last_connected: 1 },
    { ip: "192.168.1.57", port: 26101, name: "Living room", duid: "D1", model: null, tizen_version: null, last_connected: 1 },
  ];
  const found: FoundTv[] = [
    { ip: "192.168.1.57", port: 26101, name: "Samsung 7 Series", model: "UE55", tizen_version: "6.0", status: "ready", developer_mode: true, developer_ip: null, host_ip: null, sources: ["network_scan"] },
    { ip: "192.168.1.112", port: 26101, name: "Kitchen", model: null, tizen_version: null, status: "dev_mode_off", developer_mode: false, developer_ip: null, host_ip: null, sources: ["ssdp"] },
  ];

  it("merges saved and found TVs once each, ready first, user names kept", () => {
    const list = mergeTvs(saved, found, true);
    expect(list.map((t) => t.ip)).toEqual(["192.168.1.57", "192.168.1.112", "192.168.1.84"]);
    expect(list[0]).toMatchObject({ name: "Living room", model: "UE55", tizen: "6.0", status: "ready", saved: true, live: true });
    expect(list[2]).toMatchObject({ status: null, saved: true, live: false });
  });

  it("can hide saved TVs that were not found", () => {
    expect(mergeTvs(saved, found, false).map((t) => t.ip)).toEqual(["192.168.1.57", "192.168.1.112"]);
    expect(mergeTvs(saved, null, false)).toEqual([]);
  });
});
