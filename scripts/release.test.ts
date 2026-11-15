import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without type declarations
import { ASSETS, changelogSection, checkVersion, parseVersion, publishedFiles, renderNotes, repoVersions, SIGNATURES, updaterManifest, verifyAssets } from "./release.mjs";

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

  it("one installer per platform, nothing else", () => {
    expect(ASSETS.map((a: { file: string }) => a.file)).toEqual([
      "EasyTizen-Android.apk",
      "EasyTizen-Windows-x64-Setup.exe",
      "EasyTizen-macOS.app.tar.gz",
      "EasyTizen-Linux-x64.AppImage",
    ]);
  });

  it("requires every signature in a signed build — and none in an unsigned one", () => {
    const dir = mkdtempSync(join(tmpdir(), "easytizen-updater-"));
    for (const { file, minBytes } of ASSETS) writeFileSync(join(dir, file), Buffer.alloc(minBytes));
    expect(verifyAssets(dir, { updater: true }).filter((p: string) => p.startsWith("missing signature")).length).toBe(SIGNATURES.length);
    writeFileSync(join(dir, "EasyTizen-Android.apk.sig"), "x".repeat(200));
    expect(verifyAssets(dir)).toEqual(["signature without a signed build: EasyTizen-Android.apk.sig"]);
    for (const { file } of SIGNATURES) writeFileSync(join(dir, file), `sig-of-${file}`.padEnd(200, "."));
    expect(verifyAssets(dir, { updater: true })).toEqual([]);
    writeFileSync(join(dir, "latest.json"), "{}");
    expect(verifyAssets(dir, { updater: true })).toEqual([]);
    writeFileSync(join(dir, "SHA256SUMS.txt"), "x");
    expect(verifyAssets(dir, { updater: true })).toEqual(["unexpected file: SHA256SUMS.txt"]);
  });

  it("latest.json carries every signature and the APK checksum; only installers + latest.json are published", () => {
    const dir = mkdtempSync(join(tmpdir(), "easytizen-manifest-"));
    for (const { file, minBytes } of ASSETS) writeFileSync(join(dir, file), Buffer.alloc(minBytes));
    writeFileSync(join(dir, "EasyTizen-Linux-x64.AppImage.sig"), "SIG-LINUX\n");
    writeFileSync(join(dir, "EasyTizen-Windows-x64-Setup.exe.sig"), "SIG-WIN");
    writeFileSync(join(dir, "EasyTizen-macOS.app.tar.gz.sig"), "SIG-MAC");
    writeFileSync(join(dir, "EasyTizen-Android.apk.sig"), "SIG-APK");
    const m = updaterManifest(dir, "1.2.0", { notes: "Changes", pubDate: "2026-12-01T00:00:00Z" });
    expect(m.version).toBe("1.2.0");
    expect(m.platforms["windows-x86_64"]).toEqual({ signature: "SIG-WIN", url: "https://github.com/volnalabs/TV-Deploy/releases/download/v1.2.0/EasyTizen-Windows-x64-Setup.exe" });
    expect(m.platforms["linux-x86_64"].signature).toBe("SIG-LINUX");
    // One universal macOS build serves both architectures (installed 0.9.x apps look these keys up).
    for (const key of ["darwin-aarch64", "darwin-x86_64"]) expect(m.platforms[key]).toEqual({ signature: "SIG-MAC", url: "https://github.com/volnalabs/TV-Deploy/releases/download/v1.2.0/EasyTizen-macOS.app.tar.gz" });
    // Every platform entry is complete, or the Tauri updater would reject the whole manifest.
    for (const entry of Object.values(m.platforms) as { url: string; signature: string }[]) expect(entry.url && entry.signature).toBeTruthy();
    expect(m.android.signature).toBe("SIG-APK");
    expect(m.android.sha256).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(join(dir, "latest.json"), JSON.stringify(m));
    expect(publishedFiles(dir)).toEqual([...ASSETS.map((a: { file: string }) => a.file), "latest.json"].sort());
    // Unsigned build: the APK checksum is still published for the Android updater.
    const plain = mkdtempSync(join(tmpdir(), "easytizen-plain-"));
    for (const { file, minBytes } of ASSETS) writeFileSync(join(plain, file), Buffer.alloc(minBytes));
    const unsigned = updaterManifest(plain, "1.2.0");
    expect(unsigned.platforms).toEqual({});
    expect(unsigned.android.signature).toBeUndefined();
    expect(unsigned.android.sha256).toMatch(/^[0-9a-f]{64}$/);
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
      expect(update, file).toContain(`"${file}"`);
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
