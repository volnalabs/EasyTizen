#!/usr/bin/env node
// Release helpers used by .github/workflows/release.yml (and testable locally):
//
//   node scripts/release.mjs check-version <version>      versions in the repo match <version>
//   node scripts/release.mjs verify <dir>                 every expected installer is present
//   node scripts/release.mjs updater-manifest <dir> <version>   latest.json (signatures, APK SHA-256)
//   node scripts/release.mjs notes <dir> <version> <out>  release notes; removes the .sig files
//
// A release contains exactly four installers (Android, Windows, macOS, Linux) and latest.json.
//
// The file names below are the single source of truth for README links, the update check
// (crates/easytizen-core/src/update.rs) and the release page.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** What a release page shows: one installer per platform, and nothing else besides latest.json. */
export const ASSETS = [
  { file: "EasyTizen-Android.apk", minBytes: 3_000_000 },
  { file: "EasyTizen-Windows-x64-Setup.exe", minBytes: 2_000_000 },
  // One universal app for Apple silicon and Intel; also what the macOS self-update installs.
  { file: "EasyTizen-macOS.app.tar.gz", minBytes: 3_000_000 },
  { file: "EasyTizen-Linux-x64.AppImage", minBytes: 5_000_000 },
];

/** Minisign signatures made by CI when it has the project's update-signing key. They are read
 *  into latest.json and are NOT published as separate files. `target`: the Tauri updater
 *  platform keys the installer serves (installed 0.9.x apps look these keys up too). */
export const SIGNATURES = [
  { file: "EasyTizen-Windows-x64-Setup.exe.sig", target: ["windows-x86_64", "windows-x86_64-nsis"], artifact: "EasyTizen-Windows-x64-Setup.exe" },
  { file: "EasyTizen-macOS.app.tar.gz.sig", target: ["darwin-aarch64", "darwin-x86_64", "darwin-aarch64-app", "darwin-x86_64-app"], artifact: "EasyTizen-macOS.app.tar.gz" },
  { file: "EasyTizen-Linux-x64.AppImage.sig", target: ["linux-x86_64", "linux-x86_64-appimage"], artifact: "EasyTizen-Linux-x64.AppImage" },
  { file: "EasyTizen-Android.apk.sig", artifact: "EasyTizen-Android.apk" },
];
export const MANIFEST = "latest.json";
const DOWNLOAD = "https://github.com/volnalabs/TV-Deploy/releases/download";

export function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text).trim());
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/** Versions declared in the repository; all must agree before a release is cut. */
export function repoVersions(root = ".") {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const tauri = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8")).version;
  const cargo = /\[workspace\.package\][^[]*?version\s*=\s*"([^"]+)"/s.exec(readFileSync(join(root, "Cargo.toml"), "utf8"))?.[1];
  return { "package.json": pkg, "src-tauri/tauri.conf.json": tauri, "Cargo.toml": cargo };
}

export function checkVersion(version, root = ".") {
  const wanted = parseVersion(version);
  if (!wanted) return [`"${version}" is not a version like 1.2.3`];
  return Object.entries(repoVersions(root))
    .filter(([, v]) => v !== wanted)
    .map(([file, v]) => `${file} declares ${v}, expected ${wanted}`);
}

/** Problems with the collected files: missing, suspiciously small or unexpected ones.
 *  `updater`: the build was signed for in-app updates, so every signature must be there too;
 *  without it, none may be. */
export function verifyAssets(dir, { updater = false } = {}) {
  const problems = [];
  const present = existsSync(dir) ? readdirSync(dir) : [];
  for (const { file, minBytes } of ASSETS) {
    if (!present.includes(file)) problems.push(`missing: ${file}`);
    else if (statSync(join(dir, file)).size < minBytes) problems.push(`too small to be a real installer: ${file}`);
  }
  for (const { file } of SIGNATURES) {
    const has = present.includes(file);
    if (updater && !has) problems.push(`missing signature: ${file}`);
    else if (!updater && has) problems.push(`signature without a signed build: ${file}`);
    else if (has && statSync(join(dir, file)).size < 50) problems.push(`too small: ${file}`);
  }
  const known = new Set([...ASSETS, ...SIGNATURES].map((a) => a.file).concat(MANIFEST));
  for (const file of present) if (!known.has(file)) problems.push(`unexpected file: ${file}`);
  return problems;
}

/** latest.json: the Tauri updater's platforms (artifact URL + minisign signature) and the
 *  Android APK's SHA-256 and signature, which the Android app checks before installing. */
export function updaterManifest(dir, version, { notes = "", pubDate = new Date().toISOString() } = {}) {
  const platforms = {};
  const signatureOf = (file) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8").trim() : null);
  for (const { file, target, artifact } of SIGNATURES) {
    const signature = signatureOf(file);
    if (!target || !signature) continue;
    for (const key of target) platforms[key] = { signature, url: `${DOWNLOAD}/v${version}/${artifact}` };
  }
  const apk = "EasyTizen-Android.apk";
  const android = { url: `${DOWNLOAD}/v${version}/${apk}`, sha256: sha256Of(join(dir, apk)) };
  const apkSignature = signatureOf(`${apk}.sig`);
  if (apkSignature) android.signature = apkSignature;
  return { version, notes, pub_date: pubDate, platforms, android };
}

/** Files that go on the release page: the installers and latest.json (signatures are inside it). */
export function publishedFiles(dir) {
  return readdirSync(dir).filter((f) => !f.endsWith(".sig")).sort();
}

export function sha256Of(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The section of CHANGELOG.md for `version` (without its heading), or null. */
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^## \\[?${version.replaceAll(".", "\\.")}\\]?(\\s|$)`).test(l));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

export function renderNotes({ template, version, changes, sums, signing }) {
  const table = ["| Файл | SHA-256 |", "|---|---|", ...sums.map(({ file, sha }) => `| \`${file}\` | \`${sha}\` |`)].join("\n");
  const signingNotes = [
    signing.android === "release"
      ? "- **Android:** APK подписан постоянным ключом проекта — обновление ставится поверх предыдущей версии."
      : "- **Android:** APK подписан временным ключом этой сборки. Чтобы установить его поверх другой версии EasyTizen, сначала удалите старую (сертификаты при этом удаляются — экспортируйте или создайте их заново).",
    signing.windows === "signed"
      ? "- **Windows:** установщик подписан сертификатом издателя."
      : "- **Windows:** установщик не подписан сертификатом издателя — SmartScreen покажет предупреждение («Подробнее → Выполнить в любом случае»).",
    signing.macos === "notarized"
      ? "- **macOS:** приложение подписано Developer ID и нотаризовано Apple."
      : "- **macOS:** приложение не нотаризовано Apple (подпись ad-hoc) — первый запуск нужно разрешить вручную, см. инструкцию.",
    signing.updater === "signed"
      ? "- **Обновления из приложения:** файлы обновлений подписаны ключом проекта; EasyTizen 1.0 и новее проверяют подпись перед установкой."
      : "- **Обновления из приложения:** эта сборка выпущена без ключа подписи обновлений — EasyTizen предложит скачать установщик вручную.",
  ].join("\n");
  return template
    .replaceAll("{{VERSION}}", version)
    .replaceAll("{{CHANGES}}", changes)
    .replaceAll("{{SHA256_TABLE}}", table)
    .replaceAll("{{SIGNING}}", signingNotes);
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === "check-version") {
    const problems = checkVersion(args[0]);
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log(`version ${parseVersion(args[0])} is consistent`);
  } else if (command === "verify") {
    const problems = verifyAssets(args[0], { updater: process.env.SIGNING_UPDATER === "signed" });
    if (problems.length) { console.error(`Release blocked:\n${problems.join("\n")}`); process.exit(1); }
    console.log(`all ${ASSETS.length} installers are present`);
  } else if (command === "notes") {
    const [dir, rawVersion, out] = args;
    const version = parseVersion(rawVersion);
    const problems = verifyAssets(dir, { updater: process.env.SIGNING_UPDATER === "signed" });
    if (!version || problems.length) { console.error(["cannot write notes", ...problems].join("\n")); process.exit(1); }
    const sums = ASSETS.map(({ file }) => ({ file, sha: sha256Of(join(dir, file)) }));
    // Signatures live in latest.json; the release page shows only the installers and latest.json.
    for (const f of readdirSync(dir)) if (f.endsWith(".sig")) unlinkSync(join(dir, f));
    const changes = changelogSection(readFileSync("CHANGELOG.md", "utf8"), version);
    if (!changes) { console.error(`CHANGELOG.md has no section for ${version}`); process.exit(1); }
    const signing = { android: process.env.SIGNING_ANDROID || "temporary", windows: process.env.SIGNING_WINDOWS || "unsigned", macos: process.env.SIGNING_MACOS || "adhoc", updater: process.env.SIGNING_UPDATER || "none" };
    writeFileSync(out, renderNotes({ template: readFileSync(".github/release-notes.md", "utf8"), version, changes, sums, signing }));
    console.log(`wrote ${out}; publishing ${publishedFiles(dir).join(", ")}`);
  } else if (command === "updater-manifest") {
    const [dir, rawVersion] = args;
    const version = parseVersion(rawVersion);
    const changes = version && changelogSection(readFileSync("CHANGELOG.md", "utf8"), version);
    if (!version || !changes) { console.error("updater-manifest needs a released version with a CHANGELOG section"); process.exit(1); }
    const manifest = updaterManifest(dir, version, { notes: changes });
    writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
    console.log(`wrote ${MANIFEST} for ${Object.keys(manifest.platforms).join(", ")}`);
  } else {
    console.error("usage: release.mjs check-version <version> | verify <dir> | notes <dir> <version> <out> | updater-manifest <dir> <version>");
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/").split("/").pop())) main(process.argv.slice(2));
