//! Additional package checks — the optional layer the user may turn off in Settings.
//!
//! Two layers protect a `.wgt` before it reaches a TV:
//!
//! 1. **Mandatory file safety** — [`crate::package::analyze_wgt`]: ZIP structure, path traversal
//!    (Zip Slip), entry-count / size / compression-ratio limits (archive bombs), a readable
//!    `config.xml` parsed without DTDs or entities. It runs on every open, every signing and every
//!    installation and cannot be switched off. [`run`] calls it first as well.
//! 2. **Additional checks** — this module: is the package what it claims to be and will it work?
//!    These are trust and consistency checks, not an antivirus scan:
//!    * `app_id` — the Tizen application ID exists, has the Tizen format and matches the
//!      package ID;
//!    * `entry_point` — the start page named in `config.xml` is inside the package (advisory);
//!    * `native_code` — no executables for other systems (ELF, Windows PE, Mach-O, Java classes);
//!    * `duplicates` — no file name appears twice (readers could pick different copies);
//!    * `signature` — only when installing *as is* (without re-signing): every file is covered
//!      by the package's existing signatures and its SHA-256/512 digest matches. The RSA
//!      signature and certificate chain are judged by the TV, not here.
//!
//! A finding is either *blocking* (installation is refused while the checks are on) or advisory.

use crate::package::{analyze_wgt, read_capped, PackageError, MAX_XML_BYTES};
use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256, Sha512};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;

pub const CHECK_APP_ID: &str = "app_id";
pub const CHECK_ENTRY_POINT: &str = "entry_point";
pub const CHECK_NATIVE_CODE: &str = "native_code";
pub const CHECK_DUPLICATES: &str = "duplicates";
pub const CHECK_SIGNATURE: &str = "signature";

const AUTHOR_SIGNATURE: &str = "author-signature.xml";
/// How many names a finding lists before it summarises.
const MAX_NAMES: usize = 3;
/// Bytes read from the start of each entry to recognise executables.
const SNIFF_BYTES: u64 = 4096;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CheckFinding {
    /// Which check produced it (`app_id`, `entry_point`, …).
    pub check: &'static str,
    /// Stable machine key, translated in the UI.
    pub code: &'static str,
    pub detail: Option<String>,
    /// Blocking findings stop the installation while the additional checks are on.
    pub blocking: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ExtraChecks {
    /// `false` when the user turned the additional checks off: nothing optional ran.
    pub enabled: bool,
    /// Checks that actually ran, in display order.
    pub ran: Vec<&'static str>,
    pub findings: Vec<CheckFinding>,
}

impl ExtraChecks {
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            ran: vec![],
            findings: vec![],
        }
    }
    pub fn blocking(&self) -> impl Iterator<Item = &CheckFinding> {
        self.findings.iter().filter(|f| f.blocking)
    }
    pub fn passed(&self) -> bool {
        self.blocking().next().is_none()
    }
    /// Comma-separated blocking codes, for error details and the installation history.
    pub fn blocking_summary(&self) -> String {
        self.blocking()
            .map(|f| f.code)
            .collect::<Vec<_>>()
            .join(", ")
    }
}

fn finding(
    check: &'static str,
    code: &'static str,
    detail: Option<String>,
    blocking: bool,
) -> CheckFinding {
    CheckFinding {
        check,
        code,
        detail,
        blocking,
    }
}

fn list(names: &[String]) -> String {
    let mut text = names
        .iter()
        .take(MAX_NAMES)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    if names.len() > MAX_NAMES {
        text.push_str(&format!(" (+{})", names.len() - MAX_NAMES));
    }
    text
}

/// Tizen package ID: exactly ten ASCII letters or digits.
pub fn valid_package_id(id: &str) -> bool {
    id.len() == 10 && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// Tizen application ID: `<package id>.<name>`, the name being 1–52 ASCII letters or digits.
pub fn valid_app_id(id: &str) -> bool {
    match id.split_once('.') {
        Some((package, name)) => {
            valid_package_id(package)
                && (1..=52).contains(&name.len())
                && name.bytes().all(|b| b.is_ascii_alphanumeric())
        }
        None => false,
    }
}

/// Recognises executables by their first bytes, not by file name.
pub fn executable_kind(head: &[u8]) -> Option<&'static str> {
    match head {
        [0x7f, b'E', b'L', b'F', ..] => Some("ELF"),
        [0xfe, 0xed, 0xfa, 0xce | 0xcf, ..] | [0xce | 0xcf, 0xfa, 0xed, 0xfe, ..] => Some("Mach-O"),
        [0xca, 0xfe, 0xba, 0xbe, ..] => Some("Mach-O/Java"),
        [b'M', b'Z', ..] if head.len() >= 0x40 => {
            let offset =
                u32::from_le_bytes([head[0x3c], head[0x3d], head[0x3e], head[0x3f]]) as usize;
            (head.len() >= offset + 4 && &head[offset..offset + 4] == b"PE\0\0").then_some("PE")
        }
        _ => None,
    }
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn is_signature_file(name: &str) -> bool {
    name == AUTHOR_SIGNATURE
        || (!name.contains('/')
            && name.starts_with("signature")
            && name.ends_with(".xml")
            && name.len() > "signature.xml".len()
            && name["signature".len()..name.len() - 4]
                .bytes()
                .all(|b| b.is_ascii_digit()))
}

struct Reference {
    path: String,
    algorithm: String,
    digest: Vec<u8>,
}

fn parse_references(xml: &str) -> Option<Vec<Reference>> {
    let doc = roxmltree::Document::parse(xml).ok()?;
    let mut out = Vec::new();
    for node in doc.descendants().filter(|n| n.has_tag_name("Reference")) {
        let uri = node.attribute("URI")?;
        if uri.starts_with('#') {
            continue;
        }
        let algorithm = node
            .descendants()
            .find(|n| n.has_tag_name("DigestMethod"))
            .and_then(|n| n.attribute("Algorithm"))?
            .to_string();
        let value: String = node
            .descendants()
            .find(|n| n.has_tag_name("DigestValue"))
            .and_then(|n| n.text())?
            .split_whitespace()
            .collect();
        let digest = base64::engine::general_purpose::STANDARD
            .decode(value)
            .ok()?;
        out.push(Reference {
            path: percent_decode(uri)?,
            algorithm,
            digest,
        });
    }
    Some(out)
}

fn digest(algorithm: &str, data: &[u8]) -> Option<Vec<u8>> {
    if algorithm.ends_with("#sha256") {
        Some(Sha256::digest(data).to_vec())
    } else if algorithm.ends_with("#sha512") {
        Some(Sha512::digest(data).to_vec())
    } else {
        None
    }
}

/// The `src` of `<content>` in config.xml, or `index.html` when it is not declared.
fn entry_point(config: &str) -> Option<String> {
    let doc = roxmltree::Document::parse(config).ok()?;
    let src = doc
        .root_element()
        .children()
        .find(|n| n.is_element() && n.tag_name().name() == "content")
        .and_then(|n| n.attribute("src"))
        .unwrap_or("index.html");
    Some(src.trim().to_string())
}

fn u16_at(b: &[u8], at: usize) -> Option<usize> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?) as usize)
}
fn u32_at(b: &[u8], at: usize) -> Option<u64> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?) as u64)
}
fn u64_at(b: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_le_bytes(b.get(at..at + 8)?.try_into().ok()?))
}

/// Every name in the ZIP central directory, duplicates included (ZIP64 aware). `None` when the
/// directory cannot be located; the mandatory gate has already accepted the archive by then.
fn central_directory_names(path: &Path) -> Option<Vec<String>> {
    use std::io::{Seek, SeekFrom};
    let mut file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let tail_len = len.min(22 + 65_535 + 20);
    file.seek(SeekFrom::Start(len - tail_len)).ok()?;
    let mut tail = vec![0u8; tail_len as usize];
    file.read_exact(&mut tail).ok()?;
    let eocd = (0..=tail.len().checked_sub(22)?)
        .rev()
        .find(|&i| tail[i..i + 4] == [0x50, 0x4b, 0x05, 0x06])?;
    let mut size = u32_at(&tail, eocd + 12)?;
    let mut offset = u32_at(&tail, eocd + 16)?;
    if (size == 0xffff_ffff || offset == 0xffff_ffff)
        && eocd >= 20
        && tail[eocd - 20..eocd - 16] == [0x50, 0x4b, 0x06, 0x07]
    {
        let record = u64_at(&tail, eocd - 20 + 8)?;
        let mut zip64 = [0u8; 56];
        file.seek(SeekFrom::Start(record)).ok()?;
        file.read_exact(&mut zip64).ok()?;
        if zip64[..4] != [0x50, 0x4b, 0x06, 0x06] {
            return None;
        }
        size = u64_at(&zip64, 40)?;
        offset = u64_at(&zip64, 48)?;
    }
    // The mandatory gate caps entries at 20 000; their names fit comfortably in 16 MiB.
    if size > 16 * 1024 * 1024 || offset.checked_add(size)? > len {
        return None;
    }
    let mut directory = vec![0u8; size as usize];
    file.seek(SeekFrom::Start(offset)).ok()?;
    file.read_exact(&mut directory).ok()?;
    let mut names = Vec::new();
    let mut at = 0;
    while directory.get(at..at + 4) == Some(&[0x50, 0x4b, 0x01, 0x02]) {
        let (name_len, extra_len, comment_len) = (
            u16_at(&directory, at + 28)?,
            u16_at(&directory, at + 30)?,
            u16_at(&directory, at + 32)?,
        );
        names.push(
            String::from_utf8_lossy(directory.get(at + 46..at + 46 + name_len)?).into_owned(),
        );
        at += 46 + name_len + extra_len + comment_len;
    }
    Some(names)
}

/// Runs the mandatory safety gate and then every additional check.
///
/// `as_is`: the package will be installed without re-signing, so its existing signature matters.
/// Errors are the mandatory gate's errors — an unsafe archive never reaches the additional checks.
pub fn run(path: &Path, as_is: bool) -> Result<ExtraChecks, PackageError> {
    let report = analyze_wgt(path)?;
    let mut zip = zip::ZipArchive::new(File::open(path).map_err(|_| PackageError::Unreadable)?)
        .map_err(|_| PackageError::NotAZip)?;
    let mut findings = Vec::new();
    let mut ran = vec![
        CHECK_APP_ID,
        CHECK_ENTRY_POINT,
        CHECK_NATIVE_CODE,
        CHECK_DUPLICATES,
    ];

    // App ID.
    match (&report.app_id, &report.package_id) {
        (None, _) => findings.push(finding(CHECK_APP_ID, "app_id_missing", None, true)),
        (Some(id), package) => {
            if !valid_app_id(id) {
                findings.push(finding(
                    CHECK_APP_ID,
                    "app_id_format",
                    Some(id.clone()),
                    true,
                ));
            } else if let Some(package) = package {
                if !id.starts_with(&format!("{package}.")) {
                    findings.push(finding(
                        CHECK_APP_ID,
                        "app_id_package_mismatch",
                        Some(format!("{id} / {package}")),
                        true,
                    ));
                }
            }
        }
    }

    // Names: duplicates and the entry point. The ZIP reader keeps one entry per name, so
    // duplicates are found in the raw central directory.
    let mut names = Vec::with_capacity(zip.len());
    let mut seen = HashSet::new();
    for i in 0..zip.len() {
        let entry = zip.by_index_raw(i).map_err(|_| PackageError::NotAZip)?;
        let name = entry.name().to_string();
        seen.insert(name.clone());
        names.push((name, entry.is_dir()));
    }
    let mut duplicates = Vec::new();
    let mut counted = HashSet::new();
    for name in central_directory_names(path).unwrap_or_default() {
        if !counted.insert(name.clone()) && !duplicates.contains(&name) {
            duplicates.push(name);
        }
    }
    if !duplicates.is_empty() {
        findings.push(finding(
            CHECK_DUPLICATES,
            "duplicate_entries",
            Some(list(&duplicates)),
            true,
        ));
    }

    let config = {
        let f = zip
            .by_name("config.xml")
            .map_err(|_| PackageError::MissingConfig)?;
        String::from_utf8(read_capped(f, MAX_XML_BYTES)?)
            .map_err(|_| PackageError::BadConfig("not UTF-8".into()))?
    };
    if let Some(src) = entry_point(&config) {
        let lower = src.to_ascii_lowercase();
        if !(lower.starts_with("http://") || lower.starts_with("https://")) {
            let path = src
                .split(['?', '#'])
                .next()
                .unwrap_or_default()
                .trim_start_matches("./");
            let path = percent_decode(path).unwrap_or_else(|| path.to_string());
            if !seen.contains(&path) {
                findings.push(finding(
                    CHECK_ENTRY_POINT,
                    "entry_point_missing",
                    Some(path),
                    false,
                ));
            }
        }
    }

    // Executables.
    let mut executables = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|_| PackageError::NotAZip)?;
        if entry.is_dir() {
            continue;
        }
        let mut head = Vec::new();
        (&mut entry)
            .take(SNIFF_BYTES)
            .read_to_end(&mut head)
            .map_err(|_| PackageError::NotAZip)?;
        if let Some(kind) = executable_kind(&head) {
            executables.push(format!("{} ({kind})", entry.name()));
        }
    }
    if !executables.is_empty() {
        findings.push(finding(
            CHECK_NATIVE_CODE,
            "native_code",
            Some(list(&executables)),
            true,
        ));
    }

    // Existing signature, only relevant when nothing re-signs the package.
    if as_is {
        ran.push(CHECK_SIGNATURE);
        findings.extend(check_signature(&mut zip, &names)?);
    }

    Ok(ExtraChecks {
        enabled: true,
        ran,
        findings,
    })
}

fn check_signature(
    zip: &mut zip::ZipArchive<File>,
    names: &[(String, bool)],
) -> Result<Vec<CheckFinding>, PackageError> {
    let mut out = Vec::new();
    let mut signature_files: Vec<String> = names
        .iter()
        .filter(|(n, _)| is_signature_file(n))
        .map(|(n, _)| n.clone())
        .collect();
    signature_files.sort();
    let distributor = signature_files
        .iter()
        .find(|n| n.as_str() != AUTHOR_SIGNATURE)
        .cloned();
    let (Some(distributor), true) = (
        distributor,
        signature_files.iter().any(|n| n == AUTHOR_SIGNATURE),
    ) else {
        out.push(finding(CHECK_SIGNATURE, "signature_missing", None, true));
        return Ok(out);
    };

    let mut cache: HashMap<String, Vec<u8>> = HashMap::new();
    let mut mismatched = Vec::new();
    let mut uncovered = Vec::new();
    let mut unsupported = false;
    for (document, covers_author) in [
        (AUTHOR_SIGNATURE.to_string(), false),
        (distributor.clone(), true),
    ] {
        let xml = {
            let f = zip.by_name(&document).map_err(|_| PackageError::NotAZip)?;
            String::from_utf8(read_capped(f, MAX_XML_BYTES)?).unwrap_or_default()
        };
        let Some(references) = parse_references(&xml) else {
            out.push(finding(
                CHECK_SIGNATURE,
                "signature_unreadable",
                Some(document.clone()),
                true,
            ));
            continue;
        };
        let referenced: HashSet<&str> = references.iter().map(|r| r.path.as_str()).collect();
        for (name, is_dir) in names {
            let needs = !is_dir
                && (!is_signature_file(name) || (covers_author && name == AUTHOR_SIGNATURE));
            if needs && !referenced.contains(name.as_str()) && !uncovered.contains(name) {
                uncovered.push(name.clone());
            }
        }
        for reference in &references {
            if !cache.contains_key(&reference.path) {
                let Ok(mut f) = zip.by_name(&reference.path) else {
                    if !mismatched.contains(&reference.path) {
                        mismatched.push(reference.path.clone());
                    }
                    continue;
                };
                let mut data = Vec::new();
                f.read_to_end(&mut data)
                    .map_err(|_| PackageError::NotAZip)?;
                cache.insert(reference.path.clone(), data);
            }
            match digest(&reference.algorithm, &cache[&reference.path]) {
                Some(actual) if actual == reference.digest => {}
                Some(_) => {
                    if !mismatched.contains(&reference.path) {
                        mismatched.push(reference.path.clone());
                    }
                }
                None => unsupported = true,
            }
        }
    }
    if !mismatched.is_empty() {
        out.push(finding(
            CHECK_SIGNATURE,
            "signature_mismatch",
            Some(list(&mismatched)),
            true,
        ));
    }
    if !uncovered.is_empty() {
        out.push(finding(
            CHECK_SIGNATURE,
            "signature_incomplete",
            Some(list(&uncovered)),
            true,
        ));
    }
    if unsupported {
        out.push(finding(
            CHECK_SIGNATURE,
            "signature_unsupported_digest",
            None,
            false,
        ));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    const CONFIG: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" id="http://example.org/Demo" version="1.2.3">
  <tizen:application id="abcde12345.Demo" package="abcde12345" required_version="6.0"/>
  <content src="index.html"/>
  <name>Demo App</name>
</widget>"#;

    fn make(entries: &[(&str, &[u8])]) -> tempfile::NamedTempFile {
        let f = tempfile::Builder::new().suffix(".wgt").tempfile().unwrap();
        let mut w = zip::ZipWriter::new(f.reopen().unwrap());
        for (n, d) in entries {
            w.start_file(*n, SimpleFileOptions::default()).unwrap();
            w.write_all(d).unwrap();
        }
        w.finish().unwrap();
        f
    }

    fn codes(r: &ExtraChecks) -> Vec<&'static str> {
        r.findings.iter().map(|f| f.code).collect()
    }

    fn sha512_b64(data: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(Sha512::digest(data))
    }

    fn signature(references: &[(&str, &[u8])]) -> String {
        let mut xml =
            String::from(r#"<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo>"#);
        for (path, data) in references {
            xml.push_str(&format!(
                r#"<Reference URI="{}"><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha512"/><DigestValue>{}</DigestValue></Reference>"#,
                crate::sign::wgt::encode_uri(path),
                sha512_b64(data)
            ));
        }
        xml.push_str(r##"<Reference URI="#prop"><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha512"/><DigestValue>AA==</DigestValue></Reference></SignedInfo></Signature>"##);
        xml
    }

    #[test]
    fn clean_package_passes_every_check() {
        let f = make(&[
            ("config.xml", CONFIG.as_bytes()),
            ("index.html", b"<html/>"),
            ("js/app.js", b"1"),
        ]);
        let r = run(f.path(), false).unwrap();
        assert!(r.enabled && r.passed(), "{r:?}");
        assert!(r.findings.is_empty());
        assert_eq!(
            r.ran,
            [
                CHECK_APP_ID,
                CHECK_ENTRY_POINT,
                CHECK_NATIVE_CODE,
                CHECK_DUPLICATES
            ]
        );
    }

    #[test]
    fn app_id_problems_block() {
        let none = CONFIG.replace(r#"<tizen:application id="abcde12345.Demo" package="abcde12345" required_version="6.0"/>"#, "");
        let f = make(&[("config.xml", none.as_bytes()), ("index.html", b"x")]);
        assert_eq!(codes(&run(f.path(), false).unwrap()), ["app_id_missing"]);

        let bad = CONFIG
            .replace("abcde12345.Demo", "abc.Demo-1")
            .replace(r#"package="abcde12345""#, r#"package="abc""#);
        let f = make(&[("config.xml", bad.as_bytes()), ("index.html", b"x")]);
        assert_eq!(codes(&run(f.path(), false).unwrap()), ["app_id_format"]);

        let other = CONFIG.replace(r#"package="abcde12345""#, r#"package="zzzzz99999""#);
        let f = make(&[("config.xml", other.as_bytes()), ("index.html", b"x")]);
        let r = run(f.path(), false).unwrap();
        assert_eq!(codes(&r), ["app_id_package_mismatch"]);
        assert!(!r.passed());
    }

    #[test]
    fn missing_start_page_is_advisory() {
        let f = make(&[
            (
                "config.xml",
                CONFIG
                    .replace("index.html", "main%20page.html?x=1")
                    .as_bytes(),
            ),
            ("index.html", b"x"),
        ]);
        let r = run(f.path(), false).unwrap();
        assert_eq!(codes(&r), ["entry_point_missing"]);
        assert_eq!(r.findings[0].detail.as_deref(), Some("main page.html"));
        assert!(r.passed(), "advisory findings do not block");
        // Present (percent-encoded) and hosted start pages are fine.
        let f = make(&[
            (
                "config.xml",
                CONFIG.replace("index.html", "main%20page.html").as_bytes(),
            ),
            ("main page.html", b"x"),
        ]);
        assert!(run(f.path(), false).unwrap().findings.is_empty());
        let f = make(&[(
            "config.xml",
            CONFIG
                .replace("index.html", "https://example.org/")
                .as_bytes(),
        )]);
        assert!(run(f.path(), false).unwrap().findings.is_empty());
    }

    #[test]
    fn executables_are_recognised_by_content() {
        let mut pe = vec![0u8; 0x80];
        pe[0] = b'M';
        pe[1] = b'Z';
        pe[0x3c] = 0x40;
        pe[0x40..0x44].copy_from_slice(b"PE\0\0");
        let f = make(&[
            ("config.xml", CONFIG.as_bytes()),
            ("index.html", b"x"),
            ("lib/helper.png", b"\x7fELF\x02\x01\x01rest"),
            ("tool.dat", &pe),
            ("readme.txt", b"MZ is just text here"),
        ]);
        let r = run(f.path(), false).unwrap();
        assert_eq!(codes(&r), ["native_code"]);
        let detail = r.findings[0].detail.clone().unwrap();
        assert!(
            detail.contains("lib/helper.png (ELF)")
                && detail.contains("tool.dat (PE)")
                && !detail.contains("readme"),
            "{detail}"
        );
        assert!(!r.passed());
    }

    #[test]
    fn duplicate_names_block() {
        let f = make(&[
            ("config.xml", CONFIG.as_bytes()),
            ("index.html", b"x"),
            ("dup_a.js", b"one"),
            ("dup_b.js", b"two"),
        ]);
        // The writer refuses duplicates, so rename the second entry in place (same length).
        let mut bytes = std::fs::read(f.path()).unwrap();
        let (from, to) = (b"dup_b.js", b"dup_a.js");
        let mut i = 0;
        while let Some(pos) = bytes[i..].windows(from.len()).position(|w| w == from) {
            bytes[i + pos..i + pos + from.len()].copy_from_slice(to);
            i += pos + from.len();
        }
        std::fs::write(f.path(), bytes).unwrap();
        let r = run(f.path(), false).unwrap();
        assert_eq!(codes(&r), ["duplicate_entries"]);
        assert_eq!(r.findings[0].detail.as_deref(), Some("dup_a.js"));
    }

    #[test]
    fn existing_signature_is_checked_only_when_installing_as_is() {
        let files: [(&str, &[u8]); 3] = [
            ("config.xml", CONFIG.as_bytes()),
            ("index.html", b"<html/>"),
            ("img/a b.png", b"png"),
        ];
        let author = signature(&files);
        let mut distributor_refs = files.to_vec();
        distributor_refs.push((AUTHOR_SIGNATURE, author.as_bytes()));
        let distributor = signature(&distributor_refs);
        let mut entries = files.to_vec();
        entries.push((AUTHOR_SIGNATURE, author.as_bytes()));
        entries.push(("signature1.xml", distributor.as_bytes()));

        let good = make(&entries);
        let r = run(good.path(), true).unwrap();
        assert!(r.ran.contains(&CHECK_SIGNATURE));
        assert!(r.findings.is_empty(), "{r:?}");
        assert!(!run(good.path(), false)
            .unwrap()
            .ran
            .contains(&CHECK_SIGNATURE));

        // A file changed after signing.
        let mut tampered = entries.clone();
        tampered[1] = ("index.html", b"<html>evil</html>");
        let r = run(make(&tampered).path(), true).unwrap();
        assert_eq!(codes(&r), ["signature_mismatch"]);
        assert_eq!(r.findings[0].detail.as_deref(), Some("index.html"));

        // A file added after signing.
        let mut added = entries.clone();
        added.push(("extra.js", b"x"));
        let r = run(make(&added).path(), true).unwrap();
        assert_eq!(codes(&r), ["signature_incomplete"]);

        // No signature at all.
        let r = run(make(&files).path(), true).unwrap();
        assert_eq!(codes(&r), ["signature_missing"]);
        assert!(!r.passed());
    }

    #[test]
    fn mandatory_safety_runs_before_any_optional_check() {
        let dtd = r#"<?xml version="1.0"?><!DOCTYPE widget [<!ENTITY a "a">]><widget>&a;</widget>"#;
        let unsafe_packages = [
            make(&[("config.xml", CONFIG.as_bytes()), ("../evil.txt", b"x")]),
            make(&[("config.xml", dtd.as_bytes()), ("index.html", b"x")]),
            make(&[("index.html", b"no config")]),
        ];
        for f in &unsafe_packages {
            assert!(run(f.path(), false).is_err());
            assert!(run(f.path(), true).is_err());
        }
    }

    #[test]
    fn id_rules() {
        assert!(valid_app_id("abcde12345.MyApp"));
        assert!(!valid_app_id("abcde12345"));
        assert!(!valid_app_id("abcde1234.MyApp"));
        assert!(!valid_app_id("abcde12345.My-App"));
        assert!(!valid_app_id("abcde12345."));
        assert_eq!(executable_kind(b"\xca\xfe\xba\xbe"), Some("Mach-O/Java"));
        assert_eq!(executable_kind(b"<html>"), None);
    }
}
