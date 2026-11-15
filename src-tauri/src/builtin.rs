//! EasyTizen's engine: its own SDB client, signer and Samsung certificate flow, on every
//! platform. Needs no Tizen SDK, no Node.js and no download.
//!
//! Certificates live in `<app data>/certificates/<profile>/{author,distributor}.p12`,
//! encrypted with the password the user chose. The password itself is kept only in memory
//! for the running session.

use crate::api::{
    fail, remember_device, success, ApiError, ApiResult, ConnectOutcome, CreateCertificateArgs,
    ImportCertificateArgs, InstallJob, InstallResult, Outcome, ScanData, TvInfo,
};
use crate::settings::{CertKind, Engine, SavedCertificateProfile};
use crate::{applog, AppState};
use easytizen_core::cancel::CancelToken;
use easytizen_core::diagnostics::Diagnosis;
use easytizen_core::discovery::{self, CheckOptions, DiscoverOptions, FoundTv, TvCheck};
use easytizen_core::samsung_ca::{self, api::CaClient, oauth::OAuthSession, CaError};
use easytizen_core::sdb::{self, InstallFailure, InstallStage, InstallVerdict, SdbError};
use easytizen_core::sign::{sign_wgt, IdentityError, SignError, SigningIdentity};
use easytizen_core::tizen_cert::{self, TizenCertError};
use serde::Serialize;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const AUTHOR_FILE: &str = "author.p12";
const DISTRIBUTOR_FILE: &str = "distributor.p12";
const MAX_P12_BYTES: u64 = 256 * 1024;

fn profile_dir(data_dir: &Path, name: &str) -> PathBuf {
    data_dir.join("certificates").join(name)
}

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(tmp, path)
}

fn sdb_error(e: &SdbError) -> ApiError {
    match e {
        SdbError::Cancelled => ApiError::new("cancelled"),
        SdbError::Timeout => ApiError::new("tv_timeout"),
        SdbError::Refused => ApiError::new("tv_port_closed"),
        SdbError::Unreachable => ApiError::new("tv_unreachable"),
        SdbError::NotTizen => ApiError::new("not_a_tv"),
        SdbError::Closed => ApiError::new("tv_connection_lost"),
        SdbError::SyncFailed(reason) => ApiError::with("upload_failed", reason.clone()),
        other => ApiError::with("tv_rejected", other.to_string()),
    }
}

fn ca_error(e: CaError) -> ApiError {
    match e {
        CaError::Cancelled => ApiError::new("cancelled"),
        CaError::AuthTimeout => ApiError::new("samsung_auth_timeout"),
        CaError::AuthInvalid => ApiError::new("samsung_auth_invalid"),
        CaError::PortUnavailable => ApiError::new("samsung_auth_port"),
        CaError::RateLimited => ApiError::new("samsung_rate_limited"),
        CaError::Http(status) => ApiError::with("samsung_api_error", format!("HTTP {status}")),
        CaError::Network(reason) => ApiError::with("samsung_network", reason),
        CaError::BadCertificate => ApiError::new("samsung_bad_certificate"),
        other => ApiError::with("certificate_failed", other.to_string()),
    }
}

fn identity_error(e: IdentityError) -> ApiError {
    match e {
        IdentityError::BadPasswordOrFormat => ApiError::new("cert_password_wrong"),
        other => ApiError::with("cert_file_invalid", other.to_string()),
    }
}

// ---------- TVs ----------

#[derive(Serialize, Clone)]
struct ScanProgress {
    op_id: Option<String>,
    fraction: f32,
}

#[derive(Serialize, Clone)]
struct ScanFound {
    op_id: Option<String>,
    device: FoundTv,
}

pub async fn scan(
    app: &AppHandle,
    state: &AppState,
    subnet: Option<String>,
    op_id: Option<String>,
    cancel: CancelToken,
) -> ApiResult<Outcome<ScanData>> {
    let (port, timeout_ms, saved) = {
        let s = state.settings.lock().unwrap();
        let saved: Vec<Ipv4Addr> = s
            .devices
            .iter()
            .filter(|d| d.port == s.default_port)
            .filter_map(|d| d.ip.parse().ok())
            .collect();
        (s.default_port, s.timeout_ms, saved)
    };
    let only_hosts = subnet.map(|prefix| {
        (1..=254u8)
            .filter_map(|i| format!("{prefix}.{i}").parse::<Ipv4Addr>().ok())
            .collect::<Vec<_>>()
    });
    let opts = DiscoverOptions {
        sdb_port: port,
        connect_timeout: Duration::from_millis(timeout_ms.clamp(400, 1500)),
        saved_hosts: saved,
        only_hosts,
        ..Default::default()
    };
    let app = app.clone();
    let report = tauri::async_runtime::spawn_blocking(move || {
        let last = std::sync::atomic::AtomicU32::new(u32::MAX);
        discovery::discover(
            &opts,
            &cancel,
            &|fraction| {
                let percent = (fraction * 100.0) as u32;
                if last.swap(percent, std::sync::atomic::Ordering::Relaxed) != percent {
                    let _ = app.emit(
                        "scan-progress",
                        ScanProgress {
                            op_id: op_id.clone(),
                            fraction,
                        },
                    );
                }
            },
            &|device| {
                let _ = app.emit(
                    "scan-found",
                    ScanFound {
                        op_id: op_id.clone(),
                        device: device.clone(),
                    },
                );
            },
        )
    })
    .await
    .map_err(|_| ApiError::new("internal"))?;
    applog::info(
        "scan",
        format!(
            "{} host(s) on [{}]: {} TV(s){}",
            report.swept_hosts,
            report.networks.join(", "),
            report.devices.len(),
            if report.cancelled { ", cancelled" } else { "" }
        ),
    );
    if report.cancelled {
        return Ok(fail(Diagnosis::Cancelled, None));
    }
    if report.swept_hosts == 0 {
        return Ok(fail(Diagnosis::NoNetwork, None));
    }
    Ok(success(ScanData {
        devices: report.devices,
        networks: report.networks,
        interfaces: report.interfaces,
        swept_hosts: report.swept_hosts,
    }))
}

fn check_options(state: &AppState, port: u16, read_identity: bool) -> CheckOptions {
    CheckOptions {
        sdb_port: port,
        timeout: Duration::from_millis(state.settings.lock().unwrap().timeout_ms.max(3000)),
        read_identity,
        ..Default::default()
    }
}

/// Full connection: every readiness condition, then the TV's identity; saved on success.
pub async fn connect(
    state: &AppState,
    ip: Ipv4Addr,
    port: u16,
    remember: bool,
    cancel: CancelToken,
) -> ApiResult<ConnectOutcome> {
    let opts = check_options(state, port, true);
    let check = tauri::async_runtime::spawn_blocking(move || {
        discovery::check_connection(ip, &opts, &cancel)
    })
    .await
    .map_err(|_| ApiError::new("internal"))?;
    let host_ip = check.host_ip.clone();
    if !check.sdb_ok {
        let diagnosis = check.diagnosis.unwrap_or(Diagnosis::Unknown);
        if diagnosis != Diagnosis::Cancelled {
            applog::warn(
                "connect",
                format!(
                    "{ip}:{port} {:?} (port {:?}, device API {}, developer mode {:?}, host ip match {:?}) {}",
                    diagnosis,
                    check.sdb_port,
                    check.samsung.is_some(),
                    check.samsung.as_ref().and_then(|s| s.developer_mode),
                    check.host_ip_matches,
                    check.technical.as_deref().unwrap_or("")
                ),
            );
        }
        return Ok(ConnectOutcome {
            outcome: fail(diagnosis, check.technical.clone()),
            host_ip,
            check,
        });
    }
    let identity = check.identity.clone();
    let api_name = check.samsung.as_ref().and_then(|a| a.name.clone());
    let model = check
        .samsung
        .as_ref()
        .and_then(|a| a.model_name.clone())
        .or_else(|| identity.as_ref().and_then(|i| i.model.clone()));
    let tizen = identity.as_ref().and_then(|i| i.platform_version.clone());
    let duid = identity.as_ref().and_then(|i| i.duid.clone());
    let name = if remember {
        remember_device(
            state,
            &ip.to_string(),
            port,
            api_name.clone(),
            duid.clone(),
            model.clone(),
            tizen.clone(),
        )
    } else {
        api_name.unwrap_or_else(|| format!("Samsung TV {ip}"))
    };
    applog::info(
        "connect",
        format!(
            "{ip}:{port} ready (tizen {}, duid {})",
            tizen.as_deref().unwrap_or("?"),
            if duid.is_some() {
                "read"
            } else {
                "not readable"
            }
        ),
    );
    Ok(ConnectOutcome {
        outcome: success(TvInfo {
            ip: ip.to_string(),
            port,
            duid,
            name,
            model,
            tizen_version: tizen,
            host_ip: host_ip.clone(),
        }),
        host_ip,
        check,
    })
}

/// Availability of a TV without connecting fully or changing anything.
pub async fn check(
    state: &AppState,
    ip: Ipv4Addr,
    port: u16,
    cancel: CancelToken,
) -> ApiResult<TvCheck> {
    let opts = check_options(state, port, false);
    tauri::async_runtime::spawn_blocking(move || discovery::check_connection(ip, &opts, &cancel))
        .await
        .map_err(|_| ApiError::new("internal"))
}

pub async fn uninstall(state: &AppState, ip: Ipv4Addr, port: u16, app_id: String) -> ApiResult<()> {
    if !sdb::is_safe_shell_word(&app_id) {
        return Err(ApiError::new("invalid_app_id"));
    }
    let timeout = Duration::from_millis(state.settings.lock().unwrap().timeout_ms.max(3000));
    let out = tauri::async_runtime::spawn_blocking(move || {
        sdb::uninstall_app(ip, port, &app_id, timeout, &CancelToken::new())
    })
    .await
    .map_err(|_| ApiError::new("internal"))?
    .map_err(|e| sdb_error(&e))?;
    if !sdb::uninstall_succeeded(&out) {
        applog::warn("uninstall", out.clone());
        return Err(ApiError::with("uninstall_failed", out));
    }
    Ok(())
}

// ---------- certificates ----------

#[derive(Serialize, Clone)]
struct CertProgress {
    op_id: Option<String>,
    /// "signin" | "author" | "distributor" | "saving"
    stage: &'static str,
    /// Samsung sign-in page (only with `signin`), so the UI can offer to open it again.
    url: Option<String>,
}

fn profile_from(
    name: &str,
    identity: &str,
    author: &SigningIdentity,
    distributor: &SigningIdentity,
    imported: bool,
) -> SavedCertificateProfile {
    let mut profile = SavedCertificateProfile::new(
        name.to_string(),
        identity.to_string(),
        distributor.info.duids.clone(),
    );
    profile.imported = imported;
    if distributor.info.duids.is_empty() && tizen_cert::is_sdk_distributor(&distributor.info.issuer)
    {
        // The SDK's public distributor signer expired long ago and TVs before Tizen 7 do not
        // check it; only the author certificate's date is meaningful.
        profile.kind = CertKind::Tizen;
        profile.expires_at = Some(author.info.not_after);
    } else {
        profile.expires_at = Some(author.info.not_after.min(distributor.info.not_after));
    }
    profile
}

/// Whether `distributor` is usable as a profile's distributor certificate.
fn acceptable_distributor(distributor: &SigningIdentity) -> bool {
    !distributor.info.duids.is_empty() || tizen_cert::is_sdk_distributor(&distributor.info.issuer)
}

fn tizen_cert_error(e: TizenCertError) -> ApiError {
    match e {
        TizenCertError::Network(reason) => ApiError::with("tizen_cert_download_failed", reason),
        TizenCertError::NotThePackage => ApiError::new("tizen_cert_not_package"),
        TizenCertError::Mismatch => ApiError::new("tizen_cert_mismatch"),
        TizenCertError::InvalidName => ApiError::new("invalid_identity"),
        TizenCertError::Crypto => ApiError::new("cert_create_failed"),
        TizenCertError::Identity(e) => identity_error(e),
    }
}

/// Creates a Tizen certificate profile: no Samsung account, no DUID. The SDK's certificate
/// package is downloaded from download.tizen.org, or read from a copy the user picked, and
/// checked against pinned hashes. Only the new profile's two keystores are kept.
pub async fn create_tizen_certificate(
    app: &AppHandle,
    state: &AppState,
    args: &crate::api::CreateTizenCertificateArgs,
    op_id: Option<String>,
    cancel: CancelToken,
) -> ApiResult<SavedCertificateProfile> {
    let dir = profile_dir(&state.data_dir, &args.profile_name);
    let scratch = state
        .cache_dir
        .join("import")
        .join("certificate-generator.zip");
    let (name, identity, password, source) = (
        args.profile_name.clone(),
        args.identity.clone(),
        args.password.clone(),
        args.package_source.clone(),
    );
    let app = app.clone();
    let worker_password = password.clone();
    let profile =
        tauri::async_runtime::spawn_blocking(move || -> ApiResult<SavedCertificateProfile> {
            let password = worker_password;
            let emit = |stage: &'static str| {
                let _ = app.emit(
                    "cert-progress",
                    CertProgress {
                        op_id: op_id.clone(),
                        stage,
                        url: None,
                    },
                );
            };
            let package = match source {
                Some(source) => {
                    emit("reading");
                    if let Some(parent) = scratch.parent() {
                        std::fs::create_dir_all(parent).map_err(|_| ApiError::new("io_error"))?;
                    }
                    let copied = crate::api::copy_picked_file(
                        &app,
                        &source,
                        &scratch,
                        tizen_cert::MAX_PACKAGE_BYTES,
                    );
                    let bytes = copied.and_then(|_| {
                        std::fs::read(&scratch).map_err(|_| ApiError::new("io_error"))
                    });
                    let _ = std::fs::remove_file(&scratch);
                    bytes.map_err(|e| {
                        if e.code == "pkg_too_large" {
                            ApiError::new("tizen_cert_not_package")
                        } else {
                            e
                        }
                    })?
                }
                None => {
                    emit("download");
                    tizen_cert::download_package(Duration::from_secs(180))
                        .map_err(tizen_cert_error)?
                }
            };
            if cancel.is_cancelled() {
                return Err(ApiError::new("cancelled"));
            }
            emit("author");
            let signers = tizen_cert::read_package(&package, &tizen_cert::SDK_PINS)
                .map_err(tizen_cert_error)?;
            let created = signers
                .create_profile(&identity, &password, crate::now_secs())
                .map_err(tizen_cert_error)?;
            let author = SigningIdentity::from_p12(&created.author_p12, &password)
                .map_err(identity_error)?;
            let distributor = SigningIdentity::from_p12(&created.distributor_p12, &password)
                .map_err(identity_error)?;
            if cancel.is_cancelled() {
                return Err(ApiError::new("cancelled"));
            }
            emit("saving");
            write_private(&dir.join(AUTHOR_FILE), &created.author_p12)
                .map_err(|_| ApiError::new("io_error"))?;
            write_private(&dir.join(DISTRIBUTOR_FILE), &created.distributor_p12)
                .map_err(|_| ApiError::new("io_error"))?;
            let profile = profile_from(&name, &identity, &author, &distributor, false);
            if !profile.is_tizen() {
                let _ = std::fs::remove_dir_all(&dir);
                return Err(ApiError::new("tizen_cert_mismatch"));
            }
            Ok(profile)
        })
        .await
        .map_err(|_| ApiError::new("internal"))??;
    state
        .passwords
        .lock()
        .unwrap()
        .insert(profile.name.clone(), password);
    Ok(profile)
}

pub async fn create_certificate(
    app: &AppHandle,
    state: &AppState,
    args: &CreateCertificateArgs,
    op_id: Option<String>,
    cancel: CancelToken,
) -> ApiResult<SavedCertificateProfile> {
    use tauri_plugin_opener::OpenerExt;
    let dir = profile_dir(&state.data_dir, &args.profile_name);
    let (name, identity, password, duids) = (
        args.profile_name.clone(),
        args.identity.clone(),
        args.password.clone(),
        args.duids.clone(),
    );
    let app = app.clone();
    let worker_password = password.clone();
    let profile = tauri::async_runtime::spawn_blocking(move || -> ApiResult<SavedCertificateProfile> {
        let password = worker_password;
        let emit = |stage: &'static str, url: Option<String>| {
            let _ = app.emit("cert-progress", CertProgress { op_id: op_id.clone(), stage, url });
        };
        let author_path = dir.join(AUTHOR_FILE);
        let distributor_path = dir.join(DISTRIBUTOR_FILE);

        // An author certificate left by an interrupted attempt is reused, not re-issued.
        let existing_author = match std::fs::read(&author_path) {
            Ok(bytes) => Some(SigningIdentity::from_p12(&bytes, &password).map_err(|_| {
                ApiError::with(
                    "cert_password_wrong",
                    "An unfinished certificate with this profile name already exists. Enter the password you used then, or choose another profile name.",
                )
            })?),
            Err(_) => None,
        };

        let session = OAuthSession::start().map_err(ca_error)?;
        let url = session.sign_in_url();
        emit("signin", Some(url.clone()));
        // If the browser cannot be opened the UI still shows the link.
        let _ = app.opener().open_url(url, None::<&str>);
        let token = session.wait(samsung_ca::oauth::AUTH_TIMEOUT, &cancel).map_err(ca_error)?;
        let client = CaClient::default();

        let author = match existing_author {
            Some(identity) => identity,
            None => {
                emit("author", None);
                let p12 = samsung_ca::issue_author(&client, &token, &identity, &password).map_err(ca_error)?;
                let loaded = SigningIdentity::from_p12(&p12, &password).map_err(identity_error)?;
                write_private(&author_path, &p12).map_err(|_| ApiError::new("io_error"))?;
                loaded
            }
        };
        if cancel.is_cancelled() {
            return Err(ApiError::new("cancelled"));
        }

        emit("distributor", None);
        let p12 = samsung_ca::issue_distributor(&client, &token, &duids, &password).map_err(ca_error)?;
        let distributor = SigningIdentity::from_p12(&p12, &password).map_err(identity_error)?;
        if !duids.iter().all(|d| distributor.info.duids.iter().any(|c| c.eq_ignore_ascii_case(d))) {
            return Err(ApiError::new("samsung_bad_certificate"));
        }
        emit("saving", None);
        write_private(&distributor_path, &p12).map_err(|_| ApiError::new("io_error"))?;
        Ok(profile_from(&name, &identity, &author, &distributor, false))
    })
    .await
    .map_err(|_| ApiError::new("internal"))??;
    state
        .passwords
        .lock()
        .unwrap()
        .insert(profile.name.clone(), password);
    Ok(profile)
}

fn read_keystore(app: &AppHandle, source: &str, scratch: &Path) -> ApiResult<Vec<u8>> {
    let size = crate::api::copy_picked_file(app, source, scratch, MAX_P12_BYTES).map_err(|e| {
        if e.code == "pkg_too_large" {
            ApiError::new("cert_file_invalid")
        } else {
            e
        }
    })?;
    let bytes = std::fs::read(scratch).map_err(|_| ApiError::new("io_error"));
    let _ = std::fs::remove_file(scratch);
    if size == 0 {
        return Err(ApiError::new("cert_file_invalid"));
    }
    bytes
}

/// Imports an existing Samsung author + distributor pair (e.g. exported from Tizen Studio).
/// Both keystores are re-encrypted under the author password, which becomes the profile's
/// password.
pub async fn import_certificate(
    app: &AppHandle,
    state: &AppState,
    args: &ImportCertificateArgs,
) -> ApiResult<SavedCertificateProfile> {
    let dir = profile_dir(&state.data_dir, &args.profile_name);
    let scratch_dir = state.cache_dir.join("import");
    let app = app.clone();
    let (name, author_source, distributor_source, author_password, distributor_password) = (
        args.profile_name.clone(),
        args.author_source.clone(),
        args.distributor_source.clone(),
        args.author_password.clone(),
        args.distributor_password.clone(),
    );
    let session_password = author_password.clone();
    let profile =
        tauri::async_runtime::spawn_blocking(move || -> ApiResult<SavedCertificateProfile> {
            std::fs::create_dir_all(&scratch_dir).map_err(|_| ApiError::new("io_error"))?;
            let author_bytes =
                read_keystore(&app, &author_source, &scratch_dir.join("author.tmp"))?;
            let distributor_bytes = read_keystore(
                &app,
                &distributor_source,
                &scratch_dir.join("distributor.tmp"),
            )?;
            let author =
                SigningIdentity::from_p12(&author_bytes, &author_password).map_err(|e| {
                    ApiError {
                        code: format!("author_{}", identity_error(e).code),
                        detail: None,
                    }
                })?;
            let distributor = SigningIdentity::from_p12(&distributor_bytes, &distributor_password)
                .map_err(|e| ApiError {
                    code: format!("distributor_{}", identity_error(e).code),
                    detail: None,
                })?;
            if !acceptable_distributor(&distributor) {
                return Err(ApiError::new("not_a_distributor_certificate"));
            }
            if !author.info.duids.is_empty() {
                return Err(ApiError::new("not_an_author_certificate"));
            }
            let author_p12 = author
                .repack("author", &author_password)
                .map_err(identity_error)?;
            let distributor_p12 = distributor
                .repack("distributor", &author_password)
                .map_err(identity_error)?;
            write_private(&dir.join(AUTHOR_FILE), &author_p12)
                .map_err(|_| ApiError::new("io_error"))?;
            write_private(&dir.join(DISTRIBUTOR_FILE), &distributor_p12)
                .map_err(|_| ApiError::new("io_error"))?;
            Ok(profile_from(
                &name,
                &author.info.subject,
                &author,
                &distributor,
                true,
            ))
        })
        .await
        .map_err(|_| ApiError::new("internal"))??;
    state
        .passwords
        .lock()
        .unwrap()
        .insert(profile.name.clone(), session_password);
    Ok(profile)
}

pub fn remove_certificate(state: &AppState, name: &str) -> ApiResult<()> {
    let dir = profile_dir(&state.data_dir, name);
    match std::fs::remove_dir_all(&dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(ApiError::new("io_error")),
        _ => Ok(()),
    }
}

// ---------- certificates made by versions that used the Tizen SDK ----------

/// The SDK's data folder: `TIZEN_SDK_DATA_PATH` from `sdk.info`, else `<sdk>-data` next to it.
fn sdk_data_dir(sdk: &Path) -> PathBuf {
    let info = std::fs::read_to_string(sdk.join("sdk.info")).unwrap_or_default();
    if let Some(value) = info.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        (key.trim() == "TIZEN_SDK_DATA_PATH").then(|| value.trim().trim_matches('"').to_string())
    }) {
        let path = PathBuf::from(value);
        if path.is_absolute() {
            return path;
        }
    }
    let name = sdk
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("tizen-sdk");
    sdk.parent().unwrap_or(sdk).join(format!("{name}-data"))
}

/// Folders where an older EasyTizen (through the Tizen SDK) or Tizen Studio kept a Samsung
/// profile's `author.p12` and `distributor.p12`.
pub fn legacy_profile_dirs(
    sdk_path: Option<&Path>,
    home: Option<&Path>,
    name: &str,
) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(sdk) = sdk_path {
        dirs.push(
            sdk_data_dir(sdk)
                .join("keystore")
                .join("samsung")
                .join(name),
        );
    }
    if let Some(home) = home {
        dirs.push(home.join("SamsungCertificate").join(name));
        for sdk in ["tizen-studio", "tizen-sdk"] {
            dirs.push(
                home.join(format!("{sdk}-data"))
                    .join("keystore")
                    .join("samsung")
                    .join(name),
            );
        }
    }
    dirs
}

pub async fn transfer_legacy_certificate(
    state: &AppState,
    profile: &SavedCertificateProfile,
    sdk_path: Option<String>,
    password: String,
) -> ApiResult<SavedCertificateProfile> {
    let target = profile_dir(&state.data_dir, &profile.name);
    let name = profile.name.clone();
    let identity = profile.identity.clone();
    let session_password = password.clone();
    let moved =
        tauri::async_runtime::spawn_blocking(move || -> ApiResult<SavedCertificateProfile> {
            let home = std::env::var_os("HOME")
                .or_else(|| std::env::var_os("USERPROFILE"))
                .map(PathBuf::from);
            let source =
                legacy_profile_dirs(sdk_path.as_deref().map(Path::new), home.as_deref(), &name)
                    .into_iter()
                    .find(|d| d.join(AUTHOR_FILE).is_file() && d.join(DISTRIBUTOR_FILE).is_file())
                    .ok_or_else(|| ApiError::new("legacy_cert_files_missing"))?;
            let read = |file: &str| -> ApiResult<Vec<u8>> {
                let path = source.join(file);
                if std::fs::metadata(&path)
                    .map(|m| m.len())
                    .unwrap_or(u64::MAX)
                    > MAX_P12_BYTES
                {
                    return Err(ApiError::new("cert_file_invalid"));
                }
                std::fs::read(&path).map_err(|_| ApiError::new("cert_file_invalid"))
            };
            let author = SigningIdentity::from_p12(&read(AUTHOR_FILE)?, &password)
                .map_err(identity_error)?;
            let distributor = SigningIdentity::from_p12(&read(DISTRIBUTOR_FILE)?, &password)
                .map_err(identity_error)?;
            if !acceptable_distributor(&distributor) {
                return Err(ApiError::new("not_a_distributor_certificate"));
            }
            // Copies in EasyTizen's own store; the SDK's files are left exactly as they were.
            write_private(
                &target.join(AUTHOR_FILE),
                &author.repack("author", &password).map_err(identity_error)?,
            )
            .map_err(|_| ApiError::new("io_error"))?;
            write_private(
                &target.join(DISTRIBUTOR_FILE),
                &distributor
                    .repack("distributor", &password)
                    .map_err(identity_error)?,
            )
            .map_err(|_| ApiError::new("io_error"))?;
            let mut profile = profile_from(&name, &identity, &author, &distributor, true);
            profile.engine = Engine::Builtin;
            Ok(profile)
        })
        .await
        .map_err(|_| ApiError::new("internal"))??;
    state
        .passwords
        .lock()
        .unwrap()
        .insert(moved.name.clone(), session_password);
    Ok(moved)
}

// ---------- install ----------

#[derive(Serialize, Clone)]
struct InstallProgress {
    op_id: Option<String>,
    /// "signing" | "connecting" | "uploading" | "installing" | "verifying" | "launching"
    stage: &'static str,
    /// 0–1 for stages that report progress (signing, uploading, installing); otherwise 0.
    fraction: f32,
}

fn stage_name(stage: InstallStage) -> &'static str {
    match stage {
        InstallStage::Connecting => "connecting",
        InstallStage::Uploading => "uploading",
        InstallStage::Installing => "installing",
        InstallStage::Verifying => "verifying",
        InstallStage::Launching => "launching",
    }
}

/// `(in app list, launched, profile name + password that proved correct)`.
type InstallDone = (Option<bool>, Option<bool>, Option<(String, String)>);

pub async fn install(
    app: &AppHandle,
    state: &AppState,
    job: InstallJob,
) -> ApiResult<InstallResult> {
    let InstallJob {
        args,
        report,
        profile,
        ip,
        port,
        op_id,
        cancel,
    } = job;
    let app_id = report
        .app_id
        .clone()
        .filter(|id| sdb::is_safe_shell_word(id))
        .ok_or_else(|| ApiError::new("pkg_no_app_id"))?;

    // Resolve the certificate password before any slow work, so the UI can ask for it.
    let signing = match &profile {
        Some(profile) => {
            let password = args
                .password
                .clone()
                .filter(|p| !p.is_empty())
                .or_else(|| state.passwords.lock().unwrap().get(&profile.name).cloned())
                .ok_or_else(|| ApiError::new("cert_password_required"))?;
            Some((profile.clone(), password))
        }
        None => None,
    };

    let data_dir = state.data_dir.clone();
    let staging = state.cache_dir.join("signed-packages");
    let timeout = Duration::from_millis(state.settings.lock().unwrap().timeout_ms.max(3000));
    let app = app.clone();
    let source = PathBuf::from(&args.package_path);
    let run_after_install = args.run_after_install;
    let duid = args.duid.clone();
    let package_id = report
        .package_id
        .clone()
        .filter(|p| sdb::is_safe_shell_word(p));

    let worker = tauri::async_runtime::spawn_blocking(move || -> ApiResult<InstallDone> {
        let last = std::cell::Cell::new((String::new(), u32::MAX));
        let emit = |stage: &'static str, fraction: f32| {
            let key = (stage.to_string(), (fraction * 100.0) as u32);
            if last.replace(key.clone()) != key {
                let _ = app.emit(
                    "install-progress",
                    InstallProgress {
                        op_id: op_id.clone(),
                        stage,
                        fraction,
                    },
                );
            }
        };

        let mut verified_password = None;
        let package = match &signing {
            Some((profile, password)) => {
                emit("signing", 0.0);
                let dir = profile_dir(&data_dir, &profile.name);
                let load = |file: &str| -> ApiResult<SigningIdentity> {
                    let bytes = std::fs::read(dir.join(file))
                        .map_err(|_| ApiError::new("certificate_profile_missing"))?;
                    SigningIdentity::from_p12(&bytes, password).map_err(identity_error)
                };
                let author = load(AUTHOR_FILE)?;
                let distributor = load(DISTRIBUTOR_FILE)?;
                verified_password = Some((profile.name.clone(), password.clone()));
                let now = crate::now_secs();
                // A Tizen certificate's distributor signer expired years ago; TVs before
                // Tizen 7 do not check its date (nor, as far as known, the author's), so the
                // TV decides. A Samsung certificate must still be valid.
                if !profile.is_tizen()
                    && (author.info.not_after < now || distributor.info.not_after < now)
                {
                    return Err(ApiError::new("cert_expired"));
                }
                let covered = profile.is_tizen()
                    || duid
                        .as_deref()
                        .map(|d| {
                            distributor
                                .info
                                .duids
                                .iter()
                                .any(|c| c.eq_ignore_ascii_case(d))
                        })
                        .unwrap_or(false);
                if !covered {
                    return Err(ApiError::new("profile_duid_mismatch"));
                }
                std::fs::create_dir_all(&staging).map_err(|_| ApiError::new("io_error"))?;
                let signed = staging.join(format!("easytizen-{}.wgt", crate::now_millis()));
                sign_wgt(&source, &signed, &author, &distributor, &cancel, &mut |f| {
                    emit("signing", f)
                })
                .map_err(|e| {
                    // Never leave a half-written working copy behind.
                    let _ = std::fs::remove_file(&signed);
                    match e {
                        SignError::Cancelled => ApiError::new("cancelled"),
                        SignError::Package(p) => crate::api::package_error(&p),
                        other => ApiError::with("sign_failed", other.to_string()),
                    }
                })?;
                signed
            }
            None => source.clone(),
        };
        let is_working_copy = package != source;
        let cleanup = || {
            if is_working_copy {
                let _ = std::fs::remove_file(&package);
            }
        };

        let outcome = std::fs::File::open(&package)
            .map_err(|_| ApiError::new("pkg_unreadable"))
            .and_then(|mut file| {
                let size = file
                    .metadata()
                    .map(|m| m.len())
                    .map_err(|_| ApiError::new("pkg_unreadable"))?;
                sdb::install_wgt(
                    ip,
                    port,
                    &mut file,
                    size,
                    &app_id,
                    package_id.as_deref(),
                    run_after_install,
                    timeout,
                    &cancel,
                    &mut |s, f| emit(stage_name(s), f),
                )
                .map_err(|e| sdb_error(&e))
            });
        cleanup();
        // Record where a connection problem happened (connecting, uploading, installing …):
        // the log and the history then tell a refused upload from a refused installation.
        let outcome = outcome.map_err(|mut e| {
            let (stage, percent) = last.take();
            if e.detail.is_none() && !stage.is_empty() && e.code != "cancelled" {
                e.detail = Some(if percent <= 100 && stage == "uploading" {
                    format!("stage: {stage} ({percent} %)")
                } else {
                    format!("stage: {stage}")
                });
            }
            e
        })?;
        match outcome.verdict {
            InstallVerdict::Installed => {
                Ok((outcome.in_app_list, outcome.launched, verified_password))
            }
            InstallVerdict::Failed(kind) => {
                let code = match kind {
                    InstallFailure::CertificateRejected => "tv_cert_rejected",
                    InstallFailure::AuthorMismatch => "tv_author_mismatch",
                    InstallFailure::NoSpace => "tv_no_space",
                    InstallFailure::Unrecognised => "install_unrecognised",
                    InstallFailure::Other => "install_failed",
                };
                Err(ApiError::with(code, outcome.log))
            }
        }
    })
    .await
    .map_err(|_| ApiError::new("internal"))?;

    match worker {
        Ok((in_app_list, launched, verified)) => {
            if let Some((name, password)) = verified {
                state.passwords.lock().unwrap().insert(name, password);
            }
            Ok(InstallResult {
                app_name: report.app_name,
                app_id: report.app_id,
                version: report.version,
                tv_ip: ip.to_string(),
                in_app_list,
                launched,
            })
        }
        Err(e) => {
            if e.code == "cert_password_wrong" {
                if let Some(profile) = &profile {
                    state.passwords.lock().unwrap().remove(&profile.name);
                }
            }
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_files_are_owner_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("certificates/p/author.p12");
        write_private(&path, b"secret").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"secret");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert!(!path.with_extension("tmp").exists());
    }

    #[test]
    fn legacy_profile_locations() {
        let root = tempfile::tempdir().unwrap();
        let sdk = root.path().join("tizen studio");
        std::fs::create_dir_all(&sdk).unwrap();
        let dirs = legacy_profile_dirs(Some(&sdk), Some(root.path()), "Mine");
        assert_eq!(
            dirs[0],
            root.path().join("tizen studio-data/keystore/samsung/Mine")
        );
        assert_eq!(dirs[1], root.path().join("SamsungCertificate/Mine"));
        std::fs::write(sdk.join("sdk.info"), "TIZEN_SDK_DATA_PATH=/data/tz\n").unwrap();
        let dirs = legacy_profile_dirs(Some(&sdk), None, "Mine");
        assert_eq!(dirs, [PathBuf::from("/data/tz/keystore/samsung/Mine")]);
    }

    #[test]
    fn error_codes_do_not_carry_secrets() {
        assert_eq!(sdb_error(&SdbError::Cancelled).code, "cancelled");
        assert_eq!(sdb_error(&SdbError::NotTizen).code, "not_a_tv");
        let e = ca_error(CaError::Network("password=hunter2".into()));
        assert_eq!(e.code, "samsung_network");
        assert_eq!(e.detail.as_deref(), Some("[redacted line]"));
    }
}
