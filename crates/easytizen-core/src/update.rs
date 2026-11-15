//! Updates: which release is the latest, and the integrity checks for downloaded files.
//!
//! * [`check`] — the original lightweight check (latest tag vs. running version).
//! * [`latest_release`] — the same request, with notes, publication date and asset sizes.
//! * [`download`] — streams a release asset to disk with a size cap, reporting progress and
//!   computing its SHA-256 on the way.
//! * [`android_from_manifest`] / [`verify_minisign`] — the checks applied before a downloaded APK
//!   is handed to Android's installer: the SHA-256 published in the release's `latest.json` and,
//!   when the build carries the project's update key, the minisign signature made in CI.
//!   [`sha256_from_sums`] reads the separate `SHA256SUMS.txt` of releases before 1.0.
//!
//! The desktop self-update itself is done by the Tauri updater (same minisign key); see
//! `src-tauri/src/updates.rs`.

use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;

pub const REPOSITORY: &str = "volnalabs/TV-Deploy";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub update_available: bool,
    /// Release page with notes and all installers.
    pub release_url: String,
    /// Stable direct link to this platform's installer.
    pub download_url: String,
}

/// Parses `1.2.3`, `v1.2.3` or `1.2.3-beta.1` into comparable numbers (pre-release tags
/// are ignored for ordering: `1.2.3-beta` is treated as `1.2.3`).
pub fn parse_version(text: &str) -> Option<(u64, u64, u64)> {
    let core = text.trim().trim_start_matches(['v', 'V']);
    let core = core.split(['-', '+']).next()?;
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    parts.next().is_none().then_some((major, minor, patch))
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

/// File name of the installer for the running platform, as published in every release.
pub fn installer_asset(os: &str, arch: &str) -> &'static str {
    match (os, arch) {
        ("android", _) => "EasyTizen-Android.apk",
        ("windows", _) => "EasyTizen-Windows-x64-Setup.exe",
        // One universal build for Apple silicon and Intel.
        ("macos", _) => "EasyTizen-macOS.app.tar.gz",
        _ => "EasyTizen-Linux-x64.AppImage",
    }
}

pub fn build_info(current: &str, latest_tag: &str, os: &str, arch: &str) -> UpdateInfo {
    UpdateInfo {
        current: current.to_string(),
        latest: latest_tag.trim_start_matches(['v', 'V']).to_string(),
        update_available: is_newer(latest_tag, current),
        release_url: format!("https://github.com/{REPOSITORY}/releases/latest"),
        download_url: format!(
            "https://github.com/{REPOSITORY}/releases/latest/download/{}",
            installer_asset(os, arch)
        ),
    }
}

fn latest_release_json() -> Result<serde_json::Value, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(15)))
        .http_status_as_error(false)
        .build()
        .into();
    let mut response = agent
        .get(format!(
            "https://api.github.com/repos/{REPOSITORY}/releases/latest"
        ))
        .header("User-Agent", "EasyTizen")
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|_| "network".to_string())?;
    match response.status().as_u16() {
        200 => {}
        404 => return Err("no_release".into()),
        _ => return Err("network".into()),
    }
    let body = response
        .body_mut()
        .with_config()
        .limit(4 * 1024 * 1024)
        .read_to_string()
        .map_err(|_| "network".to_string())?;
    serde_json::from_str(&body).map_err(|_| "network".to_string())
}

/// One HTTPS GET to api.github.com. No identifiers are sent besides a generic User-Agent.
pub fn check(current: &str) -> Result<UpdateInfo, String> {
    let json = latest_release_json()?;
    let tag = json
        .get("tag_name")
        .and_then(|t| t.as_str())
        .ok_or("no_release")?;
    if parse_version(tag).is_none() {
        return Err("no_release".into());
    }
    Ok(build_info(
        current,
        tag,
        std::env::consts::OS,
        std::env::consts::ARCH,
    ))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseAsset {
    pub name: String,
    pub size: u64,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseInfo {
    /// Version without the leading `v`.
    pub version: String,
    pub tag: String,
    pub notes: Option<String>,
    pub published_at: Option<String>,
    pub assets: Vec<ReleaseAsset>,
}

impl ReleaseInfo {
    pub fn asset(&self, name: &str) -> Option<&ReleaseAsset> {
        self.assets.iter().find(|a| a.name == name)
    }
}

const RELEASE_DOWNLOAD_PREFIX: &str = "https://github.com/volnalabs/TV-Deploy/releases/download/";

/// Reads the GitHub API answer. Only assets of this repository's releases are accepted, so a
/// download can never be pointed elsewhere.
pub fn parse_release(json: &serde_json::Value) -> Result<ReleaseInfo, String> {
    let tag = json
        .get("tag_name")
        .and_then(|t| t.as_str())
        .ok_or("no_release")?;
    if json.get("draft").and_then(|d| d.as_bool()) == Some(true) || parse_version(tag).is_none() {
        return Err("no_release".into());
    }
    let text = |key: &str| {
        json.get(key)
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .filter(|s| !s.trim().is_empty())
    };
    let assets = json
        .get("assets")
        .and_then(|a| a.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|a| {
                    let url = a.get("browser_download_url")?.as_str()?;
                    let name = a.get("name")?.as_str()?.to_string();
                    let size = a.get("size")?.as_u64()?;
                    url.starts_with(RELEASE_DOWNLOAD_PREFIX)
                        .then(|| ReleaseAsset {
                            name,
                            size,
                            url: url.to_string(),
                        })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(ReleaseInfo {
        version: tag.trim_start_matches(['v', 'V']).to_string(),
        tag: tag.to_string(),
        notes: text("body").map(|b| b.chars().take(20_000).collect()),
        published_at: text("published_at"),
        assets,
    })
}

/// The latest published release, with notes and asset sizes.
pub fn latest_release() -> Result<ReleaseInfo, String> {
    parse_release(&latest_release_json()?)
}

/// The SHA-256 published for `file` in a `SHA256SUMS.txt` (`<hex>  <name>` per line).
pub fn sha256_from_sums(sums: &str, file: &str) -> Option<[u8; 32]> {
    sums.lines().find_map(|line| {
        let (hex, name) = line.trim().split_once(char::is_whitespace)?;
        if name.trim().trim_start_matches('*') != file {
            return None;
        }
        parse_hex32(hex)
    })
}

fn parse_hex32(hex: &str) -> Option<[u8; 32]> {
    if hex.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(hex.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(out)
}

/// The Android entry of a release's `latest.json`: `{"android": {"sha256": "<hex>",
/// "signature": "<minisign, base64>"}}`. The SHA-256 is required; the signature is present when
/// the release was signed with the project's update key.
pub fn android_from_manifest(manifest: &str) -> Option<([u8; 32], Option<String>)> {
    let value: serde_json::Value = serde_json::from_str(manifest).ok()?;
    let android = value.get("android")?;
    let sha = parse_hex32(android.get("sha256")?.as_str()?)?;
    let signature = android
        .get("signature")
        .and_then(|s| s.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Some((sha, signature))
}

/// Verifies a minisign signature as produced by `tauri signer sign` (both the public key and
/// the `.sig` file are base64 of the minisign text format).
pub fn verify_minisign(
    data: &[u8],
    signature_b64: &str,
    public_key_b64: &str,
) -> Result<(), String> {
    let decode = |text: &str| {
        base64::engine::general_purpose::STANDARD
            .decode(text.trim())
            .ok()
            .and_then(|b| String::from_utf8(b).ok())
    };
    let key = decode(public_key_b64)
        .and_then(|k| minisign_verify::PublicKey::decode(&k).ok())
        .ok_or("signature")?;
    let signature = decode(signature_b64)
        .and_then(|s| minisign_verify::Signature::decode(&s).ok())
        .ok_or("signature")?;
    key.verify(data, &signature, false)
        .map_err(|_| "signature".to_string())
}

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(timeout))
        .http_status_as_error(false)
        .build()
        .into()
}

/// Small text asset (checksums, signatures) of this repository's releases.
pub fn fetch_text(url: &str) -> Result<String, String> {
    if !url.starts_with(RELEASE_DOWNLOAD_PREFIX) {
        return Err("network".into());
    }
    let mut response = agent(Duration::from_secs(30))
        .get(url)
        .header("User-Agent", "EasyTizen")
        .call()
        .map_err(|_| "network".to_string())?;
    if response.status().as_u16() != 200 {
        return Err("network".into());
    }
    response
        .body_mut()
        .with_config()
        .limit(1024 * 1024)
        .read_to_string()
        .map_err(|_| "network".to_string())
}

/// Streams a release asset into `destination`, refusing more than `cap` bytes. Returns its
/// SHA-256. `progress(downloaded, total)` is called as data arrives.
pub fn download(
    url: &str,
    destination: &Path,
    cap: u64,
    progress: &mut dyn FnMut(u64, Option<u64>),
) -> Result<[u8; 32], String> {
    if !url.starts_with(RELEASE_DOWNLOAD_PREFIX) {
        return Err("network".into());
    }
    let mut response = agent(Duration::from_secs(30 * 60))
        .get(url)
        .header("User-Agent", "EasyTizen")
        .call()
        .map_err(|_| "network".to_string())?;
    if response.status().as_u16() != 200 {
        return Err("network".into());
    }
    let total = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    if total.is_some_and(|t| t > cap) {
        return Err("too_large".into());
    }
    let mut reader = response.body_mut().with_config().limit(cap + 1).reader();
    let mut file = std::fs::File::create(destination).map_err(|_| "io".to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    let mut done = 0u64;
    loop {
        let n = reader
            .read(&mut buffer)
            .map_err(|_| "network".to_string())?;
        if n == 0 {
            break;
        }
        done += n as u64;
        if done > cap {
            drop(file);
            let _ = std::fs::remove_file(destination);
            return Err("too_large".into());
        }
        hasher.update(&buffer[..n]);
        file.write_all(&buffer[..n]).map_err(|_| "io".to_string())?;
        progress(done, total);
    }
    file.sync_all().map_err(|_| "io".to_string())?;
    Ok(hasher.finalize().into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        assert_eq!(parse_version("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("1.2"), Some((1, 2, 0)));
        assert_eq!(parse_version("1.2.3-beta.1"), Some((1, 2, 3)));
        assert_eq!(parse_version("release-1"), None);
        assert_eq!(parse_version("1.2.3.4"), None);
        assert!(is_newer("v1.0.1", "1.0.0"));
        assert!(is_newer("v1.10.0", "1.9.9"));
        // 0.9.x installations are offered 1.0.0.
        assert!(is_newer("v1.0.0", "0.9.8"));
        assert!(!is_newer("v1.0.0", "1.0.0"));
        assert!(!is_newer("v0.9.0", "1.0.0"));
        assert!(!is_newer("garbage", "1.0.0"));
    }

    #[test]
    fn release_answer_is_parsed_and_foreign_assets_are_dropped() {
        let json = serde_json::json!({
            "tag_name": "v1.2.0", "draft": false, "body": "Fixes", "published_at": "2026-12-01T10:00:00Z",
            "assets": [
                { "name": "EasyTizen-Android.apk", "size": 18_000_000,
                  "browser_download_url": "https://github.com/volnalabs/TV-Deploy/releases/download/v1.2.0/EasyTizen-Android.apk" },
                { "name": "evil.apk", "size": 1, "browser_download_url": "https://evil.example/evil.apk" }
            ]
        });
        let r = parse_release(&json).unwrap();
        assert_eq!(r.version, "1.2.0");
        assert_eq!(r.notes.as_deref(), Some("Fixes"));
        assert_eq!(r.assets.len(), 1);
        assert_eq!(r.asset("EasyTizen-Android.apk").unwrap().size, 18_000_000);
        assert!(r.asset("evil.apk").is_none());
        let draft = serde_json::json!({ "tag_name": "v1.2.0", "draft": true });
        assert!(parse_release(&draft).is_err());
        assert!(fetch_text("https://evil.example/SHA256SUMS.txt").is_err());
    }

    #[test]
    fn checksums_are_read_from_sha256sums() {
        let hex = "aa".repeat(32);
        let sums = format!(
            "{}  EasyTizen-Linux-x64.deb\n{hex}  EasyTizen-Android.apk\n",
            "bb".repeat(32)
        );
        assert_eq!(
            sha256_from_sums(&sums, "EasyTizen-Android.apk"),
            Some([0xaa; 32])
        );
        assert_eq!(sha256_from_sums(&sums, "EasyTizen-Android"), None);
        assert_eq!(
            sha256_from_sums("zz  EasyTizen-Android.apk", "EasyTizen-Android.apk"),
            None
        );
    }

    // A key pair generated with `tauri signer generate` for this test only (never used for
    // releases), and the signature of b"EasyTizen update test" made with `tauri signer sign`.
    const TEST_PUBKEY: &str = include_str!("../tests/fixtures/minisign/test.pub");
    const TEST_SIGNATURE: &str = include_str!("../tests/fixtures/minisign/payload.txt.sig");

    #[test]
    fn minisign_signatures_are_verified() {
        let payload = b"EasyTizen update test\n";
        verify_minisign(payload, TEST_SIGNATURE, TEST_PUBKEY).unwrap();
        assert!(verify_minisign(b"EasyTizen update tesT\n", TEST_SIGNATURE, TEST_PUBKEY).is_err());
        assert!(verify_minisign(payload, "not base64", TEST_PUBKEY).is_err());
        assert!(verify_minisign(payload, TEST_SIGNATURE, "bm90IGEga2V5").is_err());
    }

    #[test]
    fn links_point_at_the_published_file_names() {
        let info = build_info("1.0.0", "v1.1.0", "macos", "aarch64");
        assert!(info.update_available);
        assert_eq!(info.latest, "1.1.0");
        assert_eq!(
            info.download_url,
            "https://github.com/volnalabs/TV-Deploy/releases/latest/download/EasyTizen-macOS.app.tar.gz"
        );
        assert_eq!(
            installer_asset("android", "aarch64"),
            "EasyTizen-Android.apk"
        );
        assert_eq!(
            installer_asset("windows", "x86_64"),
            "EasyTizen-Windows-x64-Setup.exe"
        );
        assert_eq!(
            installer_asset("macos", "x86_64"),
            "EasyTizen-macOS.app.tar.gz"
        );
        assert_eq!(
            installer_asset("linux", "x86_64"),
            "EasyTizen-Linux-x64.AppImage"
        );
    }

    #[test]
    fn android_entry_of_the_manifest() {
        let hex = "ab".repeat(32);
        let m = format!(
            r#"{{"version":"1.2.0","platforms":{{}},"android":{{"url":"u","sha256":"{hex}","signature":"SIG"}}}}"#
        );
        let (sha, sig) = android_from_manifest(&m).unwrap();
        assert_eq!(sha, [0xab; 32]);
        assert_eq!(sig.as_deref(), Some("SIG"));
        let unsigned = format!(r#"{{"android":{{"sha256":"{hex}"}}}}"#);
        assert_eq!(android_from_manifest(&unsigned).unwrap().1, None);
        assert!(android_from_manifest(r#"{"android":{"sha256":"zz"}}"#).is_none());
        assert!(android_from_manifest(r#"{"platforms":{}}"#).is_none());
        assert!(android_from_manifest("not json").is_none());
    }
}
