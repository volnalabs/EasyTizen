import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without type declarations
import { ASSETS, changelogSection, checkVersion, parseVersion, renderNotes, repoVersions, UPDATER_ASSETS, updaterManifest, verifyAssets } from "./release.mjs";

describe("release helpers", () => {
  it("parses versions strictly", () => {
    expect(parseVersion("v1.2.3")).toBe("1.2.3");
    expect(parseVersion("1.2.3")).toBe("1.2.3");
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("v1.2.3-beta")).toBeNull();
  });

  it("the repository's own versions agree with each other", () => {
    const versions = Object.values(repoVersions()) as string[];
    expect(new Set(versions).size).toBe(1);
    expect(checkVersion(versions[0])).toEqual([]);
    expect(checkVersion("99.0.0").length).toBe(3);
  });

  it("blocks a release when an installer is missing, tiny or unexpected", () => {
    const dir = mkdtempSync(join(tmpdir(), "easytizen-release-"));
    expect(verifyAssets(dir).length).toBe(ASSETS.length);
    for (const { file, minBytes } of ASSETS) writeFileSync(join(dir, file), Buffer.alloc(minBytes));
    expect(verifyAssets(dir)).toEqual([]);
    writeFileSync(join(dir, "EasyTizen-Android.apk"), "stub");
    writeFileSync(join(dir, "EasyTizen-Android.aab"), "x");
    expect(verifyAssets(dir)).toEqual(["too small to be a real installer: EasyTizen-Android.apk", "unexpected file: EasyTizen-Android.aab"]);
  });

  it("requires the complete set of signed update artifacts — or none of them", () => {
    const dir = mkdtempSync(join(tmpdir(), "easytizen-updater-"));
    for (const { file, minBytes } of ASSETS) writeFileSync(join(dir, file), Buffer.alloc(minBytes));
    expect(verifyAssets(dir, { updater: true }).filter((p: string) => p.startsWith("missing update")).length).toBe(UPDATER_ASSETS.filter((a: { optional?: boolean }) => !a.optional).length);
    writeFileSync(join(dir, "EasyTizen-Android.apk.sig"), "x".repeat(200));
    expect(verifyAssets(dir)).toEqual(["update artifact without a signed build: EasyTizen-Android.apk.sig"]);
    for (const { file, minBytes = 200 } of UPDATER_ASSETS) writeFileSync(join(dir, file), file.endsWith(".sig") ? `sig-of-${file}` .padEnd(200, ".") : Buffer.alloc(minBytes));
    expect(verifyAssets(dir, { updater: true })).toEqual([]);
    writeFileSync(join(dir, "latest.json"), "{}");
    expect(verifyAssets(dir, { updater: true })).toEqual([]);
  });

  it("writes latest.json with versioned URLs and each platform's signature", () => {
    const dir = mkdtempSync(join(tmpdir(), "easytizen-manifest-"));
    writeFileSync(join(dir, "EasyTizen-Linux-x64.AppImage.sig"), "SIG-LINUX\n");
    writeFileSync(join(dir, "EasyTizen-Windows-x64-Setup.exe.sig"), "SIG-WIN");
    const m = updaterManifest(dir, "1.2.0", { notes: "Changes", pubDate: "2026-12-01T00:00:00Z" });
    expect(m.version).toBe("1.2.0");
    expect(Object.keys(m.platforms).sort()).toEqual(["linux-x86_64", "linux-x86_64-appimage", "windows-x86_64"]);
    expect(m.platforms["windows-x86_64"]).toEqual({ signature: "SIG-WIN", url: "https://github.com/volnalabs/TV-Deploy/releases/download/v1.2.0/EasyTizen-Windows-x64-Setup.exe" });
    expect(m.platforms["linux-x86_64"].signature).toBe("SIG-LINUX");
    // The app looks for exactly this file in the newest release.
    expect(readFileSync("src-tauri/src/updates.rs", "utf8")).toContain("releases/latest/download/latest.json");
  });

  it("every published file name is used by the README and the in-app update check", () => {
    const readme = readFileSync("README.md", "utf8");
    const readmeEn = readFileSync("README.en.md", "utf8");
    const update = readFileSync("crates/easytizen-core/src/update.rs", "utf8");
    const notes = readFileSync(".github/release-notes.md", "utf8");
    for (const { file } of ASSETS) {
      const link = `https://github.com/volnalabs/TV-Deploy/releases/latest/download/${file}`;
      expect(readme, file).toContain(link);
      expect(readmeEn, file).toContain(link);
      expect(notes, file).toContain(`\`${file}\``);
      if (!file.endsWith(".deb")) expect(update, file).toContain(`"${file}"`);
    }
  });

  it("extracts the changelog section and renders notes", () => {
    const changelog = "# Changelog\n\n## [1.1.0] — 2026-01-02\n\n### Новое\n- B\n\n## [1.0.0] — 2026-01-01\n\n- A\n";
    expect(changelogSection(changelog, "1.1.0")).toBe("### Новое\n- B");
    expect(changelogSection(changelog, "1.0.0")).toBe("- A");
    expect(changelogSection(changelog, "2.0.0")).toBeNull();
    const text = renderNotes({ template: "v{{VERSION}}\n{{CHANGES}}\n{{SHA256_TABLE}}\n{{SIGNING}}", version: "1.1.0", changes: "- B", sums: [{ file: "a.apk", sha: "ff" }], signing: { android: "temporary", windows: "unsigned", macos: "adhoc" } });
    expect(text).toContain("v1.1.0\n- B\n| Файл | SHA-256 |");
    expect(text).toContain("| `a.apk` | `ff` |");
    expect(text).toContain("временным ключом");
    expect(text).not.toContain("{{");
  });
});
