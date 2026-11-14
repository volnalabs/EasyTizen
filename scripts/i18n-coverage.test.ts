import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "../src/i18n/en";
import { ru } from "../src/i18n/ru";

const rust = (path: string) => readFileSync(path, "utf8");
const has = (key: string) => key in en && key in ru;

describe("localisation covers everything the backend can report", () => {
  it("every additional-check finding and check name", () => {
    const source = rust("crates/easytizen-core/src/checks.rs");
    const codes = [...source.matchAll(/finding\(\s*CHECK_\w+,\s*"(\w+)"/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThanOrEqual(10);
    for (const code of codes) expect(has(`finding_${code}`), code).toBe(true);
    const checks = [...source.matchAll(/pub const CHECK_\w+: &str = "(\w+)";/g)].map((m) => m[1]);
    expect(checks).toEqual(["app_id", "entry_point", "native_code", "duplicates", "signature"]);
    for (const c of checks) expect(has(`check_${c}`), c).toBe(true);
  });

  it("every update error and manual-update reason", () => {
    const updates = rust("src-tauri/src/updates.rs") + rust("crates/easytizen-core/src/update.rs");
    const errors = new Set([...updates.matchAll(/update_error\("(\w+)"\)/g)].map((m) => m[1]));
    // Codes returned as strings by easytizen-core and prefixed with update_ in the shell.
    for (const m of rust("crates/easytizen-core/src/update.rs").matchAll(/Err\("(\w+)"(?:\.into\(\)|\.to_string\(\))?\)|"(\w+)"\.to_string\(\)/g)) errors.add(m[1] ?? m[2]);
    for (const code of errors) expect(has(`err_update_${code}`), code).toBe(true);
    for (const m of updates.matchAll(/manual_reason = Some\("(\w+)"\)/g)) expect(has(`updateManual_${m[1]}`), m[1]).toBe(true);
    for (const m of updates.matchAll(/ApiError::new\("(update_\w+)"\)/g)) expect(has(`err_${m[1]}`), m[1]).toBe(true);
  });

  it("every error code of the package gate", () => {
    const api = rust("src-tauri/src/api.rs");
    for (const code of ["pkg_checks_failed", "checks_skip_not_confirmed"]) {
      expect(api).toContain(`"${code}"`);
      expect(has(`err_${code}`), code).toBe(true);
    }
  });
});

describe("copy fits the phone layout", () => {
  it("bottom-bar labels stay short enough for a 320 px screen", () => {
    // Measured in the visual audit: four 80 px tabs fit 11 Cyrillic or 12 Latin characters.
    for (const [dict, max] of [[en, 12], [ru, 11]] as const) for (const key of ["navInstall", "navTvs", "navCerts", "navSettings"] as const) expect(dict[key].length, `${key}: ${dict[key]}`).toBeLessThanOrEqual(max);
  });

  it("segmented options stay short", () => {
    for (const dict of [en, ru]) for (const key of ["themeSystem", "themeLight", "themeDark", "langAuto"] as const) expect(dict[key].length, dict[key]).toBeLessThanOrEqual(10);
  });

  it("does not call the package checks an antivirus", () => {
    for (const dict of [en, ru]) {
      const all = Object.entries(dict).filter(([k]) => k !== "checksNotAntivirus").map(([, v]) => v.toLowerCase()).join("\n");
      expect(all).not.toMatch(/antivirus|антивирус/);
    }
  });
});
