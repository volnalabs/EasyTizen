//! Samsung's device information API: `http://<tv>:8001/api/v2/`.
//!
//! Every Samsung Smart TV since 2016 answers this request on the local network, whether or
//! not Developer Mode is on. Its `device` object says what the TV is (name, model, OS) and,
//! crucially for installation, `developerMode` (`"1"`/`"0"`) and `developerIP` — the Host PC
//! IP the TV accepts. That turns "the TV refused the connection" into a precise instruction.
//!
//! The request is a plain HTTP GET written by hand on a TCP socket: no system proxy is
//! consulted (a LAN request must never go to a corporate proxy), the answer is size-capped.

use crate::cancel::CancelToken;
use serde::Serialize;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

pub const SAMSUNG_API_PORT: u16 = 8001;
const MAX_RESPONSE: usize = 128 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
pub struct SamsungTvInfo {
    /// Friendly name, e.g. "Samsung 7 Series (55)" ("[TV] " prefix removed).
    pub name: Option<String>,
    /// Marketing model, e.g. "UE55TU7100UXRU".
    pub model_name: Option<String>,
    /// Platform code, e.g. "20_NIKEM2_UHD".
    pub model_code: Option<String>,
    /// "Tizen" on every supported TV.
    pub os: Option<String>,
    pub firmware: Option<String>,
    /// `Some(false)` is a reliable "Developer Mode is off".
    pub developer_mode: Option<bool>,
    /// The Host PC IP configured in Developer Mode.
    pub developer_ip: Option<Ipv4Addr>,
    /// "wireless" / "wired".
    pub network_type: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiProbeError {
    /// Nothing listens on the port, or no answer in time.
    Unavailable,
    TimedOut,
    /// Something answered, but not Samsung's TV API.
    NotSamsung,
    Cancelled,
}

fn clean_text(v: &str, max: usize) -> Option<String> {
    let t: String = v
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect();
    let t = t.trim().to_string();
    (!t.is_empty() && !t.eq_ignore_ascii_case("unknown")).then_some(t)
}

/// Parses the JSON answer. `None` when it is not a Samsung TV's device description.
pub fn parse(json: &str) -> Option<SamsungTvInfo> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    let device = value.get("device")?.as_object()?;
    let text = |key: &str| device.get(key).and_then(|v| v.as_str());
    let kind = text("type").or_else(|| value.get("type").and_then(|v| v.as_str()));
    let os = text("OS");
    let samsung = kind
        .map(|t| t.to_ascii_lowercase().contains("samsung"))
        .unwrap_or(false)
        || os.map(|o| o.eq_ignore_ascii_case("tizen")).unwrap_or(false);
    if !samsung {
        return None;
    }
    let name = text("name")
        .or_else(|| value.get("name").and_then(|v| v.as_str()))
        .map(|n| n.trim().trim_start_matches("[TV]").trim().to_string())
        .and_then(|n| clean_text(&n, 80));
    let developer_mode = match text("developerMode").map(str::trim) {
        Some("1") | Some("true") => Some(true),
        Some("0") | Some("false") => Some(false),
        _ => None,
    };
    let developer_ip = text("developerIP")
        .and_then(|ip| ip.trim().parse::<Ipv4Addr>().ok())
        .filter(|ip| !ip.is_unspecified());
    Some(SamsungTvInfo {
        name,
        model_name: text("modelName").and_then(|v| clean_text(v, 40)),
        model_code: text("model").and_then(|v| clean_text(v, 40)),
        os: os.and_then(|v| clean_text(v, 20)),
        firmware: text("firmwareVersion").and_then(|v| clean_text(v, 40)),
        developer_mode,
        developer_ip,
        network_type: text("networkType").and_then(|v| clean_text(v, 20)),
    })
}

/// Splits an HTTP/1.x response into status and body (Content-Length, chunked or until close).
fn parse_http(raw: &[u8]) -> Option<(u16, String)> {
    let end = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&raw[..end]);
    let status: u16 = head
        .lines()
        .next()?
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()?;
    let body = &raw[end + 4..];
    let chunked = head.lines().any(|l| {
        let l = l.to_ascii_lowercase();
        l.starts_with("transfer-encoding:") && l.contains("chunked")
    });
    let body = if chunked {
        let mut out = Vec::new();
        let mut rest = body;
        loop {
            let line_end = rest.windows(2).position(|w| w == b"\r\n")?;
            let size = usize::from_str_radix(
                String::from_utf8_lossy(&rest[..line_end])
                    .split(';')
                    .next()?
                    .trim(),
                16,
            )
            .ok()?;
            rest = &rest[line_end + 2..];
            if size == 0 || rest.len() < size {
                out.extend_from_slice(&rest[..size.min(rest.len())]);
                break;
            }
            out.extend_from_slice(&rest[..size]);
            rest = rest.get(size + 2..).unwrap_or(&[]);
        }
        out
    } else {
        body.to_vec()
    };
    Some((status, String::from_utf8_lossy(&body).into_owned()))
}

/// GET `http://ip:port/api/v2/` with an overall deadline.
pub fn fetch(
    ip: Ipv4Addr,
    port: u16,
    timeout: Duration,
    cancel: &CancelToken,
) -> Result<SamsungTvInfo, ApiProbeError> {
    if cancel.is_cancelled() {
        return Err(ApiProbeError::Cancelled);
    }
    let deadline = Instant::now() + timeout;
    let mut stream =
        TcpStream::connect_timeout(&SocketAddr::from((ip, port)), timeout).map_err(|e| match e
            .kind()
        {
            std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => {
                ApiProbeError::TimedOut
            }
            _ => ApiProbeError::Unavailable,
        })?;
    stream
        .set_read_timeout(Some(Duration::from_millis(150)))
        .ok();
    stream.set_write_timeout(Some(timeout)).ok();
    let request = format!(
        "GET /api/v2/ HTTP/1.1\r\nHost: {ip}:{port}\r\nUser-Agent: EasyTizen\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|_| ApiProbeError::Unavailable)?;
    let mut raw = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        if cancel.is_cancelled() {
            return Err(ApiProbeError::Cancelled);
        }
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                raw.extend_from_slice(&buffer[..n]);
                if raw.len() > MAX_RESPONSE {
                    return Err(ApiProbeError::NotSamsung);
                }
                // A complete Content-Length body ends the read early (keep-alive servers).
                if body_complete(&raw) {
                    break;
                }
            }
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                if Instant::now() >= deadline {
                    if raw.is_empty() {
                        return Err(ApiProbeError::TimedOut);
                    }
                    break;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => break,
        }
    }
    let (status, body) = parse_http(&raw).ok_or(ApiProbeError::NotSamsung)?;
    if status != 200 {
        return Err(ApiProbeError::NotSamsung);
    }
    parse(&body).ok_or(ApiProbeError::NotSamsung)
}

fn body_complete(raw: &[u8]) -> bool {
    let Some(end) = raw.windows(4).position(|w| w == b"\r\n\r\n") else {
        return false;
    };
    let head = String::from_utf8_lossy(&raw[..end]).to_ascii_lowercase();
    head.lines()
        .find_map(|l| {
            l.strip_prefix("content-length:")
                .and_then(|v| v.trim().parse::<usize>().ok())
        })
        .map(|length| raw.len() >= end + 4 + length)
        .unwrap_or(false)
}

/// Fetch with one retry after a timeout (Wi-Fi TVs sometimes answer the second request).
pub fn fetch_with_retry(
    ip: Ipv4Addr,
    port: u16,
    timeout: Duration,
    cancel: &CancelToken,
) -> Result<SamsungTvInfo, ApiProbeError> {
    match fetch(ip, port, timeout, cancel) {
        Err(ApiProbeError::TimedOut) => fetch(ip, port, timeout, cancel),
        other => other,
    }
}

#[cfg(any(test, feature = "mock-tv"))]
pub mod mock {
    //! A stand-in for a TV's device API, for tests and the `mock_tv` example.
    use std::io::{Read, Write};
    use std::net::{Ipv4Addr, TcpListener};

    /// Serves `/api/v2/` with the given values. Returns the port.
    pub fn serve(
        bind: Ipv4Addr,
        port: u16,
        name: &str,
        developer_mode: bool,
        developer_ip: &str,
    ) -> std::io::Result<u16> {
        let listener = TcpListener::bind((bind, port))?;
        let port = listener.local_addr()?.port();
        let body = serde_json::json!({
            "device": {
                "FrameTVSupport": "false",
                "OS": "Tizen",
                "developerIP": developer_ip,
                "developerMode": if developer_mode { "1" } else { "0" },
                "firmwareVersion": "Unknown",
                "modelName": "UE55TU7100UXRU",
                "model": "20_NIKEM2_UHD",
                "name": format!("[TV] {name}"),
                "networkType": "wireless",
                "type": "Samsung SmartTV"
            },
            "name": format!("[TV] {name}"),
            "type": "Samsung SmartTV",
            "version": "2.0.25"
        })
        .to_string();
        std::thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let mut buffer = [0u8; 2048];
                let _ = stream.read(&mut buffer);
                let _ = stream.write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                );
            }
        });
        Ok(port)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const REAL_SHAPE: &str = r#"{"device":{"FrameTVSupport":"false","GamePadSupport":"true","ImeSyncedSupport":"true","Language":"ru_RU","OS":"Tizen","PowerState":"on","TokenAuthSupport":"true","VoiceSupport":"true","WallScreenRatio":"0","WallService":"false","countryCode":"RU","description":"Samsung DTV RCR","developerIP":"192.168.1.20","developerMode":"1","duid":"uuid:0e8a5f2c-0000-0000-0000-000000000000","firmwareVersion":"Unknown","id":"uuid:0e8a5f2c-0000-0000-0000-000000000000","ip":"192.168.1.40","model":"20_NIKEM2_UHD","modelName":"UE55TU7100UXRU","name":"[TV] Samsung 7 Series (55)","networkType":"wireless","resolution":"3840x2160","smartHubAgreement":"true","type":"Samsung SmartTV","udn":"uuid:0e8a5f2c-0000-0000-0000-000000000000","wifiMac":"aa:bb:cc:dd:ee:ff"},"id":"uuid:0e8a5f2c-0000-0000-0000-000000000000","isSupport":"{}","name":"[TV] Samsung 7 Series (55)","remote":"1.0","type":"Samsung SmartTV","uri":"http://192.168.1.40:8001/api/v2/","version":"2.0.25"}"#;

    #[test]
    fn parses_the_real_answer_shape() {
        let info = parse(REAL_SHAPE).unwrap();
        assert_eq!(info.name.as_deref(), Some("Samsung 7 Series (55)"));
        assert_eq!(info.model_name.as_deref(), Some("UE55TU7100UXRU"));
        assert_eq!(info.model_code.as_deref(), Some("20_NIKEM2_UHD"));
        assert_eq!(info.os.as_deref(), Some("Tizen"));
        assert_eq!(info.firmware, None, "\"Unknown\" is not shown");
        assert_eq!(info.developer_mode, Some(true));
        assert_eq!(info.developer_ip, Some(Ipv4Addr::new(192, 168, 1, 20)));
    }

    #[test]
    fn developer_mode_off_and_unknowns() {
        let off = REAL_SHAPE
            .replace(r#""developerMode":"1""#, r#""developerMode":"0""#)
            .replace("192.168.1.20", "0.0.0.0");
        let info = parse(&off).unwrap();
        assert_eq!(info.developer_mode, Some(false));
        assert_eq!(info.developer_ip, None);
        let missing = REAL_SHAPE.replace(r#""developerMode":"1","#, "");
        assert_eq!(parse(&missing).unwrap().developer_mode, None);
    }

    #[test]
    fn non_samsung_answers_are_rejected() {
        assert_eq!(parse("not json"), None);
        assert_eq!(parse(r#"{"device":{"type":"Chromecast"}}"#), None);
        assert_eq!(parse(r#"{"name":"router"}"#), None);
    }

    #[test]
    fn http_parsing() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}";
        assert_eq!(parse_http(raw), Some((200, "{}".into())));
        let chunked = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n";
        assert_eq!(parse_http(chunked), Some((200, "{}".into())));
        assert_eq!(parse_http(b"garbage"), None);
    }

    #[test]
    fn fetch_against_a_stand_in() {
        let port = mock::serve(Ipv4Addr::LOCALHOST, 0, "Living room", false, "0.0.0.0").unwrap();
        let info = fetch(
            Ipv4Addr::LOCALHOST,
            port,
            Duration::from_secs(3),
            &CancelToken::new(),
        )
        .unwrap();
        assert_eq!(info.name.as_deref(), Some("Living room"));
        assert_eq!(info.developer_mode, Some(false));
        // Nothing listening.
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let closed_port = closed.local_addr().unwrap().port();
        drop(closed);
        assert_eq!(
            fetch(
                Ipv4Addr::LOCALHOST,
                closed_port,
                // Windows reports a refused connection only after ~2 s of SYN retries.
                Duration::from_secs(5),
                &CancelToken::new()
            ),
            Err(ApiProbeError::Unavailable)
        );
    }
}
