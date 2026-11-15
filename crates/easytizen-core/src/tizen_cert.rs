//! The "Tizen certificate": signing with the Tizen SDK's own developer CA and its public
//! distributor signer, so no Samsung account, no sign-in and no DUID are needed.
//!
//! TVs before Tizen 7 accept such packages in Developer Mode (confirmed on a Tizen 4.0 set;
//! others report the same for Tizen 5.0). Newer TVs usually require the Samsung certificate.
//!
//! EasyTizen does not ship the SDK's files. They are read from Samsung's official
//! `certificate-generator` package, either downloaded from download.tizen.org (as Samsung's
//! own Apache-2.0 tooling for VS Code does) or picked by the user as a local copy of that
//! zip. Only the three files needed are taken from the archive and each is checked against a
//! pinned SHA-256, so a tampered or unexpected package is refused.
//!
//! What is created:
//! * `author.p12`: a new RSA-2048 key and an author certificate issued by "Tizen Developers
//!   CA" (the SDK publishes that CA's key and password for exactly this purpose);
//! * `distributor.p12`: the SDK's "Tizen Public Distributor Signer", re-encrypted under the
//!   profile password.

use crate::sign::identity::{cert_info, write_p12, IdentityError, SigningIdentity};
use base64::Engine;
use cbc::cipher::block_padding::Pkcs7;
use cbc::cipher::{BlockModeDecrypt, KeyIvInit};
use md5::{Digest as _, Md5};
use rsa::pkcs1::DecodeRsaPrivateKey;
use rsa::pkcs1v15::SigningKey;
use rsa::pkcs8::EncodePublicKey;
use rsa::sha2::Sha256;
use rsa::PrivateKey;
use std::io::{Cursor, Read};
use std::str::FromStr;
use std::time::{Duration, SystemTime};
use thiserror::Error;
use x509_cert::builder::profile::BuilderProfile;
use x509_cert::builder::{Builder, CertificateBuilder};
use x509_cert::certificate::TbsCertificate;
use x509_cert::der::{Decode, Encode};
use x509_cert::ext::pkix::{
    BasicConstraints, ExtendedKeyUsage, KeyUsage, KeyUsages, SubjectKeyIdentifier,
};
use x509_cert::ext::{Extension, ToExtension};
use x509_cert::name::Name;
use x509_cert::serial_number::SerialNumber;
use x509_cert::spki::{SubjectPublicKeyInfoOwned, SubjectPublicKeyInfoRef};
use x509_cert::time::{Time, Validity};

/// Samsung's official package with the SDK certificates (4.3 MB, the same on every OS).
pub const PACKAGE_URL: &str = "https://download.tizen.org/sdk/tizenstudio/official/binary/certificate-generator_0.1.4_ubuntu-64.zip";
/// Upper bound for a downloaded or picked package.
pub const MAX_PACKAGE_BYTES: u64 = 32 * 1024 * 1024;

const PREFIX: &str = "tools/certificate-generator/certificates/";

/// A file of the SDK package and the SHA-256 it must have.
#[derive(Clone, Copy)]
pub struct PinnedFile {
    /// Path inside the package after `.../tools/certificate-generator/certificates/`.
    pub path: &'static str,
    pub sha256: &'static str,
}

#[derive(Clone, Copy)]
pub struct Pins {
    pub ca_cert: PinnedFile,
    pub ca_key: PinnedFile,
    pub distributor: PinnedFile,
    /// Passwords the SDK publishes for these two files (in its `conf.ini` and tools).
    pub ca_key_password: &'static str,
    pub distributor_password: &'static str,
}

/// The files of certificate-generator 0.1.3 and 0.1.4 (identical in both).
pub const SDK_PINS: Pins = Pins {
    ca_cert: PinnedFile {
        path: "developer/tizen-developer-ca.cer",
        sha256: "be3da0dadc05abe9f7495c52215ef9960f035e16ba6a8e1405679d8b36ff3558",
    },
    ca_key: PinnedFile {
        path: "developer/tizen-developer-ca-privatekey.pem",
        sha256: "646943360f771b9d5538a8a5c9b5f33fe65fd37ac6bea4b2b0f7f6e4ee83976b",
    },
    distributor: PinnedFile {
        path: "distributor/sdk-public/tizen-distributor-signer.p12",
        sha256: "16bd01646a08c294cd52b4ab2280357fd6b203da19dbe1774c81aedb690d6c84",
    },
    ca_key_password: "tizencertificatefordevelopercaroqkfwk",
    distributor_password: "tizenpkcs12passfordsigner",
};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TizenCertError {
    #[error("could not download the Tizen certificate package: {0}")]
    Network(String),
    #[error("the file is not Samsung's certificate-generator package")]
    NotThePackage,
    #[error("the certificate package does not match the expected files")]
    Mismatch,
    #[error("the author name is not valid")]
    InvalidName,
    #[error("could not create the certificate")]
    Crypto,
    #[error(transparent)]
    Identity(#[from] IdentityError),
}

/// The SDK's developer CA and public distributor signer, read and verified.
pub struct SdkSigners {
    ca_cert_der: Vec<u8>,
    ca_key: PrivateKey,
    distributor: SigningIdentity,
}

impl std::fmt::Debug for SdkSigners {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SdkSigners").finish_non_exhaustive()
    }
}

/// Downloads the official package. Nothing but a generic User-Agent is sent.
pub fn download_package(timeout: Duration) -> Result<Vec<u8>, TizenCertError> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(timeout))
        .http_status_as_error(false)
        .build()
        .into();
    let mut response = agent
        .get(PACKAGE_URL)
        .header("User-Agent", "EasyTizen")
        .call()
        .map_err(|e| TizenCertError::Network(network_reason(&e)))?;
    let status = response.status().as_u16();
    if status != 200 {
        return Err(TizenCertError::Network(format!("HTTP {status}")));
    }
    response
        .body_mut()
        .with_config()
        .limit(MAX_PACKAGE_BYTES)
        .read_to_vec()
        .map_err(|e| TizenCertError::Network(network_reason(&e)))
}

fn network_reason(error: &ureq::Error) -> String {
    match error {
        ureq::Error::Timeout(_) => "timed out".into(),
        ureq::Error::HostNotFound => "host not found (no internet connection?)".into(),
        ureq::Error::Io(e) => format!("{:?}", e.kind()),
        ureq::Error::Tls(_) | ureq::Error::Rustls(_) => "secure connection failed".into(),
        ureq::Error::BodyExceedsLimit(_) => "unexpectedly large download".into(),
        _ => "request failed".into(),
    }
}

fn sha256_hex(data: &[u8]) -> String {
    use rsa::sha2::Digest;
    Sha256::digest(data)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Reads the three pinned files from a certificate-generator zip (any OS variant).
pub fn read_package(zip_bytes: &[u8], pins: &Pins) -> Result<SdkSigners, TizenCertError> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(zip_bytes)).map_err(|_| TizenCertError::NotThePackage)?;
    let mut take = |pin: &PinnedFile| -> Result<Vec<u8>, TizenCertError> {
        let wanted = format!("{PREFIX}{}", pin.path);
        let name = archive
            .file_names()
            .find(|n| n.ends_with(&wanted))
            .map(str::to_string)
            .ok_or(TizenCertError::NotThePackage)?;
        let entry = archive
            .by_name(&name)
            .map_err(|_| TizenCertError::NotThePackage)?;
        if entry.size() > 64 * 1024 {
            return Err(TizenCertError::Mismatch);
        }
        let mut data = Vec::new();
        entry
            .take(64 * 1024 + 1)
            .read_to_end(&mut data)
            .map_err(|_| TizenCertError::NotThePackage)?;
        if sha256_hex(&data) != pin.sha256 {
            return Err(TizenCertError::Mismatch);
        }
        Ok(data)
    };
    let ca_cert = take(&pins.ca_cert)?;
    let ca_key = take(&pins.ca_key)?;
    let distributor = take(&pins.distributor)?;

    let ca_cert_der = pem_or_der_certificate(&ca_cert).ok_or(TizenCertError::Mismatch)?;
    let ca_key = decrypt_legacy_pem_key(&ca_key, pins.ca_key_password)?;
    let distributor = SigningIdentity::from_p12(&distributor, pins.distributor_password)?;
    // The CA key must belong to the CA certificate.
    let ca =
        x509_cert::Certificate::from_der(&ca_cert_der).map_err(|_| TizenCertError::Mismatch)?;
    let ca_spki = ca
        .tbs_certificate()
        .subject_public_key_info()
        .to_der()
        .map_err(|_| TizenCertError::Mismatch)?;
    let key_spki = ca_key
        .to_public_key()
        .to_public_key_der()
        .map_err(|_| TizenCertError::Crypto)?;
    if key_spki.as_bytes() != ca_spki.as_slice() {
        return Err(TizenCertError::Mismatch);
    }
    Ok(SdkSigners {
        ca_cert_der,
        ca_key,
        distributor,
    })
}

fn pem_or_der_certificate(data: &[u8]) -> Option<Vec<u8>> {
    let text = std::str::from_utf8(data).ok();
    match text.and_then(|t| t.find("-----BEGIN CERTIFICATE-----").map(|i| &t[i..])) {
        Some(pem) => {
            let body = pem
                .lines()
                .skip(1)
                .take_while(|l| !l.starts_with("-----END"))
                .collect::<String>();
            base64::engine::general_purpose::STANDARD
                .decode(body.trim())
                .ok()
        }
        None => Some(data.to_vec()),
    }
}

/// Decrypts an OpenSSL "traditional" encrypted RSA key (`Proc-Type: 4,ENCRYPTED`,
/// `DEK-Info: AES-128-CBC,<iv>`), the format the SDK uses for its developer CA key.
pub fn decrypt_legacy_pem_key(pem: &[u8], password: &str) -> Result<PrivateKey, TizenCertError> {
    let text = std::str::from_utf8(pem).map_err(|_| TizenCertError::Mismatch)?;
    let mut iv_hex = None;
    let mut body = String::new();
    let mut inside = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with("-----BEGIN RSA PRIVATE KEY-----") {
            inside = true;
        } else if line.starts_with("-----END") {
            break;
        } else if inside {
            if let Some(value) = line.strip_prefix("DEK-Info:") {
                let (algorithm, iv) = value
                    .trim()
                    .split_once(',')
                    .ok_or(TizenCertError::Mismatch)?;
                if algorithm != "AES-128-CBC" {
                    return Err(TizenCertError::Mismatch);
                }
                iv_hex = Some(iv.to_string());
            } else if !line.contains(':') {
                body.push_str(line);
            }
        }
    }
    let iv =
        decode_hex(&iv_hex.ok_or(TizenCertError::Mismatch)?).ok_or(TizenCertError::Mismatch)?;
    if iv.len() != 16 {
        return Err(TizenCertError::Mismatch);
    }
    let encrypted = base64::engine::general_purpose::STANDARD
        .decode(body)
        .map_err(|_| TizenCertError::Mismatch)?;
    // EVP_BytesToKey(MD5, salt = first 8 bytes of the IV, one iteration): 16 bytes suffice.
    let mut hasher = Md5::new();
    hasher.update(password.as_bytes());
    hasher.update(&iv[..8]);
    let key = hasher.finalize();
    let decryptor = cbc::Decryptor::<aes::Aes128>::new_from_slices(&key, &iv)
        .map_err(|_| TizenCertError::Crypto)?;
    let mut buffer = encrypted;
    let plain = decryptor
        .decrypt_padded::<Pkcs7>(&mut buffer)
        .map_err(|_| TizenCertError::Mismatch)?;
    PrivateKey::from_pkcs1_der(plain).map_err(|_| TizenCertError::Mismatch)
}

fn decode_hex(hex: &str) -> Option<Vec<u8>> {
    if !hex.len().is_multiple_of(2) {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok())
        .collect()
}

/// An author certificate profile: issued by the developer CA, for signing only.
struct AuthorProfile {
    issuer: Name,
    subject: Name,
}

impl BuilderProfile for AuthorProfile {
    fn get_issuer(&self, _subject: &Name) -> Name {
        self.issuer.clone()
    }
    fn get_subject(&self) -> Name {
        self.subject.clone()
    }
    fn build_extensions(
        &self,
        spk: SubjectPublicKeyInfoRef<'_>,
        _issuer_spk: SubjectPublicKeyInfoRef<'_>,
        tbs: &TbsCertificate,
    ) -> x509_cert::builder::Result<Vec<Extension>> {
        let mut out: Vec<Extension> = Vec::new();
        let basic = BasicConstraints {
            ca: false,
            path_len_constraint: None,
        };
        out.push((false, &basic).to_extension(tbs.subject(), &out)?);
        let usage = KeyUsage(KeyUsages::DigitalSignature | KeyUsages::KeyEncipherment);
        out.push((false, &usage).to_extension(tbs.subject(), &out)?);
        let extended = ExtendedKeyUsage(vec![
            x509_cert::der::oid::db::rfc5280::ID_KP_CLIENT_AUTH,
            x509_cert::der::oid::db::rfc5280::ID_KP_EMAIL_PROTECTION,
        ]);
        out.push((false, &extended).to_extension(tbs.subject(), &out)?);
        let ski = SubjectKeyIdentifier::try_from(spk)?;
        out.push((false, &ski).to_extension(tbs.subject(), &out)?);
        Ok(out)
    }
}

/// The two keystores of a new Tizen certificate profile, encrypted with `password`.
pub struct TizenProfile {
    pub author_p12: Vec<u8>,
    pub distributor_p12: Vec<u8>,
}

impl SdkSigners {
    /// Not-after of the developer CA (Unix seconds). Author certificates never outlive it.
    pub fn ca_not_after(&self) -> i64 {
        cert_info(&self.ca_cert_der)
            .map(|i| i.not_after)
            .unwrap_or_default()
    }

    /// Creates a new author key and certificate for `author_name` and packages both
    /// keystores under `password`. `now` is Unix seconds.
    pub fn create_profile(
        &self,
        author_name: &str,
        password: &str,
        now: i64,
    ) -> Result<TizenProfile, TizenCertError> {
        let name = author_name.trim();
        if !(2..=64).contains(&name.chars().count()) || name.chars().any(|c| c.is_control()) {
            return Err(TizenCertError::InvalidName);
        }
        let subject = Name::from_str(&format!(
            "CN={}",
            crate::samsung_ca::csr::escape_dn_value(name)
        ))
        .map_err(|_| TizenCertError::InvalidName)?;
        let ca = x509_cert::Certificate::from_der(&self.ca_cert_der)
            .map_err(|_| TizenCertError::Mismatch)?;
        let issuer = ca.tbs_certificate().subject().clone();

        // Valid from a day ago (clock skew on the TV) until the CA itself expires. Should the
        // CA already have expired, keep the window inside the CA's own validity.
        let ca_end = self.ca_not_after();
        let start = (now - 86_400).min(ca_end - 2 * 86_400);
        let at = |secs: i64| -> Result<Time, TizenCertError> {
            Time::try_from(SystemTime::UNIX_EPOCH + Duration::from_secs(secs.max(0) as u64))
                .map_err(|_| TizenCertError::Crypto)
        };
        let validity = Validity::new(at(start)?, at(ca_end)?);

        let key =
            PrivateKey::new(&mut getrandom::SysRng, 2048).map_err(|_| TizenCertError::Crypto)?;
        let spki_der = key
            .to_public_key()
            .to_public_key_der()
            .map_err(|_| TizenCertError::Crypto)?;
        let spki = SubjectPublicKeyInfoOwned::from_der(spki_der.as_bytes())
            .map_err(|_| TizenCertError::Crypto)?;
        let mut serial = [0u8; 16];
        getrandom::fill(&mut serial).map_err(|_| TizenCertError::Crypto)?;
        serial[0] &= 0x7f;
        serial[0] |= 0x01;
        let serial = SerialNumber::new(&serial).map_err(|_| TizenCertError::Crypto)?;

        let builder =
            CertificateBuilder::new(AuthorProfile { issuer, subject }, serial, validity, spki)
                .map_err(|_| TizenCertError::Crypto)?;
        let signer = SigningKey::<Sha256>::new(self.ca_key.clone());
        let cert = builder
            .build::<_, rsa::pkcs1v15::Signature>(&signer)
            .map_err(|_| TizenCertError::Crypto)?;
        let author_der = cert.to_der().map_err(|_| TizenCertError::Crypto)?;

        let author_p12 = write_p12(
            &key,
            &[author_der, self.ca_cert_der.clone()],
            "author",
            password,
        )?;
        let distributor_p12 = self.distributor.repack("distributor", password)?;
        // Prove both keystores open and are what they claim before anything is saved.
        let author = SigningIdentity::from_p12(&author_p12, password)?;
        if !author.info.duids.is_empty() {
            return Err(TizenCertError::Crypto);
        }
        Ok(TizenProfile {
            author_p12,
            distributor_p12,
        })
    }
}

/// True for a distributor certificate from the Tizen SDK (no DUIDs, any TV in Developer
/// Mode) rather than one Samsung issued for specific TVs.
pub fn is_sdk_distributor(issuer: &str) -> bool {
    let issuer = issuer.to_ascii_lowercase();
    issuer.contains("tizen public distributor")
        || issuer.contains("tizen partner distributor")
        || issuer.contains("tizen studio")
}

#[cfg(test)]
mod tests {
    use super::*;
    use cbc::cipher::BlockModeEncrypt;
    use std::io::Write;
    use x509_cert::builder::profile::cabf::Root;

    fn self_signed(cn: &str, key: &PrivateKey) -> Vec<u8> {
        let spki_der = key.to_public_key().to_public_key_der().unwrap();
        let spki = SubjectPublicKeyInfoOwned::from_der(spki_der.as_bytes()).unwrap();
        let builder = CertificateBuilder::new(
            Root::new(
                false,
                Name::from_str(&format!("CN={cn},O=Test,C=KR")).unwrap(),
            )
            .unwrap(),
            SerialNumber::from(7u32),
            Validity::from_now(Duration::from_secs(400 * 86_400)).unwrap(),
            spki,
        )
        .unwrap();
        let signer = SigningKey::<Sha256>::new(key.clone());
        builder
            .build::<_, rsa::pkcs1v15::Signature>(&signer)
            .unwrap()
            .to_der()
            .unwrap()
    }

    fn encrypt_legacy_pem(key: &PrivateKey, password: &str) -> String {
        use rsa::pkcs1::EncodeRsaPrivateKey;
        let der = key.to_pkcs1_der().unwrap();
        let iv: [u8; 16] = *b"0123456789abcdef";
        let mut hasher = Md5::new();
        hasher.update(password.as_bytes());
        hasher.update(&iv[..8]);
        let k = hasher.finalize();
        let encrypted = cbc::Encryptor::<aes::Aes128>::new_from_slices(&k, &iv)
            .unwrap()
            .encrypt_padded_vec::<Pkcs7>(der.as_bytes());
        let body = base64::engine::general_purpose::STANDARD.encode(encrypted);
        let iv_hex: String = iv.iter().map(|b| format!("{b:02X}")).collect();
        let mut pem = format!("-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,{iv_hex}\n\n");
        for chunk in body.as_bytes().chunks(64) {
            pem.push_str(std::str::from_utf8(chunk).unwrap());
            pem.push('\n');
        }
        pem.push_str("-----END RSA PRIVATE KEY-----\n");
        pem
    }

    fn now() -> i64 {
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
    }

    fn leak(s: String) -> &'static str {
        Box::leak(s.into_boxed_str())
    }

    /// A package laid out like certificate-generator, with throw-away test keys.
    fn fixture(tamper: bool) -> (Vec<u8>, Pins) {
        let ca_key = PrivateKey::new(&mut getrandom::SysRng, 2048).unwrap();
        let ca_der = self_signed("Test Developers CA", &ca_key);
        let ca_pem = format!(
            "-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----\n",
            base64::engine::general_purpose::STANDARD.encode(&ca_der)
        );
        let key_pem = encrypt_legacy_pem(&ca_key, "capass");
        let dist_key = PrivateKey::new(&mut getrandom::SysRng, 2048).unwrap();
        let dist_der = self_signed("Tizen Public Distributor Signer", &dist_key);
        let dist_p12 = write_p12(&dist_key, &[dist_der], "d", "distpass").unwrap();

        let mut zip_bytes = Vec::new();
        {
            let mut w = zip::ZipWriter::new(Cursor::new(&mut zip_bytes));
            let o = zip::write::SimpleFileOptions::default();
            let base = "data/tools/certificate-generator/certificates/";
            for (path, data) in [
                ("developer/tizen-developer-ca.cer", ca_pem.as_bytes()),
                (
                    "developer/tizen-developer-ca-privatekey.pem",
                    key_pem.as_bytes(),
                ),
                (
                    "distributor/sdk-public/tizen-distributor-signer.p12",
                    &dist_p12[..],
                ),
            ] {
                w.start_file(format!("{base}{path}"), o).unwrap();
                w.write_all(data).unwrap();
            }
            w.finish().unwrap();
        }
        let ca_hash = if tamper {
            "00".repeat(32)
        } else {
            sha256_hex(ca_pem.as_bytes())
        };
        let pins = Pins {
            ca_cert: PinnedFile {
                path: SDK_PINS.ca_cert.path,
                sha256: leak(ca_hash),
            },
            ca_key: PinnedFile {
                path: SDK_PINS.ca_key.path,
                sha256: leak(sha256_hex(key_pem.as_bytes())),
            },
            distributor: PinnedFile {
                path: SDK_PINS.distributor.path,
                sha256: leak(sha256_hex(&dist_p12)),
            },
            ca_key_password: "capass",
            distributor_password: "distpass",
        };
        (zip_bytes, pins)
    }

    #[test]
    fn creates_a_profile_from_the_package() {
        let (zip, pins) = fixture(false);
        let signers = read_package(&zip, &pins).unwrap();
        let now = now();
        let profile = signers
            .create_profile("Ivan, Test", "secret1", now)
            .unwrap();

        let author = SigningIdentity::from_p12(&profile.author_p12, "secret1").unwrap();
        assert_eq!(author.info.subject, "Ivan, Test");
        assert_eq!(author.info.issuer, "Test Developers CA");
        assert!(author.info.duids.is_empty());
        assert!(author.info.not_before <= now && author.info.not_after == signers.ca_not_after());
        assert_eq!(author.chain.len(), 2, "author + developer CA");

        let distributor = SigningIdentity::from_p12(&profile.distributor_p12, "secret1").unwrap();
        assert_eq!(distributor.info.subject, "Tizen Public Distributor Signer");
        assert!(SigningIdentity::from_p12(&profile.author_p12, "wrong").is_err());

        // The author certificate really is signed by the CA key.
        let cert = x509_cert::Certificate::from_der(&author.chain[0]).unwrap();
        let tbs = cert.tbs_certificate().to_der().unwrap();
        let verifier = rsa::pkcs1v15::VerifyingKey::<Sha256>::new(signers.ca_key.to_public_key());
        let sig = rsa::pkcs1v15::Signature::try_from(cert.signature().raw_bytes()).unwrap();
        use rsa::signature::Verifier;
        verifier.verify(&tbs, &sig).unwrap();
    }

    #[test]
    fn refuses_unexpected_packages() {
        let (zip, pins) = fixture(true);
        assert_eq!(
            read_package(&zip, &pins).err(),
            Some(TizenCertError::Mismatch)
        );
        assert_eq!(
            read_package(b"not a zip", &SDK_PINS).err(),
            Some(TizenCertError::NotThePackage)
        );
        let (zip, mut pins) = fixture(false);
        pins.ca_key_password = "wrong";
        assert_eq!(
            read_package(&zip, &pins).err(),
            Some(TizenCertError::Mismatch)
        );
    }

    #[test]
    fn rejects_bad_author_names() {
        let (zip, pins) = fixture(false);
        let signers = read_package(&zip, &pins).unwrap();
        assert_eq!(
            signers.create_profile("x", "p", 0).err(),
            Some(TizenCertError::InvalidName)
        );
    }

    #[test]
    fn recognises_sdk_distributors() {
        assert!(is_sdk_distributor("Tizen Public Distributor CA"));
        assert!(!is_sdk_distributor("Samsung VD Distributor CA"));
    }

    /// Downloads the real package from download.tizen.org and builds a profile from it.
    /// Run with `cargo test -p easytizen-core -- --ignored real_sdk_package`.
    #[test]
    #[ignore = "needs network access to download.tizen.org"]
    fn real_sdk_package() {
        let zip = download_package(Duration::from_secs(120)).unwrap();
        let signers = read_package(&zip, &SDK_PINS).unwrap();
        let profile = signers
            .create_profile("EasyTizen Test", "pass1234", now())
            .unwrap();
        let author = SigningIdentity::from_p12(&profile.author_p12, "pass1234").unwrap();
        assert_eq!(author.info.issuer, "Tizen Developers CA");
        let distributor = SigningIdentity::from_p12(&profile.distributor_p12, "pass1234").unwrap();
        assert_eq!(distributor.info.subject, "Tizen Public Distributor Signer");
    }
}
