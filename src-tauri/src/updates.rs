//! EasyTizen self-update.
//!
//! * **Windows, macOS, Linux** — the Tauri updater. CI signs every updater artifact with the
//!   project's minisign key and publishes `latest.json` in the GitHub release; the app checks the
//!   signature against the public key compiled into this build before installing anything.
//!   macOS and AppImage builds are replaced on disk right after the download (unless a TV
//!   operation is running) and switch over when the user restarts. The Windows installer and the
//!   `.deb`/`.rpm` package manager need the app closed or an administrator prompt, so they only
//!   run when the user confirms.
//! * **Android** — the release APK is downloaded into the app's cache, checked against the
//!   SHA-256 in the release's `latest.json` and, when the build carries the key, the minisign
//!   signature published there (older releases: `SHA256SUMS.txt` and `.apk.sig`), then
//!   handed to Android's package installer. Android shows its own confirmation and refuses an APK
//!   signed with a different key than the installed app. Installations from Google Play are left
//!   to Google Play.
//!
//! Builds without the public key (local builds, forks, CI without the secret) report "manual":
//! they show the release and a download link instead of installing anything.

use crate::api::{ApiError, ApiResult};
use crate::{settings, AppState};
use easytizen_core::update::{self as core_update, is_newer, ReleaseInfo, REPOSITORY};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// Public half of the project's update-signing key (base64 minisign key, as printed by
/// `tauri signer generate`). CI compiles it in from the repository variable of the same name.
const PUBKEY: Option<&str> = option_env!("EASYTIZEN_UPDATER_PUBKEY");
/// `latest.json` of the newest GitHub release, written by the release workflow.
#[cfg_attr(mobile, allow(dead_code))] // Android reads the release API instead.
pub const MANIFEST_URL: &str =
    "https://github.com/volnalabs/TV-Deploy/releases/latest/download/latest.json";

pub fn pubkey() -> Option<&'static str> {
    PUBKEY.map(str::trim).filter(|k| !k.is_empty())
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct UpdateStatus {
    pub current: String,
    pub latest: String,
    pub available: bool,
    pub notes: Option<String>,
    pub published_at: Option<String>,
    /// Download size in bytes, when the release lists it.
    pub size: Option<u64>,
    pub release_url: String,
    /// Direct link to this platform's installer, for manual updates.
    pub download_url: String,
    /// "self" (desktop updater), "apk" (Android installer) or "manual".
    pub install: &'static str,
    /// Why the update cannot be installed from the app: no_key, release_unsigned, play, arch.
    pub manual_reason: Option<&'static str>,
    pub checked_at: i64,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct UpdateReady {
    pub version: String,
    /// "restart": installed on disk, applies on restart · "installer": runs on confirmation ·
    /// "apk": hand to Android's installer.
    pub apply: &'static str,
}

#[derive(Serialize, Clone)]
struct UpdateProgress {
    op_id: Option<String>,
    downloaded: u64,
    total: Option<u64>,
}

#[derive(Default)]
pub struct UpdateState {
    found: Mutex<Option<Found>>,
    ready: Mutex<Option<Ready>>,
}

enum Found {
    #[cfg(desktop)]
    Desktop(Box<tauri_plugin_updater::Update>),
    #[cfg(mobile)]
    Apk {
        version: String,
        url: String,
        /// Where the APK's SHA-256 (and signature) are published: `latest.json`, or the separate
        /// `SHA256SUMS.txt` / `.apk.sig` files of releases before 1.0.
        source: ApkChecks,
    },
}

#[cfg(mobile)]
enum ApkChecks {
    Manifest(String),
    Legacy {
        sums_url: String,
        sig_url: Option<String>,
    },
}

enum Ready {
    #[cfg(desktop)]
    Desktop {
        update: Box<tauri_plugin_updater::Update>,
        file: PathBuf,
        installed: bool,
        apply: &'static str,
    },
    #[cfg(mobile)]
    Apk { file: PathBuf },
}

fn update_error(code: &str) -> ApiError {
    ApiError::new(&format!("update_{code}"))
}

/// Base status from the GitHub release, before the platform decides how it can be installed.
pub fn base_status(
    release: &ReleaseInfo,
    current: &str,
    os: &str,
    arch: &str,
    now: i64,
) -> UpdateStatus {
    let legacy = core_update::build_info(current, &release.tag, os, arch);
    UpdateStatus {
        current: current.to_string(),
        latest: release.version.clone(),
        available: is_newer(&release.tag, current),
        notes: release.notes.clone(),
        published_at: release.published_at.clone(),
        size: release
            .asset(core_update::installer_asset(os, arch))
            .map(|a| a.size),
        release_url: format!(
            "https://github.com/{REPOSITORY}/releases/tag/{}",
            release.tag
        ),
        download_url: legacy.download_url,
        install: "manual",
        manual_reason: None,
        checked_at: now,
    }
}

fn busy(state: &AppState) -> bool {
    !state.ops.lock().unwrap().is_empty()
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    state: State<'_, AppState>,
    updates: State<'_, UpdateState>,
) -> ApiResult<UpdateStatus> {
    let now = crate::now_secs();
    {
        let mut s = state.settings.lock().unwrap();
        s.last_update_check = Some(now);
        let _ = settings::save(&state.data_dir, &s);
    }
    let release = tauri::async_runtime::spawn_blocking(core_update::latest_release)
        .await
        .map_err(|_| ApiError::new("internal"))?
        .map_err(|code| update_error(&code))?;
    let mut status = base_status(
        &release,
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
        now,
    );
    *updates.found.lock().unwrap() = None;
    if status.available && updates.ready.lock().unwrap().is_none() {
        platform_check(&app, &release, &mut status, &updates).await;
    }
    Ok(status)
}

#[cfg(desktop)]
async fn platform_check(
    app: &AppHandle,
    release: &ReleaseInfo,
    status: &mut UpdateStatus,
    updates: &UpdateState,
) {
    use tauri_plugin_updater::UpdaterExt;
    let Some(key) = pubkey() else {
        status.manual_reason = Some("no_key");
        return;
    };
    let updater = app
        .updater_builder()
        .pubkey(key)
        .timeout(std::time::Duration::from_secs(60))
        .endpoints(vec![MANIFEST_URL.parse().expect("valid manifest URL")])
        .and_then(|b| b.build());
    let Ok(updater) = updater else {
        status.manual_reason = Some("release_unsigned");
        return;
    };
    match updater.check().await {
        Ok(Some(update)) if update.version == release.version => {
            status.install = "self";
            let asset = update
                .download_url
                .path_segments()
                .and_then(|mut s| s.next_back())
                .unwrap_or_default()
                .to_string();
            if let Some(a) = release.asset(&asset) {
                status.size = Some(a.size);
            }
            *updates.found.lock().unwrap() = Some(Found::Desktop(Box::new(update)));
        }
        _ => status.manual_reason = Some("release_unsigned"),
    }
}

#[cfg(mobile)]
async fn platform_check(
    app: &AppHandle,
    release: &ReleaseInfo,
    status: &mut UpdateStatus,
    updates: &UpdateState,
) {
    if !matches!(std::env::consts::ARCH, "aarch64" | "arm") {
        status.manual_reason = Some("arch");
        return;
    }
    if android::install_source(app).as_deref() == Some("com.android.vending") {
        status.manual_reason = Some("play");
        return;
    }
    let Some(apk) = release.asset(android::APK_ASSET) else {
        status.manual_reason = Some("release_unsigned");
        return;
    };
    let source = match (
        release.asset("latest.json"),
        release.asset("SHA256SUMS.txt"),
    ) {
        (Some(manifest), _) => ApkChecks::Manifest(manifest.url.clone()),
        (None, Some(sums)) => {
            let sig = release
                .asset(&format!("{}.sig", android::APK_ASSET))
                .map(|a| a.url.clone());
            if pubkey().is_some() && sig.is_none() {
                status.manual_reason = Some("release_unsigned");
                return;
            }
            ApkChecks::Legacy {
                sums_url: sums.url.clone(),
                sig_url: sig,
            }
        }
        (None, None) => {
            status.manual_reason = Some("release_unsigned");
            return;
        }
    };
    status.install = "apk";
    status.size = Some(apk.size);
    *updates.found.lock().unwrap() = Some(Found::Apk {
        version: release.version.clone(),
        url: apk.url.clone(),
        source,
    });
}

/// Progress events, at most one per percent.
fn progress_emitter(app: AppHandle, op_id: Option<String>) -> impl FnMut(u64, Option<u64>) {
    let mut last = u64::MAX;
    move |downloaded, total| {
        let step = total
            .map(|t| downloaded * 100 / t.max(1))
            .unwrap_or(downloaded / (1024 * 1024));
        if step != last {
            last = step;
            let _ = app.emit(
                "update-progress",
                UpdateProgress {
                    op_id: op_id.clone(),
                    downloaded,
                    total,
                },
            );
        }
    }
}

/// Downloads and verifies the update found by the last check. `background`: started by the
/// automatic mode, which never competes with an installation on the TV.
#[tauri::command]
pub async fn update_download(
    app: AppHandle,
    state: State<'_, AppState>,
    updates: State<'_, UpdateState>,
    op_id: Option<String>,
    background: bool,
) -> ApiResult<UpdateReady> {
    if background && busy(&state) {
        return Err(update_error("busy"));
    }
    let dir = state.cache_dir.join("updates");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|_| ApiError::new("io_error"))?;
    let (ready, info) = platform_download(&app, &state, &updates, op_id, &dir).await?;
    *updates.ready.lock().unwrap() = Some(ready);
    Ok(info)
}

#[cfg(desktop)]
fn installer_kind() -> &'static str {
    use tauri::utils::config::BundleType;
    if cfg!(windows) {
        return "installer";
    }
    match tauri::utils::platform::bundle_type() {
        Some(BundleType::Deb | BundleType::Rpm) => "installer",
        _ => "restart",
    }
}

#[cfg(desktop)]
fn updater_error(e: tauri_plugin_updater::Error) -> ApiError {
    use tauri_plugin_updater::Error as E;
    match e {
        E::Minisign(_) | E::Base64(_) | E::SignatureUtf8(_) => update_error("signature"),
        E::Reqwest(_) | E::Network(_) => update_error("network"),
        _ => update_error("install_failed"),
    }
}

#[cfg(desktop)]
async fn platform_download(
    app: &AppHandle,
    state: &AppState,
    updates: &UpdateState,
    op_id: Option<String>,
    dir: &std::path::Path,
) -> ApiResult<(Ready, UpdateReady)> {
    let update = match updates.found.lock().unwrap().as_ref() {
        Some(Found::Desktop(u)) => u.clone(),
        _ => return Err(update_error("not_checked")),
    };
    let mut emit = progress_emitter(app.clone(), op_id);
    let mut done = 0u64;
    // `download` verifies the signature before returning the bytes.
    let bytes = update
        .download(
            |chunk, total| {
                done += chunk as u64;
                emit(done, total)
            },
            || {},
        )
        .await
        .map_err(updater_error)?;
    let file = dir.join(format!("EasyTizen-{}.update", update.version));
    std::fs::write(&file, &bytes).map_err(|_| ApiError::new("io_error"))?;
    let apply = installer_kind();
    // macOS and AppImage: replace the installed app now; the running copy keeps working and
    // the new version starts with the next launch. Not while the TV is being worked with.
    let installed = apply == "restart" && !busy(state) && update.install(&bytes).is_ok();
    let info = UpdateReady {
        version: update.version.clone(),
        apply,
    };
    Ok((
        Ready::Desktop {
            update,
            file,
            installed,
            apply,
        },
        info,
    ))
}

#[cfg(mobile)]
async fn platform_download(
    app: &AppHandle,
    _state: &AppState,
    updates: &UpdateState,
    op_id: Option<String>,
    dir: &std::path::Path,
) -> ApiResult<(Ready, UpdateReady)> {
    let (version, url, source) = match updates.found.lock().unwrap().as_ref() {
        Some(Found::Apk {
            version,
            url,
            source,
        }) => (
            version.clone(),
            url.clone(),
            match source {
                ApkChecks::Manifest(u) => ApkChecks::Manifest(u.clone()),
                ApkChecks::Legacy { sums_url, sig_url } => ApkChecks::Legacy {
                    sums_url: sums_url.clone(),
                    sig_url: sig_url.clone(),
                },
            },
        ),
        _ => return Err(update_error("not_checked")),
    };
    let file = dir.join(format!("EasyTizen-{version}.apk"));
    let mut emit = progress_emitter(app.clone(), op_id);
    let target = file.clone();
    tauri::async_runtime::spawn_blocking(move || -> ApiResult<()> {
        let digest = core_update::download(&url, &target, android::MAX_APK_BYTES, &mut emit)
            .map_err(|c| update_error(&c))?;
        let (expected, signature) = match source {
            ApkChecks::Manifest(manifest_url) => {
                let text = core_update::fetch_text(&manifest_url).map_err(|c| update_error(&c))?;
                match core_update::android_from_manifest(&text) {
                    Some((sha, signature)) => (Some(sha), signature),
                    None => (None, None),
                }
            }
            ApkChecks::Legacy { sums_url, sig_url } => {
                let sums = core_update::fetch_text(&sums_url).map_err(|c| update_error(&c))?;
                let signature = match sig_url {
                    Some(u) => Some(core_update::fetch_text(&u).map_err(|c| update_error(&c))?),
                    None => None,
                };
                (
                    core_update::sha256_from_sums(&sums, android::APK_ASSET),
                    signature,
                )
            }
        };
        let checked = expected == Some(digest)
            && match (pubkey(), signature) {
                (Some(key), Some(signature)) => {
                    let data = std::fs::read(&target).map_err(|_| ApiError::new("io_error"))?;
                    if core_update::verify_minisign(&data, &signature, key).is_err() {
                        let _ = std::fs::remove_file(&target);
                        return Err(update_error("signature"));
                    }
                    true
                }
                (Some(_), None) => false,
                (None, _) => true,
            };
        if !checked {
            let _ = std::fs::remove_file(&target);
            return Err(update_error("checksum"));
        }
        Ok(())
    })
    .await
    .map_err(|_| ApiError::new("internal"))??;
    Ok((
        Ready::Apk { file },
        UpdateReady {
            version,
            apply: "apk",
        },
    ))
}

/// Applies a downloaded update: restart (macOS, AppImage), run the installer (Windows, Linux
/// packages) or open Android's installer. Refused while a TV operation is running.
#[tauri::command]
pub async fn update_apply(
    app: AppHandle,
    state: State<'_, AppState>,
    updates: State<'_, UpdateState>,
) -> ApiResult<()> {
    if busy(&state) {
        return Err(update_error("busy"));
    }
    let Some(ready) = updates.ready.lock().unwrap().take() else {
        return Err(update_error("not_checked"));
    };
    platform_apply(&app, ready, &updates)
}

#[cfg(desktop)]
fn platform_apply(app: &AppHandle, ready: Ready, updates: &UpdateState) -> ApiResult<()> {
    let Ready::Desktop {
        update,
        file,
        installed,
        apply,
    } = ready;
    if !installed {
        let result = std::fs::read(&file)
            .map_err(|_| ApiError::new("io_error"))
            // `install` verifies the signature again; on Windows it exits into the installer.
            .and_then(|bytes| update.install(&bytes).map_err(updater_error));
        if let Err(e) = result {
            *updates.ready.lock().unwrap() = Some(Ready::Desktop {
                update,
                file,
                installed,
                apply,
            });
            return Err(e);
        }
    }
    let _ = std::fs::remove_file(&file);
    app.restart()
}

#[cfg(mobile)]
fn platform_apply(app: &AppHandle, ready: Ready, updates: &UpdateState) -> ApiResult<()> {
    let Ready::Apk { file } = ready;
    let result = android::install_apk(app, &file);
    // Keep the file: the user may come back from the permission screen and try again.
    *updates.ready.lock().unwrap() = Some(Ready::Apk { file });
    result
}

#[tauri::command]
pub fn update_open_permission_settings(app: AppHandle) -> ApiResult<()> {
    #[cfg(mobile)]
    return android::open_install_settings(&app);
    #[cfg(desktop)]
    {
        let _ = app;
        Err(ApiError::new("engine_unavailable"))
    }
}

#[cfg(mobile)]
pub mod android {
    use crate::api::{ApiError, ApiResult};
    use std::path::Path;
    use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
    use tauri::{AppHandle, Manager, Wry};

    pub const APK_ASSET: &str = "EasyTizen-Android.apk";
    pub const MAX_APK_BYTES: u64 = 300 * 1024 * 1024;

    pub struct ApkInstaller(PluginHandle<Wry>);

    /// Registers the Kotlin side (gen/android/…/ApkInstallerPlugin.kt).
    pub fn plugin() -> TauriPlugin<Wry> {
        Builder::<Wry>::new("easytizen-apk")
            .setup(|app, api| {
                #[cfg(target_os = "android")]
                app.manage(ApkInstaller(api.register_android_plugin(
                    "io.github.volnalabs.easytizen",
                    "ApkInstallerPlugin",
                )?));
                #[cfg(not(target_os = "android"))]
                let _ = (app, api);
                Ok(())
            })
            .build()
    }

    fn handle(app: &AppHandle) -> ApiResult<PluginHandle<Wry>> {
        app.try_state::<ApkInstaller>()
            .map(|s| s.0.clone())
            .ok_or_else(|| ApiError::new("update_unavailable"))
    }

    pub fn install_source(app: &AppHandle) -> Option<String> {
        let value: serde_json::Value = handle(app)
            .ok()?
            .run_mobile_plugin("installSource", ())
            .ok()?;
        value.get("source")?.as_str().map(str::to_string)
    }

    pub fn install_apk(app: &AppHandle, file: &Path) -> ApiResult<()> {
        handle(app)?
            .run_mobile_plugin::<serde_json::Value>(
                "installApk",
                serde_json::json!({ "path": file.to_string_lossy() }),
            )
            .map(|_| ())
            .map_err(|e| {
                ApiError::new(if e.to_string().contains("permission") {
                    "update_permission"
                } else {
                    "update_install_failed"
                })
            })
    }

    pub fn open_install_settings(app: &AppHandle) -> ApiResult<()> {
        handle(app)?
            .run_mobile_plugin::<serde_json::Value>("openInstallSettings", ())
            .map(|_| ())
            .map_err(|_| ApiError::new("update_install_failed"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use easytizen_core::update::ReleaseAsset;

    fn release(tag: &str) -> ReleaseInfo {
        let asset = |name: &str, size| ReleaseAsset {
            name: name.into(),
            size,
            url: format!("https://github.com/volnalabs/TV-Deploy/releases/download/{tag}/{name}"),
        };
        ReleaseInfo {
            version: tag.trim_start_matches('v').into(),
            tag: tag.into(),
            notes: Some("Changes".into()),
            published_at: Some("2026-12-01T10:00:00Z".into()),
            assets: vec![
                asset("EasyTizen-Linux-x64.AppImage", 120),
                asset("EasyTizen-Android.apk", 18),
            ],
        }
    }

    #[test]
    fn status_reports_newer_releases_only() {
        let s = base_status(&release("v1.0.0"), "0.9.0", "linux", "x86_64", 5);
        assert!(s.available);
        assert_eq!(s.latest, "1.0.0");
        assert_eq!(s.size, Some(120));
        assert_eq!(
            s.install, "manual",
            "nothing is installable until the platform check says so"
        );
        assert_eq!(
            s.release_url,
            "https://github.com/volnalabs/TV-Deploy/releases/tag/v1.0.0"
        );
        assert!(s.download_url.ends_with("/EasyTizen-Linux-x64.AppImage"));
        assert_eq!(s.checked_at, 5);
        assert!(!base_status(&release("v0.9.0"), "0.9.0", "linux", "x86_64", 5).available);
        assert!(!base_status(&release("v0.8.1"), "0.9.0", "android", "aarch64", 5).available);
        assert_eq!(
            base_status(&release("v1.0.0"), "0.9.0", "android", "aarch64", 5).size,
            Some(18)
        );
    }

    #[test]
    fn manifest_is_the_official_release_location() {
        assert_eq!(
            MANIFEST_URL,
            "https://github.com/volnalabs/TV-Deploy/releases/latest/download/latest.json"
        );
        // Local and CI builds without the variable must not pretend to self-update.
        if option_env!("EASYTIZEN_UPDATER_PUBKEY").is_none() {
            assert!(pubkey().is_none());
        }
    }
}
