//! Native SDB engine: everything EasyTizen needs from a Samsung TV without the Tizen SDK.
//!
//! The device-side commands are the ones Samsung's own tools send (official `sdb` client,
//! Samsung's open-source Tizen CLI) and the ones the independent `tizen-app-installer-cli`
//! uses successfully on real televisions:
//!
//! | Purpose        | TV (secure protocol, the normal case)          | Other Tizen devices                    |
//! |----------------|------------------------------------------------|----------------------------------------|
//! | DUID           | `0 getduid` (`0 getduidgadget` on product 1.0) | `/opt/etc/duid-gadget 2.0 2> /dev/null` |
//! | Install        | `0 vd_appinstall <app-id> <path>`              | `/usr/bin/pkgcmd -i -t wgt -p "<path>" -q` |
//! | Installed apps | `0 vd_applist`                                 | —                                      |
//! | Launch         | `0 was_execute <app-id>`                       | `app_launcher -s <app-id>`             |
//! | Uninstall      | `0 vd_appuninstall <app-id>`                   | `/usr/bin/pkgcmd -u -n <package-id> -q` |
//! | Remove upload  | `0 rmfile "<path>"`                            | `/bin/rm -f "<path>"`                  |
//!
//! NOTE: automated tests run against the protocol-level TV emulator in [`mock`]; see
//! docs/KNOWN-LIMITATIONS.md for what has and has not been confirmed on hardware.

pub mod client;
#[cfg(any(test, feature = "mock-tv"))]
pub mod mock;
pub mod protocol;

use crate::cancel::CancelToken;
pub use client::{Capability, SdbClient, SdbError};
use serde::Serialize;
use std::io::{Read, Seek, SeekFrom};
use std::net::Ipv4Addr;
use std::time::Duration;

pub const FALLBACK_TOOL_DIR: &str = "/home/owner/share/tmp/sdk_tools";
pub const FALLBACK_TMP_DIR: &str = "/home/owner/share/tmp/sdk_tools/tmp";
const SHELL_TIMEOUT: Duration = Duration::from_secs(20);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const UPLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(60);

/// A word that is safe to splice into a device shell command line.
pub fn is_safe_shell_word(word: &str) -> bool {
    !word.is_empty()
        && word.len() <= 128
        && word
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}

/// What the SDB handshake and `capability:` tell about a device, without running commands.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
pub struct SdbInfo {
    /// Model / device name as reported by the TV.
    pub model: Option<String>,
    /// Tizen version (`platform_version`).
    pub tizen_version: Option<String>,
    pub secure_protocol: bool,
    /// `capability:` was answered.
    pub capability_known: bool,
}

impl SdbInfo {
    fn from_capability(cap: Option<&Capability>) -> Self {
        match cap {
            Some(cap) => SdbInfo {
                model: cap.device_name().map(str::to_string),
                tizen_version: cap.platform_version().map(str::to_string),
                secure_protocol: cap.secure_protocol(),
                capability_known: true,
            },
            None => SdbInfo::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TvIdentity {
    pub duid: Option<String>,
    pub model: Option<String>,
    pub platform_version: Option<String>,
    pub secure_protocol: bool,
}

pub fn duid_command(cap: &Capability) -> &'static str {
    if !cap.uses_tv_commands() {
        "/opt/etc/duid-gadget 2.0 2> /dev/null"
    } else if cap.get("product_version") == Some("1.0") {
        "0 getduidgadget"
    } else {
        "0 getduid"
    }
}

/// Picks the DUID out of a shell answer (`duid: X`, or a bare value on its own line).
pub fn extract_duid(output: &str) -> Option<String> {
    let valid = |v: &str| {
        (4..=128).contains(&v.len())
            && v.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"#.-:=".contains(&b))
    };
    let clean = |v: &str| v.trim().trim_matches(['"', '\'']).to_ascii_uppercase();
    for line in output.lines() {
        let lower = line.trim().to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("duid") {
            let rest = rest.trim_start();
            if let Some(value) = rest.strip_prefix([':', '=']) {
                let value = clean(value);
                if valid(&value) {
                    return Some(value);
                }
            }
        }
    }
    output
        .lines()
        .map(clean)
        .find(|v| valid(v) && !v.contains("NOT") && v.chars().any(|c| c.is_ascii_digit()))
}

/// `capability:` — `None` when the device refuses the service (some firmwares do).
fn read_capability(client: &mut SdbClient) -> Result<Option<Capability>, SdbError> {
    match client.capability(SHELL_TIMEOUT) {
        Ok(cap) => Ok(Some(cap)),
        Err(SdbError::ServiceRefused(_)) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Handshake + `capability:` only. Used by discovery to confirm that an open port really is
/// a TV's SDB service, and by the connection check.
pub fn probe_sdb(
    ip: Ipv4Addr,
    port: u16,
    timeout: Duration,
    cancel: &CancelToken,
) -> Result<SdbInfo, SdbError> {
    let mut client = SdbClient::connect(ip, port, timeout, cancel)?;
    let cap = read_capability(&mut client)?;
    Ok(SdbInfo::from_capability(cap.as_ref()))
}

/// Connects, confirms the device speaks SDB and reads its identity (DUID, model).
pub fn query_tv(
    ip: Ipv4Addr,
    port: u16,
    timeout: Duration,
    cancel: &CancelToken,
) -> Result<TvIdentity, SdbError> {
    let mut client = SdbClient::connect(ip, port, timeout, cancel)?;
    let cap = read_capability(&mut client)?.unwrap_or_default();
    let duid = match client.shell(duid_command(&cap), SHELL_TIMEOUT) {
        Ok(out) => extract_duid(&out),
        Err(SdbError::Cancelled) => return Err(SdbError::Cancelled),
        Err(_) => None,
    };
    Ok(TvIdentity {
        duid,
        model: cap.device_name().map(str::to_string),
        platform_version: cap.platform_version().map(str::to_string),
        secure_protocol: cap.secure_protocol(),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallFailure {
    /// The TV does not trust the signature (wrong DUID, expired or foreign certificate).
    CertificateRejected,
    /// The app is already installed and was signed by a different author certificate.
    AuthorMismatch,
    NoSpace,
    /// The TV answered, but not with a recognisable success marker.
    Unrecognised,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstallVerdict {
    Installed,
    Failed(InstallFailure),
}

/// Interprets the TV's installer log. Deliberately conservative: anything that is not a
/// recognised success marker is reported as a failure, never as a success.
pub fn classify_install_output(output: &str) -> InstallVerdict {
    let low = output.to_ascii_lowercase();
    let nonzero_ret = low
        .split("cmd_ret:")
        .skip(1)
        .any(|rest| !rest.trim_start().starts_with('0'));
    let failed = low.contains("val[fail]")
        || low.contains("install failed")
        || low.contains("failed[")
        || nonzero_ret
        || low.contains("processing result : fail");
    if failed {
        let kind = if low.contains("author") && (low.contains("match") || low.contains("different"))
        {
            InstallFailure::AuthorMismatch
        } else if low.contains("certificate")
            || low.contains("signature")
            // Tizen 4 prints only the code: 118 = install error, 012 = certificate check.
            || low.contains("failed[118012]")
            || low.contains("failed[118, -12]")
        {
            InstallFailure::CertificateRejected
        } else if low.contains("space") || low.contains("storage") {
            InstallFailure::NoSpace
        } else {
            InstallFailure::Other
        };
        return InstallVerdict::Failed(kind);
    }
    if low.contains("install completed") || low.contains("cmd_ret:0") || low.contains("val[ok]") {
        InstallVerdict::Installed
    } else {
        InstallVerdict::Failed(InstallFailure::Unrecognised)
    }
}

/// The installer's own progress, e.g. `app_id[abc.App] installing[42]` → 42.
/// Timings such as `spend time for wascmd is [3210]ms` are not percentages and are ignored.
pub fn parse_install_percent(line: &str) -> Option<u8> {
    let low = line.to_ascii_lowercase();
    if !low.contains("install") || low.contains("spend time") {
        return None;
    }
    let mut rest = line;
    let mut found = None;
    while let Some(open) = rest.find('[') {
        let after = &rest[open + 1..];
        let Some(close) = after.find(']') else { break };
        let inner = &after[..close];
        if (1..=3).contains(&inner.len()) && inner.bytes().all(|b| b.is_ascii_digit()) {
            if let Ok(value) = inner.parse::<u8>() {
                if value <= 100 {
                    found = Some(value);
                }
            }
        }
        rest = &after[close + 1..];
    }
    found
}

/// Whether the TV's app list names this app. `None` when the list cannot be interpreted.
pub fn app_list_contains(list: &str, app_id: &str, package_id: Option<&str>) -> Option<bool> {
    let low = list.to_ascii_lowercase();
    if list.trim().is_empty() || low.trim() == "closed" || low.contains("not found") {
        return None;
    }
    let hit = |id: &str| {
        list.split(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-'))
            .any(|word| word == id)
    };
    Some(hit(app_id) || package_id.map(hit).unwrap_or(false))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallStage {
    Connecting,
    Uploading,
    Installing,
    Verifying,
    Launching,
}

#[derive(Debug)]
pub struct InstallOutcome {
    pub verdict: InstallVerdict,
    /// Raw installer log from the TV (shown under "technical details").
    pub log: String,
    /// After a confirmed installation: does the TV's app list show the app?
    /// `None` when the list could not be read or interpreted.
    pub in_app_list: Option<bool>,
    /// `Some(true/false)` when a launch was requested.
    pub launched: Option<bool>,
}

fn launch_on(client: &mut SdbClient, tv: bool, app_id: &str) -> Result<bool, SdbError> {
    let command = if tv {
        format!("0 was_execute {app_id}")
    } else {
        format!("app_launcher -s {app_id}")
    };
    let out = client
        .shell(&command, Duration::from_secs(30))?
        .to_ascii_lowercase();
    Ok(
        (out.contains("launched") || out.contains("resumed") || out.contains("success"))
            && !out.contains("fail"),
    )
}

fn remove_command(tv: bool, remote: &str) -> String {
    if tv {
        format!("0 rmfile \"{remote}\"")
    } else {
        format!("/bin/rm -f \"{remote}\"")
    }
}

/// Removes an uploaded package over a fresh connection: used when the main connection broke
/// or the user cancelled, so no copy is left on the TV.
fn cleanup_remote(ip: Ipv4Addr, port: u16, tv: bool, remote: &str) {
    if let Ok(mut client) =
        SdbClient::connect(ip, port, Duration::from_secs(5), &CancelToken::new())
    {
        let _ = client.shell(&remove_command(tv, remote), Duration::from_secs(10));
    }
}

/// A package source that can be read again from the start (needed to retry an upload).
pub trait PackageSource: Read + Seek {}
impl<T: Read + Seek> PackageSource for T {}

/// Uploads a signed `.wgt` and asks the TV to install it, then checks the result.
///
/// `progress(stage, fraction)` reports real progress: the upload fraction while uploading and
/// the TV's own installer percentage while installing.
#[allow(clippy::too_many_arguments)]
pub fn install_wgt(
    ip: Ipv4Addr,
    port: u16,
    package: &mut dyn PackageSource,
    package_size: u64,
    app_id: &str,
    package_id: Option<&str>,
    run_after_install: bool,
    timeout: Duration,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(InstallStage, f32),
) -> Result<InstallOutcome, SdbError> {
    if !is_safe_shell_word(app_id) {
        return Err(SdbError::Protocol("unsafe application id".into()));
    }
    progress(InstallStage::Connecting, 0.0);
    let mut client = SdbClient::connect(ip, port, timeout, cancel)?;
    let cap = read_capability(&mut client)?.unwrap_or_default();
    let tv = cap.uses_tv_commands();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let file_name = format!("easytizen-{stamp}.wgt");
    // Where Samsung's tools upload packages first; the tool folder itself (where the
    // reference installer uploads) if the TV refuses that.
    let mut targets = vec![format!(
        "{}/{file_name}",
        cap.package_tmp_dir()
            .unwrap_or_else(|| FALLBACK_TMP_DIR.to_string())
    )];
    targets.push(format!(
        "{}/{file_name}",
        cap.sdk_tool_dir()
            .unwrap_or_else(|| FALLBACK_TOOL_DIR.to_string())
    ));

    progress(InstallStage::Uploading, 0.0);
    let mut remote = None;
    let mut last_error = None;
    for target in &targets {
        package
            .seek(SeekFrom::Start(0))
            .map_err(|_| SdbError::SyncFailed("cannot read the package".into()))?;
        let result = client.push(
            package,
            package_size,
            target,
            UPLOAD_IDLE_TIMEOUT,
            &mut |sent| {
                let fraction = if package_size == 0 {
                    1.0
                } else {
                    sent as f32 / package_size as f32
                };
                progress(InstallStage::Uploading, fraction.min(1.0));
            },
        );
        match result {
            Ok(()) => {
                remote = Some(target.clone());
                break;
            }
            // The TV refused this destination; the connection is still usable.
            Err(SdbError::SyncFailed(reason)) => last_error = Some(SdbError::SyncFailed(reason)),
            Err(e) => {
                // Broken connection or cancel: a partial file may exist on the TV.
                cleanup_remote(ip, port, tv, target);
                return Err(e);
            }
        }
    }
    let Some(remote) = remote else {
        return Err(last_error.unwrap_or_else(|| SdbError::SyncFailed("upload refused".into())));
    };

    progress(InstallStage::Installing, 0.0);
    let install = if tv {
        format!("0 vd_appinstall {app_id} {remote}")
    } else {
        format!("/usr/bin/pkgcmd -i -t wgt -p \"{remote}\" -q")
    };
    let log = client.shell_streaming(&install, INSTALL_TIMEOUT, &mut |line| {
        if let Some(percent) = parse_install_percent(line) {
            progress(InstallStage::Installing, percent as f32 / 100.0);
        }
    });
    let log = match log {
        Ok(log) => {
            // Remove the uploaded copy whatever the installer said.
            let _ = client.shell(&remove_command(tv, &remote), SHELL_TIMEOUT);
            log
        }
        Err(e) => {
            cleanup_remote(ip, port, tv, &remote);
            return Err(e);
        }
    };
    let mut verdict = classify_install_output(&log);

    // Older TVs (Tizen 4) answer "install failed[118012]" — a certificate-check failure —
    // also when the app is already installed with another signature. Removing the old copy
    // is then what helps, so report that when the TV's app list shows the app.
    if tv && verdict == InstallVerdict::Failed(InstallFailure::CertificateRejected) {
        if let Ok(list) = client.shell("0 vd_applist", Duration::from_secs(30)) {
            if app_list_contains(&list, app_id, package_id) == Some(true) {
                verdict = InstallVerdict::Failed(InstallFailure::AuthorMismatch);
            }
        }
    }

    let mut in_app_list = None;
    let mut launched = None;
    if verdict == InstallVerdict::Installed {
        if tv {
            progress(InstallStage::Verifying, 0.0);
            in_app_list = match client.shell("0 vd_applist", Duration::from_secs(30)) {
                Ok(list) => app_list_contains(&list, app_id, package_id),
                Err(SdbError::Cancelled) => None,
                Err(_) => None,
            };
        }
        if run_after_install {
            progress(InstallStage::Launching, 0.0);
            launched = Some(launch_on(&mut client, tv, app_id).unwrap_or(false));
        }
    }
    Ok(InstallOutcome {
        verdict,
        log,
        in_app_list,
        launched,
    })
}

/// Removes an installed app (needed when the TV holds a copy signed by another author).
pub fn uninstall_app(
    ip: Ipv4Addr,
    port: u16,
    app_id: &str,
    timeout: Duration,
    cancel: &CancelToken,
) -> Result<String, SdbError> {
    if !is_safe_shell_word(app_id) {
        return Err(SdbError::Protocol("unsafe application id".into()));
    }
    let mut client = SdbClient::connect(ip, port, timeout, cancel)?;
    let tv = read_capability(&mut client)?
        .map(|c| c.uses_tv_commands())
        .unwrap_or(true);
    let command = if tv {
        format!("0 vd_appuninstall {app_id}")
    } else {
        let package = app_id.split('.').next().unwrap_or(app_id);
        format!("/usr/bin/pkgcmd -u -n {package} -q")
    };
    client.shell(&command, Duration::from_secs(120))
}

/// Interprets the uninstaller's answer conservatively.
pub fn uninstall_succeeded(output: &str) -> bool {
    let low = output.to_ascii_lowercase();
    !low.contains("fail")
        && (low.contains("uninstall completed")
            || low.contains("cmd_ret:0")
            || low.contains("val[ok]"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duid_extraction() {
        assert_eq!(
            extract_duid("ABCDEF1234567890\n").as_deref(),
            Some("ABCDEF1234567890")
        );
        assert_eq!(
            extract_duid("duid: abcd1234efgh\n").as_deref(),
            Some("ABCD1234EFGH")
        );
        assert_eq!(
            extract_duid("\n  \"2.0#QWER1234\"  \n").as_deref(),
            Some("2.0#QWER1234")
        );
        assert_eq!(extract_duid(""), None);
        assert_eq!(extract_duid("command not found\n"), None);
        assert_eq!(extract_duid("$(reboot) 1234\n"), None);
    }

    #[test]
    fn duid_command_selection_matches_samsung_cli() {
        let cap = |s: &str| Capability::parse(s.as_bytes());
        assert_eq!(
            duid_command(&cap("secure_protocol:disabled\n")),
            "/opt/etc/duid-gadget 2.0 2> /dev/null"
        );
        assert_eq!(
            duid_command(&cap("secure_protocol:enabled\nproduct_version:1.0\n")),
            "0 getduidgadget"
        );
        assert_eq!(
            duid_command(&cap("secure_protocol:enabled\nproduct_version:5.0\n")),
            "0 getduid"
        );
        // A TV that does not answer `capability:` still gets the TV commands.
        assert_eq!(duid_command(&Capability::default()), "0 getduid");
    }

    #[test]
    fn install_log_classification_is_conservative() {
        let ok = "install abc.App\npackage_path /x.wgt\napp_id[abc.App] install start\napp_id[abc.App] installing[50]\napp_id[abc.App] install completed\nspend time for wascmd is [3210]ms\ncmd_ret:0\n";
        assert_eq!(classify_install_output(ok), InstallVerdict::Installed);
        let cert = "app_id[abc.App] install failed[118, -12], reason: Check certificate error : :Invalid certificate chain with certificate in signature\ncmd_ret:1\n";
        assert_eq!(
            classify_install_output(cert),
            InstallVerdict::Failed(InstallFailure::CertificateRejected)
        );
        let author = "install failed[118, -11], reason: Author certificate not match : :\n";
        assert_eq!(
            classify_install_output(author),
            InstallVerdict::Failed(InstallFailure::AuthorMismatch)
        );
        assert_eq!(
            classify_install_output("key[end] val[ok]\n"),
            InstallVerdict::Installed
        );
        assert_eq!(
            classify_install_output("key[end] val[fail]\n"),
            InstallVerdict::Failed(InstallFailure::Other)
        );
        assert_eq!(
            classify_install_output(""),
            InstallVerdict::Failed(InstallFailure::Unrecognised)
        );
        assert_eq!(
            classify_install_output("closed"),
            InstallVerdict::Failed(InstallFailure::Unrecognised)
        );
    }

    #[test]
    fn tizen4_certificate_code_is_a_certificate_rejection() {
        // Real answer of a Samsung UE24N4500 (Tizen 4.0) to a re-signed package.
        let log = "install YZhsvNRs8F.kinopubTv\npackage_path /home/owner/share/tmp/sdk_tools/tmp/easytizen-1794713860006.wgt\nwas_install_app return WAS_TRUE\napp_id[YZhsvNRs8F.kinopubTv] install start\napp_id[YZhsvNRs8F.kinopubTv] installing[7]\napp_id[YZhsvNRs8F.kinopubTv] installing[16]\napp_id[YZhsvNRs8F.kinopubTv] install failed[118012]\nspend time for wascmd is [1310]ms\ncmd_ret:0\n";
        assert_eq!(
            classify_install_output(log),
            InstallVerdict::Failed(InstallFailure::CertificateRejected)
        );
        // cmd_ret:0 alone never turns a failure into a success.
        assert_ne!(classify_install_output(log), InstallVerdict::Installed);
    }

    #[test]
    fn installer_percentages() {
        assert_eq!(
            parse_install_percent("app_id[AbCdE12345.App] installing[42]"),
            Some(42)
        );
        assert_eq!(
            parse_install_percent("app_id[x.y] installing[100]"),
            Some(100)
        );
        assert_eq!(
            parse_install_percent("spend time for wascmd is [3210]ms"),
            None
        );
        assert_eq!(
            parse_install_percent("app_id[x] install failed[118, -12]"),
            None
        );
        assert_eq!(parse_install_percent("installing[250]"), None);
        assert_eq!(parse_install_percent("cmd_ret:0"), None);
    }

    #[test]
    fn app_list_lookup() {
        let list = "Application List for user 5001\nUser's Application \n Name    AppID\n=================================================\n'Jellyfin'   'AprZAARz4r.Jellyfin'\n'YouTube'   '9Ur5IzDKqV.TizenYouTube'\n";
        assert_eq!(
            app_list_contains(list, "AprZAARz4r.Jellyfin", None),
            Some(true)
        );
        assert_eq!(
            app_list_contains(list, "AprZAARz4r.Other", None),
            Some(false)
        );
        assert_eq!(
            app_list_contains(list, "zzzz.Other", Some("9Ur5IzDKqV.TizenYouTube")),
            Some(true)
        );
        // A prefix of another id is not a match.
        assert_eq!(
            app_list_contains(list, "AprZAARz4r.Jelly", None),
            Some(false)
        );
        assert_eq!(app_list_contains("", "a.b", None), None);
        assert_eq!(app_list_contains("closed\n", "a.b", None), None);
    }

    #[test]
    fn uninstall_answers() {
        assert!(uninstall_succeeded(
            "app_id[a.b] uninstall completed\ncmd_ret:0\n"
        ));
        assert!(!uninstall_succeeded("app_id[a.b] uninstall failed\n"));
        assert!(!uninstall_succeeded(""));
    }

    #[test]
    fn shell_words() {
        assert!(is_safe_shell_word("AbCdE12345.My-App_1"));
        for bad in ["", "a b", "a;b", "$(x)", "a/b", "a\"b", "`x`"] {
            assert!(!is_safe_shell_word(bad), "{bad}");
        }
    }
}
