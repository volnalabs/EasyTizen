//! One-time migration of user data from TV Deploy 0.1 (identifier
//! `io.github.volnalabs.tvdeploy`) to the current identifier `io.github.volnalabs.easytizen`.
//!
//! The app data folder is derived from the bundle identifier, so the rename moved it. Without
//! this step existing users would lose their saved TVs and certificate profiles. Only
//! `settings.json` is copied; the old folder is left untouched (a downgrade keeps working and
//! nothing the user owns is deleted).

use std::path::Path;

pub const LEGACY_IDENTIFIER: &str = "io.github.volnalabs.tvdeploy";

/// Copies the legacy settings next to `new_dir` into it, when `new_dir` has no settings yet.
/// Returns whether data moved.
pub fn migrate_legacy_data(new_dir: &Path) -> bool {
    if new_dir.join("settings.json").exists() {
        return false;
    }
    let Some(legacy) = new_dir.parent().map(|p| p.join(LEGACY_IDENTIFIER)) else {
        return false;
    };
    let from = legacy.join("settings.json");
    if !from.is_file() {
        return false;
    }
    let to = new_dir.join("settings.json");
    let copied = std::fs::create_dir_all(new_dir).and_then(|_| std::fs::copy(&from, &to));
    if copied.is_err() {
        // Never leave a half-written settings file behind.
        let _ = std::fs::remove_file(&to);
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_settings_once_and_keeps_the_old_folder() {
        let root = tempfile::tempdir().unwrap();
        let legacy = root.path().join(LEGACY_IDENTIFIER);
        std::fs::create_dir_all(legacy.join("samsung-home")).unwrap();
        std::fs::write(legacy.join("settings.json"), r#"{"theme":"dark"}"#).unwrap();
        std::fs::write(legacy.join("samsung-home/x"), "1").unwrap();
        let new_dir = root.path().join("io.github.volnalabs.easytizen");

        assert!(migrate_legacy_data(&new_dir));
        assert_eq!(
            std::fs::read_to_string(new_dir.join("settings.json")).unwrap(),
            r#"{"theme":"dark"}"#
        );
        assert!(
            legacy.join("settings.json").is_file(),
            "legacy data is kept"
        );
        assert!(
            legacy.join("samsung-home/x").is_file(),
            "nothing is deleted"
        );

        // A second start must not overwrite what the user changed since.
        std::fs::write(new_dir.join("settings.json"), r#"{"theme":"light"}"#).unwrap();
        assert!(!migrate_legacy_data(&new_dir));
        assert_eq!(
            std::fs::read_to_string(new_dir.join("settings.json")).unwrap(),
            r#"{"theme":"light"}"#
        );
    }

    #[test]
    fn nothing_to_migrate() {
        let root = tempfile::tempdir().unwrap();
        assert!(!migrate_legacy_data(
            &root.path().join("io.github.volnalabs.easytizen")
        ));
    }
}
