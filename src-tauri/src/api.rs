//! Tauri commands. The frontend can only reach the system through these typed functions.
//! Every argument is validated here (and again inside `easytizen-core`) before anything runs.
//!
//! There is one engine: EasyTizen's own SDB client, signer and Samsung certificate flow
//! ([`crate::builtin`] on top of `easytizen-core`). Nothing is downloaded or started besides it.

use crate::history::{self, HistoryEntry};
use crate::settings::{self, SavedCertificateProfile, SavedDevice, Settings};
use crate::{applog, builtin, AppState};
use easytizen_core::cancel::CancelToken;
use easytizen_core::checks::{self, ExtraChecks};
use easytizen_core::diagnostics::{self, Diagnosis};
use easytizen_core::discovery::netif::{self, LocalInterface};
use easytizen_core::discovery::{FoundTv, TvCheck};
use easytizen_core::package::{analyze_wgt, PackageError, PackageReport};
use easytizen_core::validate::{self, parse_port, parse_tv_ip};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

#[derive(Debug, Serialize, Clone)]
pub struct ApiError {
    pub code: String,
    pub detail: Option<String>,
}

impl ApiError {
    pub fn new(code: &str) -> Self {
        Self {
            code: code.into(),
            detail: None,
        }
    }
    pub fn with(code: &str, detail: impl Into<String>) -> Self {
        let detail = diagnostics::redact(&detail.into().chars().take(3000).collect::<String>());
        Self {
            code: code.into(),
            detail: (!detail.is_empty()).then_some(detail),
        }
    }
}

impl From<validate::ValidationError> for ApiError {
    fn from(e: validate::ValidationError) -> Self {
        use validate::ValidationError::*;
        ApiError::new(match e {
            BadIp => "invalid_ip",
            ForbiddenIp => "forbidden_ip",
            BadPort => "invalid_port",
            BadSubnet => "invalid_subnet",
            BadSerial => "invalid_serial",
            BadPath => "invalid_path",
            BadTimeout => "invalid_timeout",
        })
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

pub fn register(state: &AppState, op_id: &Option<String>) -> CancelToken {
    let token = CancelToken::new();
    if let Some(id) = op_id {
        state.ops.lock().unwrap().insert(id.clone(), token.clone());
    }
    token
}

pub fn unregister(state: &AppState, op_id: &Option<String>) {
    if let Some(id) = op_id {
        state.ops.lock().unwrap().remove(id);
    }
}

#[tauri::command]
pub fn cancel_operation(state: State<'_, AppState>, op_id: String) {
    if let Some(token) = state.ops.lock().unwrap().get(&op_id) {
        token.cancel();
    }
}

fn save(state: &AppState, s: &Settings) -> ApiResult<()> {
    settings::save(&state.data_dir, s).map_err(|e| {
        applog::error("settings", format!("cannot save settings: {:?}", e.kind()));
        ApiError::new("io_error")
    })
}

// ---------- shared result shapes ----------

#[derive(Serialize)]
pub struct Outcome<T> {
    pub ok: bool,
    pub data: Option<T>,
    pub diagnosis: Option<Diagnosis>,
    /// Sanitised message for an expandable "technical details" area.
    pub technical: Option<String>,
}

pub fn fail<T>(diagnosis: Diagnosis, technical: Option<String>) -> Outcome<T> {
    Outcome {
        ok: false,
        data: None,
        diagnosis: Some(diagnosis),
        technical,
    }
}

pub fn success<T>(data: T) -> Outcome<T> {
    Outcome {
        ok: true,
        data: Some(data),
        diagnosis: None,
        technical: None,
    }
}

#[derive(Serialize)]
pub struct ScanData {
    pub devices: Vec<FoundTv>,
    /// Swept networks, e.g. `192.168.1.0/24`.
    pub networks: Vec<String>,
    pub interfaces: Vec<LocalInterface>,
    pub swept_hosts: usize,
}

#[derive(Serialize, Clone)]
pub struct TvInfo {
    pub ip: String,
    pub port: u16,
    pub duid: Option<String>,
    pub name: String,
    pub model: Option<String>,
    pub tizen_version: Option<String>,
    pub host_ip: Option<String>,
}

#[derive(Serialize)]
pub struct ConnectOutcome {
    #[serde(flatten)]
    pub outcome: Outcome<TvInfo>,
    pub host_ip: Option<String>,
    /// Every condition that was checked, for the readiness list in the UI.
    pub check: TvCheck,
}

#[derive(Serialize)]
pub struct InstallResult {
    pub app_name: Option<String>,
    pub app_id: Option<String>,
    pub version: Option<String>,
    pub tv_ip: String,
    /// The TV's app list shows the app after installation. `None`: could not be read.
    pub in_app_list: Option<bool>,
    /// `Some(false)` when launching was requested but the TV did not confirm it.
    pub launched: Option<bool>,
}

/// Saves (or refreshes) a TV after a confirmed connection and returns its display name.
pub fn remember_device(
    state: &AppState,
    ip: &str,
    port: u16,
    suggested_name: Option<String>,
    duid: Option<String>,
    model: Option<String>,
    tizen_version: Option<String>,
) -> String {
    let mut s = state.settings.lock().unwrap();
    let existing = s.devices.iter().position(|d| d.ip == ip && d.port == port);
    // The same TV (same DUID) at a new address: update the entry instead of duplicating it.
    let existing = existing.or_else(|| {
        duid.as_ref()
            .and_then(|id| s.devices.iter().position(|d| d.duid.as_ref() == Some(id)))
    });
    let name = match existing {
        Some(i) => {
            let device = &mut s.devices[i];
            device.ip = ip.to_string();
            device.port = port;
            if duid.is_some() {
                device.duid = duid;
            }
            if model.is_some() {
                device.model = model;
            }
            if tizen_version.is_some() {
                device.tizen_version = tizen_version;
            }
            device.last_connected = Some(crate::now_secs());
            device.name.clone()
        }
        None => {
            let name = suggested_name.unwrap_or_else(|| format!("Samsung TV {ip}"));
            s.devices.push(SavedDevice {
                ip: ip.to_string(),
                port,
                name: name.clone(),
                duid,
                model,
                tizen_version,
                last_connected: Some(crate::now_secs()),
            });
            name
        }
    };
    let _ = save(state, &s);
    name
}

pub fn valid_duid(duid: &str) -> bool {
    easytizen_core::samsung_ca::csr::is_valid_duid(duid)
}

pub fn validate_profile_name(name: &str) -> ApiResult<()> {
    let ok = (3..=64).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if ok {
        Ok(())
    } else {
        Err(ApiError::new("invalid_profile_name"))
    }
}

pub fn validate_cert_password(password: &str) -> ApiResult<()> {
    if password.len() < 8
        || password.len() > 128
        || !password.bytes().any(|c| c.is_ascii_uppercase())
        || !password.bytes().any(|c| c.is_ascii_lowercase())
        || !password.bytes().any(|c| c.is_ascii_digit())
        || password.chars().any(|c| c.is_control())
    {
        return Err(ApiError::new("cert_password_invalid"));
    }
    Ok(())
}

/// The DUIDs must be ones EasyTizen itself read from a connected TV.
pub fn require_verified_duids(state: &AppState, duids: &[String]) -> ApiResult<()> {
    let s = state.settings.lock().unwrap();
    for duid in duids {
        if !valid_duid(duid) {
            return Err(ApiError::new("invalid_duid"));
        }
        if !s
            .devices
            .iter()
            .any(|d| d.duid.as_deref() == Some(duid.as_str()))
        {
            return Err(ApiError::new("duid_not_verified"));
        }
    }
    Ok(())
}

// ---------- app info, settings ----------

#[derive(Serialize)]
pub struct AppInfo {
    version: &'static str,
    /// "android" | "windows" | "macos" | "linux"
    platform: &'static str,
    arch: &'static str,
    mobile: bool,
    /// This device's address on the local network — the value for the TV's "Host PC IP".
    host_ip: Option<String>,
    /// Folder of the log file (shown in Settings and the diagnostics report).
    log_dir: Option<String>,
}

/// The LAN address to show as "Host PC IP": the primary interface if it is a LAN one,
/// otherwise the first private LAN interface.
pub fn lan_host_ip(interfaces: &[LocalInterface]) -> Option<String> {
    interfaces
        .iter()
        .find(|i| i.primary && i.kind.is_lan() && i.private)
        .or_else(|| interfaces.iter().find(|i| i.kind.is_lan() && i.private))
        .or_else(|| interfaces.iter().find(|i| i.kind.is_lan()))
        .map(|i| i.ip.to_string())
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        mobile: cfg!(mobile),
        host_ip: lan_host_ip(&netif::local_interfaces()),
        log_dir: applog::dir().map(|d| d.to_string_lossy().into_owned()),
    }
}

#[derive(Serialize)]
pub struct NetworkInfo {
    pub host_ip: Option<String>,
    pub interfaces: Vec<LocalInterface>,
}

/// Current local addresses (they change when the phone switches Wi-Fi networks).
#[tauri::command]
pub async fn network_info() -> ApiResult<NetworkInfo> {
    tauri::async_runtime::spawn_blocking(|| {
        let interfaces = netif::local_interfaces();
        NetworkInfo {
            host_ip: lan_host_ip(&interfaces),
            interfaces,
        }
    })
    .await
    .map_err(|_| ApiError::new("internal"))
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_preferences(
    state: State<'_, AppState>,
    theme: String,
    language: String,
    default_port: u32,
    timeout_ms: u64,
    check_updates: bool,
) -> ApiResult<()> {
    if !["system", "light", "dark"].contains(&theme.as_str())
        || !["auto", "ru", "en"].contains(&language.as_str())
    {
        return Err(ApiError::new("invalid_setting"));
    }
    let default_port = parse_port(default_port)?;
    let timeout_ms = validate::clamp_timeout_ms(timeout_ms)?;
    let mut s = state.settings.lock().unwrap();
    s.theme = theme;
    s.language = language;
    s.default_port = default_port;
    s.timeout_ms = timeout_ms;
    s.check_updates = check_updates;
    save(&state, &s)
}

#[tauri::command]
pub fn complete_onboarding(state: State<'_, AppState>) -> ApiResult<()> {
    let mut s = state.settings.lock().unwrap();
    s.onboarding_done = true;
    save(&state, &s)
}

// ---------- saved TVs ----------

#[tauri::command]
pub fn remove_device(state: State<'_, AppState>, ip: String, port: u32) -> ApiResult<()> {
    let port = parse_port(port)?;
    let mut s = state.settings.lock().unwrap();
    s.devices.retain(|d| !(d.ip == ip && d.port == port));
    save(&state, &s)
}

#[tauri::command]
pub fn rename_device(
    state: State<'_, AppState>,
    ip: String,
    port: u32,
    name: String,
) -> ApiResult<()> {
    let port = parse_port(port)?;
    let name: String = name
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(60)
        .collect();
    if name.is_empty() {
        return Err(ApiError::new("invalid_name"));
    }
    let mut s = state.settings.lock().unwrap();
    if let Some(d) = s.devices.iter_mut().find(|d| d.ip == ip && d.port == port) {
        d.name = name;
    }
    save(&state, &s)
}

/// Changes a saved TV's address (the router gave it a new one).
#[tauri::command]
pub fn update_device_address(
    state: State<'_, AppState>,
    ip: String,
    port: u32,
    new_ip: String,
    new_port: u32,
) -> ApiResult<()> {
    let port = parse_port(port)?;
    let new_ip = parse_tv_ip(&new_ip)?.to_string();
    let new_port = parse_port(new_port)?;
    let mut s = state.settings.lock().unwrap();
    if s.devices
        .iter()
        .any(|d| d.ip == new_ip && d.port == new_port && !(d.ip == ip && d.port == port))
    {
        return Err(ApiError::new("device_exists"));
    }
    let device = s
        .devices
        .iter_mut()
        .find(|d| d.ip == ip && d.port == port)
        .ok_or_else(|| ApiError::new("device_missing"))?;
    device.ip = new_ip;
    device.port = new_port;
    save(&state, &s)
}

// ---------- TVs ----------

#[tauri::command]
pub async fn scan_tvs(
    app: AppHandle,
    state: State<'_, AppState>,
    subnet: Option<String>,
    op_id: Option<String>,
) -> ApiResult<Outcome<ScanData>> {
    if let Some(s) = &subnet {
        validate::parse_subnet_prefix(s)?;
    }
    let cancel = register(&state, &op_id);
    let result = builtin::scan(&app, &state, subnet, op_id.clone(), cancel).await;
    unregister(&state, &op_id);
    result
}

#[tauri::command]
pub async fn connect_tv(
    state: State<'_, AppState>,
    ip: String,
    port: Option<u32>,
    op_id: Option<String>,
) -> ApiResult<ConnectOutcome> {
    let ip4 = parse_tv_ip(&ip)?;
    let port = match port {
        Some(p) => parse_port(p)?,
        None => state.settings.lock().unwrap().default_port,
    };
    let cancel = register(&state, &op_id);
    let result = builtin::connect(&state, ip4, port, true, cancel).await;
    unregister(&state, &op_id);
    result
}

/// Checks a TV without reading its identity or saving anything (saved TVs' availability).
#[tauri::command]
pub async fn check_tv(
    state: State<'_, AppState>,
    ip: String,
    port: u32,
    op_id: Option<String>,
) -> ApiResult<TvCheck> {
    let ip4 = parse_tv_ip(&ip)?;
    let port = parse_port(port)?;
    let cancel = register(&state, &op_id);
    let result = builtin::check(&state, ip4, port, cancel).await;
    unregister(&state, &op_id);
    result
}

// ---------- packages ----------

pub fn package_error(e: &PackageError) -> ApiError {
    let (code, detail) = match e {
        PackageError::Unreadable => ("pkg_unreadable", None),
        PackageError::NotAFile => ("pkg_not_a_file", None),
        PackageError::UnsupportedExtension => ("pkg_unsupported_extension", None),
        PackageError::Empty => ("pkg_empty", None),
        PackageError::TooLarge => ("pkg_too_large", None),
        PackageError::NotAZip => ("pkg_not_zip", None),
        PackageError::Unsafe(d) => ("pkg_unsafe", Some(d.clone())),
        PackageError::MissingConfig => ("pkg_missing_config", None),
        PackageError::BadConfig(d) => ("pkg_bad_config", Some(d.clone())),
    };
    ApiError {
        code: code.into(),
        detail,
    }
}

#[derive(Serialize)]
pub struct OpenedPackage {
    /// Path the backend will read when installing (the original file on desktop, a private
    /// copy on Android where pickers return `content://` handles).
    path: String,
    report: PackageReport,
}

/// Reads a document the user picked into `destination` (Android `content://` URIs and
/// plain paths alike), with a hard size cap. A partial copy is removed on any failure.
pub fn copy_picked_file(
    app: &AppHandle,
    source: &str,
    destination: &Path,
    cap: u64,
) -> ApiResult<u64> {
    use std::io::{Read, Write};
    use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};
    let file_path: FilePath = source.parse().map_err(|_| ApiError::new("invalid_path"))?;
    let mut options = OpenOptions::new();
    options.read(true);
    let mut input = app
        .fs()
        .open(file_path, options)
        .map_err(|_| ApiError::new("pkg_unreadable"))?;
    let mut output = std::fs::File::create(destination).map_err(|_| ApiError::new("io_error"))?;
    let mut buffer = vec![0u8; 256 * 1024];
    let mut total = 0u64;
    let result = loop {
        let n = match input.read(&mut buffer) {
            Ok(n) => n,
            Err(_) => break Err(ApiError::new("pkg_unreadable")),
        };
        if n == 0 {
            break Ok(total);
        }
        total += n as u64;
        if total > cap {
            break Err(ApiError::new("pkg_too_large"));
        }
        if output.write_all(&buffer[..n]).is_err() {
            break Err(ApiError::new("io_error"));
        }
    };
    if result.is_err() {
        drop(output);
        let _ = std::fs::remove_file(destination);
    }
    result
}

pub fn is_uri(source: &str) -> bool {
    source.starts_with("content://") || source.starts_with("file://")
}

#[tauri::command]
pub async fn open_package(
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
) -> ApiResult<OpenedPackage> {
    let staging = state.cache_dir.join("picked");
    tauri::async_runtime::spawn_blocking(move || {
        let path = if is_uri(&source) {
            std::fs::create_dir_all(&staging).map_err(|_| ApiError::new("io_error"))?;
            // One staged package at a time: drop the previous pick.
            if let Ok(entries) = std::fs::read_dir(&staging) {
                for entry in entries.flatten() {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
            let target = staging.join(format!("package-{}.wgt", crate::now_millis()));
            copy_picked_file(
                &app,
                &source,
                &target,
                easytizen_core::package::MAX_ARCHIVE_BYTES,
            )?;
            target
        } else {
            validate::check_cli_path(&source)?;
            PathBuf::from(&source)
        };
        match analyze_wgt(&path) {
            Ok(report) => Ok(OpenedPackage {
                path: path.to_string_lossy().into_owned(),
                report,
            }),
            Err(e) => {
                if path.starts_with(&staging) {
                    let _ = std::fs::remove_file(&path);
                }
                applog::warn("package", format!("rejected: {e}"));
                Err(package_error(&e))
            }
        }
    })
    .await
    .map_err(|_| ApiError::new("internal"))?
}

/// Additional checks for the package shown in the App step. Returns a disabled report when the
/// user turned them off. `as_is`: the package would be installed without re-signing.
#[tauri::command]
pub async fn verify_package(
    state: State<'_, AppState>,
    path: String,
    as_is: bool,
) -> ApiResult<ExtraChecks> {
    if is_uri(&path) {
        return Err(ApiError::new("invalid_path"));
    }
    validate::check_cli_path(&path)?;
    if !state.settings.lock().unwrap().extra_package_checks {
        return Ok(ExtraChecks::disabled());
    }
    tauri::async_runtime::spawn_blocking(move || checks::run(Path::new(&path), as_is))
        .await
        .map_err(|_| ApiError::new("internal"))?
        .map_err(|e| package_error(&e))
}

#[tauri::command]
pub fn set_extra_package_checks(state: State<'_, AppState>, enabled: bool) -> ApiResult<()> {
    let mut s = state.settings.lock().unwrap();
    s.extra_package_checks = enabled;
    save(&state, &s)
}

// ---------- certificates ----------

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCertificateArgs {
    pub profile_name: String,
    pub identity: String,
    pub password: String,
    /// TVs the distributor certificate should be valid for (first = the connected TV).
    pub duids: Vec<String>,
}

#[tauri::command]
pub async fn create_certificate(
    app: AppHandle,
    state: State<'_, AppState>,
    args: CreateCertificateArgs,
    op_id: Option<String>,
) -> ApiResult<SavedCertificateProfile> {
    validate_profile_name(&args.profile_name)?;
    validate_cert_password(&args.password)?;
    let identity = args.identity.trim().to_string();
    if !(2..=64).contains(&identity.chars().count()) || identity.chars().any(|c| c.is_control()) {
        return Err(ApiError::new("invalid_identity"));
    }
    if args.duids.is_empty() || args.duids.len() > 50 {
        return Err(ApiError::new("invalid_duid"));
    }
    require_verified_duids(&state, &args.duids)?;
    {
        let s = state.settings.lock().unwrap();
        if let Some(existing) = s
            .certificate_profiles
            .iter()
            .find(|p| p.name == args.profile_name)
        {
            if !existing.is_legacy() && args.duids.iter().all(|d| existing.covers(d)) {
                return Ok(existing.clone());
            }
            return Err(ApiError::new("profile_exists"));
        }
    }
    let args = CreateCertificateArgs { identity, ..args };
    let cancel = register(&state, &op_id);
    let result = builtin::create_certificate(&app, &state, &args, op_id.clone(), cancel).await;
    unregister(&state, &op_id);
    let profile =
        result.inspect_err(|e| applog::warn("certificate", format!("create: {}", e.code)))?;
    applog::info("certificate", format!("created profile {}", profile.name));
    let mut s = state.settings.lock().unwrap();
    s.certificate_profiles.retain(|p| p.name != profile.name);
    s.certificate_profiles.push(profile.clone());
    save(&state, &s)?;
    Ok(profile)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCertificateArgs {
    pub profile_name: String,
    /// Paths (desktop) or `content://` URIs (Android) of the two keystores.
    pub author_source: String,
    pub distributor_source: String,
    pub author_password: String,
    pub distributor_password: String,
}

#[tauri::command]
pub async fn import_certificate(
    app: AppHandle,
    state: State<'_, AppState>,
    args: ImportCertificateArgs,
) -> ApiResult<SavedCertificateProfile> {
    validate_profile_name(&args.profile_name)?;
    if args.author_password.is_empty() || args.distributor_password.is_empty() {
        return Err(ApiError::new("cert_password_wrong"));
    }
    if state
        .settings
        .lock()
        .unwrap()
        .certificate_profiles
        .iter()
        .any(|p| p.name == args.profile_name)
    {
        return Err(ApiError::new("profile_exists"));
    }
    let profile = builtin::import_certificate(&app, &state, &args)
        .await
        .inspect_err(|e| applog::warn("certificate", format!("import: {}", e.code)))?;
    let mut s = state.settings.lock().unwrap();
    s.certificate_profiles.push(profile.clone());
    save(&state, &s)?;
    Ok(profile)
}

/// Moves a profile made by an older version through the Tizen SDK into EasyTizen's own store.
/// The SDK's files are read, never changed or deleted.
#[tauri::command]
pub async fn transfer_legacy_certificate(
    state: State<'_, AppState>,
    profile_name: String,
    password: String,
) -> ApiResult<SavedCertificateProfile> {
    validate_profile_name(&profile_name)?;
    if password.is_empty() {
        return Err(ApiError::new("cert_password_wrong"));
    }
    let (profile, sdk_path) = {
        let s = state.settings.lock().unwrap();
        let profile = s
            .certificate_profiles
            .iter()
            .find(|p| p.name == profile_name && p.is_legacy())
            .cloned()
            .ok_or_else(|| ApiError::new("certificate_profile_missing"))?;
        (profile, s.legacy_sdk_path.clone())
    };
    let moved = builtin::transfer_legacy_certificate(&state, &profile, sdk_path, password)
        .await
        .inspect_err(|e| applog::warn("certificate", format!("transfer: {}", e.code)))?;
    let mut s = state.settings.lock().unwrap();
    if let Some(slot) = s
        .certificate_profiles
        .iter_mut()
        .find(|p| p.name == profile_name)
    {
        *slot = moved.clone();
    }
    save(&state, &s)?;
    applog::info(
        "certificate",
        format!("transferred legacy profile {profile_name}"),
    );
    Ok(moved)
}

#[tauri::command]
pub async fn remove_certificate(state: State<'_, AppState>, profile_name: String) -> ApiResult<()> {
    validate_profile_name(&profile_name)?;
    let legacy = state
        .settings
        .lock()
        .unwrap()
        .certificate_profiles
        .iter()
        .find(|p| p.name == profile_name)
        .map(|p| p.is_legacy())
        .ok_or_else(|| ApiError::new("certificate_profile_missing"))?;
    // A legacy profile's keys belong to the Tizen SDK keystore: only the entry is removed.
    if !legacy {
        builtin::remove_certificate(&state, &profile_name)?;
    }
    state.passwords.lock().unwrap().remove(&profile_name);
    let mut s = state.settings.lock().unwrap();
    s.certificate_profiles.retain(|p| p.name != profile_name);
    save(&state, &s)
}

// ---------- install ----------

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallArgs {
    pub package_path: String,
    /// Signing profile; `None` only together with `resign = false` (package already signed).
    pub profile_name: Option<String>,
    pub ip: String,
    pub port: u32,
    pub duid: Option<String>,
    pub run_after_install: bool,
    /// Sign a working copy with the profile (default). `false` installs the file as it is.
    pub resign: bool,
    /// Certificate password; remembered in memory for this session.
    pub password: Option<String>,
    /// The additional checks are off and the user confirmed installing without them.
    #[serde(default)]
    pub checks_skip_confirmed: bool,
}

/// The package gate every installation passes.
///
/// The mandatory archive-safety analysis always runs. The additional checks run when they are
/// enabled and refuse the installation on a blocking finding; when they are disabled the user
/// must have confirmed installing without them.
pub fn package_gate(
    path: &Path,
    extra_enabled: bool,
    as_is: bool,
    skip_confirmed: bool,
) -> ApiResult<(PackageReport, ExtraChecks)> {
    let report = analyze_wgt(path).map_err(|e| package_error(&e))?;
    if !extra_enabled {
        if !skip_confirmed {
            return Err(ApiError::new("checks_skip_not_confirmed"));
        }
        return Ok((report, ExtraChecks::disabled()));
    }
    let extra = checks::run(path, as_is).map_err(|e| package_error(&e))?;
    if !extra.passed() {
        return Err(ApiError::with(
            "pkg_checks_failed",
            extra.blocking_summary(),
        ));
    }
    Ok((report, extra))
}

/// Everything the engine needs to run one installation.
pub struct InstallJob {
    pub args: InstallArgs,
    pub report: PackageReport,
    pub profile: Option<SavedCertificateProfile>,
    pub ip: std::net::Ipv4Addr,
    pub port: u16,
    pub op_id: Option<String>,
    pub cancel: CancelToken,
}

#[tauri::command]
pub async fn install_package(
    app: AppHandle,
    state: State<'_, AppState>,
    args: InstallArgs,
    op_id: Option<String>,
) -> ApiResult<InstallResult> {
    let ip = parse_tv_ip(&args.ip)?;
    let port = parse_port(args.port)?;
    if is_uri(&args.package_path) {
        return Err(ApiError::new("invalid_path"));
    }
    validate::check_cli_path(&args.package_path)?;
    let extra_enabled = state.settings.lock().unwrap().extra_package_checks;
    let (report, _) = tauri::async_runtime::spawn_blocking({
        let path = PathBuf::from(&args.package_path);
        let (as_is, confirmed) = (!args.resign, args.checks_skip_confirmed);
        move || package_gate(&path, extra_enabled, as_is, confirmed)
    })
    .await
    .map_err(|_| ApiError::new("internal"))??;

    let (tv_name, profile) = {
        let s = state.settings.lock().unwrap();
        let device = s
            .devices
            .iter()
            .find(|d| d.ip == ip.to_string() && d.port == port);
        let tv_name = device
            .map(|d| d.name.clone())
            .unwrap_or_else(|| format!("Samsung TV {ip}"));
        let profile = match (&args.profile_name, args.resign) {
            (Some(name), true) => {
                let duid = args
                    .duid
                    .as_deref()
                    .filter(|d| valid_duid(d))
                    .ok_or_else(|| ApiError::new("invalid_duid"))?;
                if device.and_then(|d| d.duid.as_deref()) != Some(duid) {
                    return Err(ApiError::new("duid_not_verified"));
                }
                let profile = s
                    .certificate_profiles
                    .iter()
                    .find(|p| &p.name == name)
                    .cloned()
                    .ok_or_else(|| ApiError::new("certificate_profile_missing"))?;
                if profile.is_legacy() {
                    return Err(ApiError::new("certificate_legacy"));
                }
                if !profile.covers(duid) {
                    return Err(ApiError::new("profile_duid_mismatch"));
                }
                Some(profile)
            }
            (None, true) => return Err(ApiError::new("certificate_profile_missing")),
            (_, false) => None,
        };
        (tv_name, profile)
    };
    if !args.resign && report.signature != easytizen_core::package::SignatureState::SignedStructure
    {
        return Err(ApiError::new("package_not_signed"));
    }

    let cancel = register(&state, &op_id);
    let job = InstallJob {
        args,
        report: report.clone(),
        profile,
        ip,
        port,
        op_id: op_id.clone(),
        cancel,
    };
    applog::info(
        "install",
        format!(
            "start {} ({}) -> {ip}:{port}",
            report.app_id.as_deref().unwrap_or("?"),
            report.file_name
        ),
    );
    let result = builtin::install(&app, &state, job).await;
    unregister(&state, &op_id);

    let (outcome, code, detail) = match &result {
        Ok(_) => ("success", None, None),
        Err(e) if e.code == "cancelled" => ("cancelled", None, None),
        Err(e) => ("failed", Some(e.code.clone()), e.detail.clone()),
    };
    match &result {
        Ok(r) => applog::info(
            "install",
            format!(
                "success on {ip} (app list: {:?}, launched: {:?})",
                r.in_app_list, r.launched
            ),
        ),
        Err(e) => applog::warn(
            "install",
            format!(
                "{outcome}: {} {}",
                e.code,
                e.detail.as_deref().unwrap_or("")
            ),
        ),
    }
    // A wrong or missing password is a prompt, not an installation attempt.
    if !matches!(
        code.as_deref(),
        Some("cert_password_required" | "cert_password_wrong")
    ) {
        let _ = history::append(
            &state.data_dir,
            HistoryEntry {
                time: crate::now_secs(),
                app_name: report.app_name.clone(),
                app_id: report.app_id.clone(),
                version: report.version.clone(),
                file_name: report.file_name.clone(),
                tv_name,
                tv_ip: ip.to_string(),
                result: outcome.into(),
                error_code: code,
                detail,
            },
        );
    }
    result
}

#[tauri::command]
pub async fn uninstall_app(
    state: State<'_, AppState>,
    ip: String,
    port: u32,
    app_id: String,
) -> ApiResult<()> {
    let ip4 = parse_tv_ip(&ip)?;
    let port = parse_port(port)?;
    builtin::uninstall(&state, ip4, port, app_id).await
}

// ---------- history, diagnostics, updates ----------

#[tauri::command]
pub fn get_history(state: State<'_, AppState>) -> Vec<HistoryEntry> {
    history::load(&state.data_dir)
}

#[tauri::command]
pub fn clear_history(state: State<'_, AppState>) -> ApiResult<()> {
    history::clear(&state.data_dir).map_err(|_| ApiError::new("io_error"))
}

fn mask_duid(duid: &str) -> String {
    let tail: String = duid
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("…{tail}")
}

/// A plain-text report for bug reports. Contains no passwords, keys or tokens; DUIDs are
/// shortened and the home folder is replaced with `~`.
#[tauri::command]
pub fn diagnostics_report(state: State<'_, AppState>) -> String {
    let s = state.settings.lock().unwrap().clone();
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok();
    let tidy = |text: &str| match &home {
        Some(h) if !h.is_empty() => text.replace(h.as_str(), "~"),
        _ => text.to_string(),
    };
    let mut lines: Vec<String> = Vec::new();
    lines.push(format!(
        "EasyTizen {} — diagnostics",
        env!("CARGO_PKG_VERSION")
    ));
    lines.push(format!(
        "Platform: {} {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    ));
    let interfaces = netif::local_interfaces();
    lines.push(format!(
        "Host PC IP to enter on the TV: {}",
        lan_host_ip(&interfaces).unwrap_or_else(|| "none (no local network)".into())
    ));
    lines.push("Network interfaces:".into());
    for i in &interfaces {
        lines.push(format!(
            "  {} {}/{} {:?}{}{}",
            i.name,
            i.ip,
            i.prefix_len,
            i.kind,
            if i.primary { " primary" } else { "" },
            if i.scannable() { " searched" } else { "" }
        ));
    }
    lines.push(format!(
        "Default TV port: {}, timeout: {} ms",
        s.default_port, s.timeout_ms
    ));
    lines.push(format!(
        "Additional package checks: {}; automatic updates: {} (update key {})",
        if s.extra_package_checks { "on" } else { "OFF" },
        if s.check_updates { "on" } else { "off" },
        if crate::updates::pubkey().is_some() {
            "present"
        } else {
            "absent"
        }
    ));
    lines.push(format!("\nSaved TVs: {}", s.devices.len()));
    for d in &s.devices {
        lines.push(format!(
            "  {}:{}  model={}  tizen={}  duid={}  last_connected={}",
            d.ip,
            d.port,
            d.model.as_deref().unwrap_or("?"),
            d.tizen_version.as_deref().unwrap_or("?"),
            d.duid
                .as_deref()
                .map(mask_duid)
                .unwrap_or_else(|| "none".into()),
            d.last_connected
                .map(applog::format_utc)
                .unwrap_or_else(|| "never".into())
        ));
    }
    lines.push(format!(
        "\nCertificate profiles: {}",
        s.certificate_profiles.len()
    ));
    for p in &s.certificate_profiles {
        lines.push(format!(
            "  {}  {}  tvs={}  imported={}  expires={}",
            p.name,
            if p.is_legacy() {
                "legacy-sdk (needs transfer)"
            } else {
                "ready"
            },
            p.duids
                .iter()
                .map(|d| mask_duid(d))
                .collect::<Vec<_>>()
                .join(","),
            p.imported,
            p.expires_at
                .map(applog::format_utc)
                .unwrap_or_else(|| "?".into())
        ));
    }
    let entries = history::load(&state.data_dir);
    lines.push(format!("\nRecent installations: {}", entries.len().min(10)));
    for e in entries.iter().take(10) {
        lines.push(format!(
            "  {}  {}  {} -> {}  {}{}",
            applog::format_utc(e.time),
            e.result,
            e.app_id.as_deref().unwrap_or(&e.file_name),
            e.tv_ip,
            e.error_code.as_deref().unwrap_or(""),
            e.detail
                .as_deref()
                .map(|d| format!("\n      {}", tidy(d).replace('\n', "\n      ")))
                .unwrap_or_default()
        ));
    }
    lines.push("\nLog (last 60 lines):".into());
    for l in applog::tail(60) {
        lines.push(format!("  {}", tidy(&l)));
    }
    diagnostics::redact(&lines.join("\n"))
}

/// Writes a text file chosen through the native save dialog (diagnostics export).
#[tauri::command]
pub fn save_text_file(path: String, content: String) -> ApiResult<()> {
    validate::check_cli_path(&path)?;
    if content.len() > 2 * 1024 * 1024 {
        return Err(ApiError::new("invalid_setting"));
    }
    let lower = path.to_ascii_lowercase();
    if !(lower.ends_with(".txt") || lower.ends_with(".log")) {
        return Err(ApiError::new("invalid_path"));
    }
    std::fs::write(&path, content).map_err(|_| ApiError::new("io_error"))
}

#[tauri::command]
pub async fn check_for_update() -> ApiResult<easytizen_core::update::UpdateInfo> {
    tauri::async_runtime::spawn_blocking(|| {
        easytizen_core::update::check(env!("CARGO_PKG_VERSION"))
    })
    .await
    .map_err(|_| ApiError::new("internal"))?
    .map_err(|code| ApiError::new(&format!("update_{code}")))
}

/// Opens a web page in the system browser. Only EasyTizen's own GitHub pages and Samsung's
/// account/developer sites are allowed, so the frontend cannot be abused as a link opener.
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> ApiResult<()> {
    use tauri_plugin_opener::OpenerExt;
    if !is_allowed_external(&url) {
        return Err(ApiError::new("invalid_path"));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| ApiError::new("io_error"))
}

fn is_allowed_external(url: &str) -> bool {
    const ALLOWED: [&str; 4] = [
        "https://github.com/volnalabs/TV-Deploy",
        "https://account.samsung.com/",
        "https://developer.samsung.com/",
        "https://v3.account.samsung.com/",
    ];
    ALLOWED.iter().any(|prefix| url.starts_with(prefix))
        && !url.chars().any(|c| c.is_control() || c == ' ')
}

/// Opens the folder with EasyTizen's log file (desktop).
#[tauri::command]
pub fn open_log_folder(app: AppHandle) -> ApiResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let dir = applog::dir().ok_or_else(|| ApiError::new("io_error"))?;
    if cfg!(mobile) {
        return Err(ApiError::new("engine_unavailable"));
    }
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|_| ApiError::new("io_error"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use easytizen_core::discovery::netif::InterfaceKind;

    #[test]
    fn password_policy() {
        assert!(validate_cert_password("Passw0rdX").is_ok());
        for bad in [
            "short1A",
            "alllowercase1",
            "ALLUPPERCASE1",
            "NoDigitsHere",
            "Has\nNewline1A",
        ] {
            assert!(validate_cert_password(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn profile_names() {
        assert!(validate_profile_name("EasyTizen_1").is_ok());
        for bad in ["ab", "has space", "sl/ash", "../up", "naïve"] {
            assert!(validate_profile_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn host_ip_prefers_the_primary_lan_interface() {
        let i = |name: &str, ip: [u8; 4], kind, primary| LocalInterface {
            name: name.into(),
            ip: ip.into(),
            prefix_len: 24,
            kind,
            primary,
            private: std::net::Ipv4Addr::from(ip).is_private(),
        };
        // A VPN is the default route: the Wi-Fi address is still the one for the TV.
        let list = vec![
            i("tun0", [10, 8, 0, 2], InterfaceKind::Vpn, true),
            i("wlan0", [192, 168, 1, 23], InterfaceKind::Wifi, false),
        ];
        assert_eq!(lan_host_ip(&list).as_deref(), Some("192.168.1.23"));
        let list = vec![
            i("eth0", [192, 168, 0, 5], InterfaceKind::Ethernet, false),
            i("wlan0", [192, 168, 1, 23], InterfaceKind::Wifi, true),
        ];
        assert_eq!(lan_host_ip(&list).as_deref(), Some("192.168.1.23"));
        // Phone on mobile data only: no Host PC IP to offer.
        let list = vec![i(
            "rmnet_data0",
            [10, 64, 1, 2],
            InterfaceKind::Mobile,
            true,
        )];
        assert_eq!(lan_host_ip(&list), None);
    }

    fn wgt(entries: &[(&str, &[u8])]) -> tempfile::NamedTempFile {
        use std::io::Write;
        let f = tempfile::Builder::new().suffix(".wgt").tempfile().unwrap();
        let mut w = zip::ZipWriter::new(f.reopen().unwrap());
        for (name, data) in entries {
            w.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap();
        f
    }

    const CONFIG: &str = r#"<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" version="1.0.0"><tizen:application id="abcde12345.Demo" package="abcde12345"/><name>Demo</name></widget>"#;

    #[test]
    fn package_gate_with_additional_checks_on() {
        let clean = wgt(&[("config.xml", CONFIG.as_bytes()), ("index.html", b"x")]);
        let (_, extra) = package_gate(clean.path(), true, false, false).unwrap();
        assert!(extra.enabled && extra.findings.is_empty());

        let native = wgt(&[
            ("config.xml", CONFIG.as_bytes()),
            ("index.html", b"x"),
            ("bin/run", b"\x7fELF...."),
        ]);
        let e = package_gate(native.path(), true, false, false).unwrap_err();
        assert_eq!(e.code, "pkg_checks_failed");
        assert_eq!(e.detail.as_deref(), Some("native_code"));
        // Confirming a skip does not bypass checks that are switched on.
        assert_eq!(
            package_gate(native.path(), true, false, true)
                .unwrap_err()
                .code,
            "pkg_checks_failed"
        );
    }

    #[test]
    fn package_gate_with_additional_checks_off_needs_confirmation() {
        let native = wgt(&[
            ("config.xml", CONFIG.as_bytes()),
            ("index.html", b"x"),
            ("bin/run", b"\x7fELF...."),
        ]);
        assert_eq!(
            package_gate(native.path(), false, false, false)
                .unwrap_err()
                .code,
            "checks_skip_not_confirmed"
        );
        let (report, extra) = package_gate(native.path(), false, false, true).unwrap();
        assert_eq!(report.app_id.as_deref(), Some("abcde12345.Demo"));
        assert!(!extra.enabled && extra.ran.is_empty());
    }

    #[test]
    fn mandatory_file_safety_holds_in_both_modes() {
        let bomb = r#"<?xml version="1.0"?><!DOCTYPE widget [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;">]><widget>&b;</widget>"#;
        let slip = wgt(&[("config.xml", CONFIG.as_bytes()), ("../../evil", b"x")]);
        let xml = wgt(&[("config.xml", bomb.as_bytes()), ("index.html", b"x")]);
        let no_config = wgt(&[("index.html", b"x")]);
        let not_zip = tempfile::Builder::new().suffix(".wgt").tempfile().unwrap();
        std::fs::write(not_zip.path(), b"definitely not a zip").unwrap();
        let big_xml = wgt(&[
            ("config.xml", &vec![b' '; 2 * 1024 * 1024]),
            ("index.html", b"x"),
        ]);
        let cases = [
            (slip.path(), "pkg_unsafe"),
            (xml.path(), "pkg_bad_config"),
            (no_config.path(), "pkg_missing_config"),
            (not_zip.path(), "pkg_not_zip"),
            (big_xml.path(), "pkg_unsafe"),
        ];
        for (path, code) in cases {
            for extra_enabled in [true, false] {
                for (as_is, confirmed) in [(false, false), (false, true), (true, true)] {
                    let e = package_gate(path, extra_enabled, as_is, confirmed).unwrap_err();
                    assert_eq!(e.code, code, "{path:?} extra={extra_enabled}");
                }
            }
        }
    }

    #[test]
    fn packages_in_folders_with_cyrillic_and_spaces() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("Мои приложения").join("TV apps (2026)");
        std::fs::create_dir_all(&folder).unwrap();
        let src = wgt(&[("config.xml", CONFIG.as_bytes()), ("index.html", b"x")]);
        let path = folder.join("Приложение тест.wgt");
        std::fs::copy(src.path(), &path).unwrap();
        assert!(validate::check_cli_path(path.to_str().unwrap()).is_ok());
        let (report, _) = package_gate(&path, true, false, false).unwrap();
        assert_eq!(report.file_name, "Приложение тест.wgt");
    }

    #[test]
    fn duid_masking_keeps_only_the_tail() {
        assert_eq!(mask_duid("ABCDEFGH12345678"), "…5678");
    }

    #[test]
    fn uri_detection_and_link_allow_list() {
        assert!(is_uri("content://com.android.providers/document/1"));
        assert!(!is_uri("/home/u/app.wgt"));
        assert!(!is_uri("C:\\Users\\u\\app.wgt"));
        assert!(is_allowed_external(
            "https://github.com/volnalabs/TV-Deploy/releases/latest"
        ));
        assert!(is_allowed_external(
            "https://account.samsung.com/mobile/account/check.do?x=1"
        ));
        assert!(!is_allowed_external(
            "https://evil.example/https://github.com/volnalabs/TV-Deploy"
        ));
        assert!(!is_allowed_external("file:///etc/passwd"));
        assert!(!is_allowed_external(
            "https://github.com/volnalabs/TV-Deploy\n"
        ));
    }
}
