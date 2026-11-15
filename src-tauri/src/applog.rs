//! A small file log: `<app data>/logs/easytizen.log` (rotated at 1 MB, one previous file kept).
//!
//! The Windows build has no console window, so this is where errors go. Every line passes
//! through the redactor; passwords, tokens and keys are never written. The diagnostics report
//! includes the end of the log.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const MAX_BYTES: u64 = 1024 * 1024;
const FILE: &str = "easytizen.log";

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Civil date and time (UTC) from Unix seconds, without a date library.
pub fn format_utc(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Howard Hinnant's days-to-civil algorithm.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{m:02}:{s:02}Z")
}

pub fn init(data_dir: &Path) {
    let dir = data_dir.join("logs");
    let _ = std::fs::create_dir_all(&dir);
    let _ = LOG_DIR.set(dir);
    // A panic is written to the log instead of a console nobody sees.
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        write("ERROR", "panic", &info.to_string());
        previous(info);
    }));
}

pub fn dir() -> Option<&'static Path> {
    LOG_DIR.get().map(PathBuf::as_path)
}

fn write_to(dir: &Path, level: &str, event: &str, detail: &str) {
    let _guard = WRITE_LOCK.lock();
    let path = dir.join(FILE);
    if std::fs::metadata(&path)
        .map(|m| m.len() > MAX_BYTES)
        .unwrap_or(false)
    {
        let _ = std::fs::rename(&path, dir.join(format!("{FILE}.1")));
    }
    let detail = easytizen_core::diagnostics::redact(detail)
        .chars()
        .take(4000)
        .collect::<String>()
        .replace('\n', " | ");
    let line = format!(
        "{} {level:<5} {event}: {detail}\n",
        format_utc(crate::now_secs())
    );
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}

pub fn write(level: &str, event: &str, detail: &str) {
    if cfg!(debug_assertions) {
        eprintln!("[{level}] {event}: {detail}");
    }
    if let Some(dir) = dir() {
        write_to(dir, level, event, detail);
    }
}

pub fn info(event: &str, detail: impl AsRef<str>) {
    write("INFO", event, detail.as_ref());
}

pub fn warn(event: &str, detail: impl AsRef<str>) {
    write("WARN", event, detail.as_ref());
}

pub fn error(event: &str, detail: impl AsRef<str>) {
    write("ERROR", event, detail.as_ref());
}

/// The last `lines` lines of the current log.
pub fn tail(lines: usize) -> Vec<String> {
    let Some(dir) = dir() else { return vec![] };
    let text = std::fs::read_to_string(dir.join(FILE)).unwrap_or_default();
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..]
        .iter()
        .map(|l| l.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utc_formatting() {
        assert_eq!(format_utc(0), "1970-01-01 00:00:00Z");
        assert_eq!(format_utc(1_700_000_000), "2023-11-14 22:13:20Z");
        assert_eq!(format_utc(951_782_400), "2000-02-29 00:00:00Z");
    }

    #[test]
    fn lines_are_redacted_single_line_and_rotated() {
        let d = tempfile::tempdir().unwrap();
        write_to(d.path(), "ERROR", "install", "failed\npassword=hunter2");
        let text = std::fs::read_to_string(d.path().join(FILE)).unwrap();
        assert_eq!(text.lines().count(), 1);
        assert!(text.contains("failed | [redacted line]"));
        assert!(!text.contains("hunter2"));
        std::fs::write(d.path().join(FILE), vec![b'x'; MAX_BYTES as usize + 1]).unwrap();
        write_to(d.path(), "INFO", "scan", "ok");
        assert!(d.path().join(format!("{FILE}.1")).is_file());
        assert!(std::fs::read_to_string(d.path().join(FILE))
            .unwrap()
            .contains("scan: ok"));
    }
}
