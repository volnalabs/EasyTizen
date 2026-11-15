import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every source file of the shipped application (frontend, Tauri shell, core). */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (["node_modules", "target", "gen", "fixtures"].includes(name)) return [];
    return statSync(path).isDirectory() ? sources(path) : /\.(rs|ts|tsx|json|toml|kt)$/.test(name) ? [path] : [];
  });
}

describe("only the built-in engine ships — no Tizen SDK downloader", () => {
  const files = [...sources("src"), ...sources("src-tauri/src"), ...sources("crates"), "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "package.json"];

  it("the SDK installer, Samsung CLI runner and bundled Node.js are gone", () => {
    for (const path of ["resources", "scripts/fetch-node.mjs", "scripts/vendor-samsung-cli.sh", "src-tauri/src/sdk_engine.rs", "src-tauri/src/sdk_installer.rs", "src-tauri/src/toolchain.rs", "crates/easytizen-core/src/samsung"])
      expect(existsSync(path), path).toBe(false);
  });

  it("no code downloads or starts SDK tools", () => {
    const forbidden = /tizen-sdk-install|install_samsung_sdk|sdk_preflight|toolchain_status|fetch-node|samsung-cli|download\.tizen\.org|Command::new\(\s*"(node|powershell|bash|sh|sdb|tz)/;
    for (const file of files) {
      if (file.endsWith("no-sdk.test.ts")) continue;
      const text = readFileSync(file, "utf8");
      expect(forbidden.test(text), `${file}: ${text.match(forbidden)?.[0]}`).toBe(false);
    }
  });

  it("the application starts no child processes", () => {
    for (const file of files.filter((f) => f.endsWith(".rs") && !f.includes("interop_tests") && !f.includes("samsung_ca/mod.rs"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/std::process::Command|process::Command::new/);
    }
  });

  it("the desktop bundle carries no extra resources", () => {
    const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
    expect(conf.bundle.resources).toBeUndefined();
  });

  it("the Windows build uses the GUI subsystem (no console window)", () => {
    expect(readFileSync("src-tauri/src/main.rs", "utf8")).toContain('#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]');
  });
});
