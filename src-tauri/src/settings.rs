//! Non-secret settings, stored as JSON in the app data directory. Secrets (certificate
//! passwords, private keys, Samsung tokens) are never written here.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SavedDevice {
    pub ip: String,
    pub port: u16,
    pub name: String,
    pub duid: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    /// Tizen version reported by the TV at the last connection.
    #[serde(default)]
    pub tizen_version: Option<String>,
    /// Unix seconds of the last confirmed connection.
    #[serde(default)]
    pub last_connected: Option<i64>,
}

/// Where a certificate profile's keys live.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Engine {
    /// Created by an older version through the Tizen SDK: the keys are in the SDK's keystore.
    /// EasyTizen no longer uses the SDK; such a profile is moved into the app's own store once,
    /// with its password ("Transfer" on the Certificates page). Nothing is deleted.
    #[default]
    Sdk,
    /// EasyTizen's own store: password-protected `.p12` files in the app data folder.
    Builtin,
}

/// Which kind of certificate a profile holds.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum CertKind {
    /// Issued by Samsung after signing in; the distributor certificate names specific TVs.
    #[default]
    Samsung,
    /// Made from the Tizen SDK's own developer CA and public distributor signer: no Samsung
    /// account and no DUID. Accepted by TVs before Tizen 7 in Developer Mode.
    Tizen,
}

/// Public metadata of a signing profile. Keys and passwords live elsewhere.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SavedCertificateProfile {
    pub name: String,
    pub identity: String,
    /// TVs this profile's distributor certificate is valid for.
    #[serde(default)]
    pub duids: Vec<String>,
    /// Legacy single-DUID field written by TV Deploy 0.1; folded into `duids` on load.
    #[serde(default, skip_serializing)]
    duid: Option<String>,
    #[serde(default)]
    pub engine: Engine,
    /// Unix seconds; `None` when unknown (profiles created by older versions).
    #[serde(default)]
    pub created_at: Option<i64>,
    #[serde(default)]
    pub expires_at: Option<i64>,
    #[serde(default)]
    pub imported: bool,
    #[serde(default)]
    pub kind: CertKind,
}

impl SavedCertificateProfile {
    pub fn new(name: String, identity: String, duids: Vec<String>) -> Self {
        Self {
            name,
            identity,
            duids,
            duid: None,
            engine: Engine::Builtin,
            created_at: Some(crate::now_secs()),
            expires_at: None,
            imported: false,
            kind: CertKind::Samsung,
        }
    }
    /// A Tizen certificate is not bound to TVs; a Samsung one only to the DUIDs it names.
    pub fn covers(&self, duid: &str) -> bool {
        self.kind == CertKind::Tizen || self.duids.iter().any(|d| d.eq_ignore_ascii_case(duid))
    }
    pub fn is_tizen(&self) -> bool {
        self.kind == CertKind::Tizen
    }
    /// Keys still in an old Tizen SDK keystore (must be transferred before use).
    pub fn is_legacy(&self) -> bool {
        self.engine == Engine::Sdk
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// "system" | "light" | "dark"
    pub theme: String,
    /// "auto" | "ru" | "en"
    pub language: String,
    /// Tizen SDK folder recorded by versions before 1.0. Used only to find the keystore of
    /// legacy certificate profiles; nothing is ever downloaded or run from it.
    #[serde(rename = "sdk_path")]
    pub legacy_sdk_path: Option<String>,
    pub default_port: u16,
    pub timeout_ms: u64,
    /// Saved TVs are remembered between launches but are never treated as connected without
    /// a fresh check.
    pub devices: Vec<SavedDevice>,
    pub certificate_profiles: Vec<SavedCertificateProfile>,
    pub onboarding_done: bool,
    /// Automatic updates of EasyTizen itself: look for a newer release periodically and
    /// download and verify it in the background. Off means no background network activity.
    pub check_updates: bool,
    /// Additional package checks before installation (app ID, start page, executables,
    /// duplicate names, existing signature). The mandatory archive-safety checks are not
    /// affected by this switch. Missing in older settings files, so it defaults to on.
    pub extra_package_checks: bool,
    /// Unix seconds of the last update check (successful or not).
    pub last_update_check: Option<i64>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            language: "auto".into(),
            legacy_sdk_path: None,
            default_port: 26101,
            timeout_ms: 3000,
            devices: vec![],
            certificate_profiles: vec![],
            onboarding_done: false,
            check_updates: true,
            extra_package_checks: true,
            last_update_check: None,
        }
    }
}

fn file(dir: &Path) -> PathBuf {
    dir.join("settings.json")
}

pub fn load(dir: &Path) -> Settings {
    let existed = file(dir).is_file();
    let mut settings: Settings = std::fs::read_to_string(file(dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    for profile in &mut settings.certificate_profiles {
        if let Some(duid) = profile.duid.take() {
            if !profile.duids.iter().any(|d| d.eq_ignore_ascii_case(&duid)) {
                profile.duids.push(duid);
            }
        }
    }
    // People upgrading from TV Deploy already went through setup.
    if existed && (settings.legacy_sdk_path.is_some() || !settings.devices.is_empty()) {
        settings.onboarding_done = true;
    }
    settings
}

pub fn save(dir: &Path, s: &Settings) -> std::io::Result<()> {
    let tmp = dir.join("settings.json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(s)?)?;
    std::fs::rename(tmp, file(dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_defaults_on_garbage() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(load(d.path()).default_port, 26101);
        let mut s = Settings {
            theme: "dark".into(),
            ..Settings::default()
        };
        s.devices.push(SavedDevice {
            ip: "192.168.1.5".into(),
            port: 26101,
            name: "TV".into(),
            duid: None,
            model: None,
            tizen_version: None,
            last_connected: None,
        });
        save(d.path(), &s).unwrap();
        let back = load(d.path());
        assert_eq!(back.theme, "dark");
        assert_eq!(back.devices.len(), 1);
        std::fs::write(file(d.path()), "{broken").unwrap();
        assert_eq!(load(d.path()).theme, "system");
    }

    #[test]
    fn tv_deploy_0_1_settings_are_upgraded_without_loss() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(
            file(d.path()),
            r#"{"theme":"dark","language":"ru","sdk_path":"/home/u/tizen-sdk","default_port":26101,"timeout_ms":3000,
               "devices":[{"ip":"192.168.1.5","port":26101,"name":"Гостиная","duid":"ABCD1234EFGH"}],
               "certificate_profiles":[{"name":"TVDeploy-5","identity":"Me","duid":"ABCD1234EFGH"}]}"#,
        )
        .unwrap();
        let s = load(d.path());
        assert_eq!(s.devices[0].name, "Гостиная");
        assert_eq!(s.legacy_sdk_path.as_deref(), Some("/home/u/tizen-sdk"));
        let profile = &s.certificate_profiles[0];
        assert_eq!(profile.duids, ["ABCD1234EFGH"]);
        assert_eq!(profile.engine, Engine::Sdk);
        assert!(
            profile.is_legacy(),
            "an SDK profile is kept and marked for transfer"
        );
        assert!(profile.covers("abcd1234efgh"));
        assert!(
            s.onboarding_done,
            "existing users must not be sent through first-run setup"
        );
        // Saving and loading again keeps the upgraded shape.
        save(d.path(), &s).unwrap();
        assert_eq!(
            load(d.path()).certificate_profiles[0].duids,
            ["ABCD1234EFGH"]
        );
    }

    #[test]
    fn new_settings_default_to_the_safe_choice_and_persist() {
        let d = tempfile::tempdir().unwrap();
        // A 0.9 settings file has neither field: additional checks stay on.
        std::fs::write(file(d.path()), r#"{"theme":"dark","check_updates":false}"#).unwrap();
        let mut s = load(d.path());
        assert!(s.extra_package_checks);
        assert!(!s.check_updates, "an existing choice is kept");
        assert_eq!(s.last_update_check, None);
        s.extra_package_checks = false;
        s.last_update_check = Some(1_700_000_000);
        save(d.path(), &s).unwrap();
        let back = load(d.path());
        assert!(!back.extra_package_checks, "the choice survives a restart");
        assert_eq!(back.last_update_check, Some(1_700_000_000));
    }

    #[test]
    fn settings_of_the_sdk_era_load_without_the_removed_fields() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(
            file(d.path()),
            r#"{"theme":"light","engine":"sdk","sdk_path":"C:\\Users\\Иван\\tizen-studio","pending_sdk_install":"C:\\x",
               "certificate_profiles":[{"name":"Mine","identity":"Me","duids":["A1B2C3D4"],"engine":"builtin"}]}"#,
        )
        .unwrap();
        let s = load(d.path());
        assert_eq!(s.theme, "light");
        assert_eq!(
            s.legacy_sdk_path.as_deref(),
            Some("C:\\Users\\Иван\\tizen-studio")
        );
        assert!(!s.certificate_profiles[0].is_legacy());
        save(d.path(), &s).unwrap();
        let text = std::fs::read_to_string(file(d.path())).unwrap();
        assert!(!text.contains("pending_sdk_install") && !text.contains("\"engine\": \"sdk\","));
        assert!(
            text.contains("tizen-studio"),
            "the old SDK location is kept for certificate transfer"
        );
    }

    #[test]
    fn profiles_without_a_kind_are_samsung_ones() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(
            file(d.path()),
            r#"{"certificate_profiles":[{"name":"Old","identity":"Me","duids":["A1B2C3D4"],"engine":"builtin"},
               {"name":"T","identity":"Me","duids":[],"engine":"builtin","kind":"tizen"}]}"#,
        )
        .unwrap();
        let s = load(d.path());
        let (old, tizen) = (&s.certificate_profiles[0], &s.certificate_profiles[1]);
        assert_eq!(old.kind, CertKind::Samsung);
        assert!(old.covers("a1b2c3d4") && !old.covers("OTHER123"));
        assert!(
            tizen.is_tizen() && tizen.covers("ANY12345"),
            "a Tizen certificate is for any TV"
        );
        save(d.path(), &s).unwrap();
        assert!(load(d.path()).certificate_profiles[1].is_tizen());
    }

    #[test]
    fn no_secret_like_fields() {
        let json = serde_json::to_string(&Settings::default())
            .unwrap()
            .to_lowercase();
        for bad in ["password", "secret", "token", "private"] {
            assert!(!json.contains(bad));
        }
    }
}
