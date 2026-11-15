//! SSDP (UPnP) discovery: Samsung TVs answer an M-SEARCH for their remote-control and DIAL
//! services. This finds TVs on networks larger than the swept range and TVs that answer
//! slowly to TCP probes. Answers arrive as unicast UDP, which Android delivers without a
//! multicast lock.

use crate::cancel::CancelToken;
use socket2::{Domain, Protocol, Socket, Type};
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::time::{Duration, Instant};

const SSDP_ADDR: Ipv4Addr = Ipv4Addr::new(239, 255, 255, 250);
const SSDP_PORT: u16 = 1900;
/// Samsung TV services worth asking for.
pub const SEARCH_TARGETS: [&str; 2] = [
    "urn:samsung.com:device:RemoteControlReceiver:1",
    "urn:dial-multiscreen-org:service:dial:1",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SsdpHit {
    pub ip: Ipv4Addr,
    /// The answer names a Samsung TV service (not just any UPnP device).
    pub samsung_tv: bool,
    pub server: Option<String>,
}

pub fn m_search(target: &str) -> String {
    format!(
        "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: {target}\r\nUSER-AGENT: EasyTizen UPnP/1.1\r\n\r\n"
    )
}

/// Reads one SSDP answer. Only `HTTP/1.1 200` replies are considered.
pub fn parse_response(ip: Ipv4Addr, text: &str) -> Option<SsdpHit> {
    let mut lines = text.lines();
    let status = lines.next()?;
    if !status.starts_with("HTTP/1.") || !status.contains(" 200") {
        return None;
    }
    let mut server = None;
    let mut st = String::new();
    let mut usn = String::new();
    for line in lines {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match key.trim().to_ascii_lowercase().as_str() {
            "server" => server = Some(value.chars().take(120).collect::<String>()),
            "st" => st = value.to_ascii_lowercase(),
            "usn" => usn = value.to_ascii_lowercase(),
            _ => {}
        }
    }
    let from_samsung = server
        .as_deref()
        .map(|s| s.to_ascii_lowercase().contains("samsung"))
        .unwrap_or(false);
    let tv_service = st.contains("samsung.com:device:remotecontrolreceiver")
        || usn.contains("samsung.com:device:remotecontrolreceiver");
    Some(SsdpHit {
        ip,
        samsung_tv: tv_service || (from_samsung && st.contains("dial")),
        server,
    })
}

fn socket_for(local: Ipv4Addr) -> std::io::Result<UdpSocket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_multicast_if_v4(&local)?;
    socket.set_multicast_ttl_v4(2)?;
    socket.bind(&SocketAddrV4::new(local, 0).into())?;
    let socket: UdpSocket = socket.into();
    socket.set_read_timeout(Some(Duration::from_millis(150)))?;
    Ok(socket)
}

/// Sends M-SEARCH on every given local address (twice, for lossy Wi-Fi) and reports answers
/// from private addresses until `wait` has passed. Errors on one interface do not stop the
/// others; an interface that cannot multicast is simply skipped.
pub fn search(
    local_ips: &[Ipv4Addr],
    wait: Duration,
    cancel: &CancelToken,
    on_hit: &mut dyn FnMut(SsdpHit),
) {
    let sockets: Vec<UdpSocket> = local_ips
        .iter()
        .filter_map(|ip| socket_for(*ip).ok())
        .collect();
    if sockets.is_empty() {
        return;
    }
    let send_all = |sockets: &[UdpSocket]| {
        for socket in sockets {
            for target in SEARCH_TARGETS {
                let _ = socket.send_to(m_search(target).as_bytes(), (SSDP_ADDR, SSDP_PORT));
            }
        }
    };
    send_all(&sockets);
    let start = Instant::now();
    let mut resent = false;
    let mut buffer = [0u8; 2048];
    while start.elapsed() < wait && !cancel.is_cancelled() {
        if !resent && start.elapsed() > Duration::from_millis(700) {
            send_all(&sockets);
            resent = true;
        }
        for socket in &sockets {
            match socket.recv_from(&mut buffer) {
                Ok((n, std::net::SocketAddr::V4(from))) => {
                    let ip = *from.ip();
                    if !ip.is_private() {
                        continue;
                    }
                    if let Some(hit) = parse_response(ip, &String::from_utf8_lossy(&buffer[..n])) {
                        on_hit(hit);
                    }
                }
                _ => continue,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_shape() {
        let m = m_search(SEARCH_TARGETS[0]);
        assert!(m.starts_with("M-SEARCH * HTTP/1.1\r\n"));
        assert!(m.contains("MAN: \"ssdp:discover\"\r\n"));
        assert!(m.ends_with("\r\n\r\n"));
    }

    #[test]
    fn samsung_answers_are_recognised() {
        let ip = Ipv4Addr::new(192, 168, 1, 40);
        let tv = "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nLOCATION: http://192.168.1.40:7676/rcr/\r\nSERVER: SHP, UPnP/1.0, Samsung UPnP SDK/1.0\r\nST: urn:samsung.com:device:RemoteControlReceiver:1\r\nUSN: uuid:0e8a::urn:samsung.com:device:RemoteControlReceiver:1\r\n\r\n";
        let hit = parse_response(ip, tv).unwrap();
        assert!(hit.samsung_tv);
        let dial = "HTTP/1.1 200 OK\r\nSERVER: SHP, UPnP/1.0, Samsung UPnP SDK/1.0\r\nST: urn:dial-multiscreen-org:service:dial:1\r\n\r\n";
        assert!(parse_response(ip, dial).unwrap().samsung_tv);
        let chromecast = "HTTP/1.1 200 OK\r\nSERVER: Linux/3.8 UPnP/1.0 Chromecast\r\nST: urn:dial-multiscreen-org:service:dial:1\r\n\r\n";
        assert!(!parse_response(ip, chromecast).unwrap().samsung_tv);
        assert_eq!(parse_response(ip, "NOTIFY * HTTP/1.1\r\n\r\n"), None);
        assert_eq!(parse_response(ip, "HTTP/1.1 404 Not Found\r\n\r\n"), None);
    }

    #[test]
    fn search_returns_on_time_and_honours_cancel() {
        let start = Instant::now();
        search(
            &[Ipv4Addr::LOCALHOST],
            Duration::from_millis(300),
            &CancelToken::new(),
            &mut |_| {},
        );
        assert!(start.elapsed() < Duration::from_secs(3));
        let cancel = CancelToken::new();
        cancel.cancel();
        let start = Instant::now();
        search(
            &[Ipv4Addr::LOCALHOST],
            Duration::from_secs(10),
            &cancel,
            &mut |_| {},
        );
        assert!(start.elapsed() < Duration::from_secs(2));
    }
}
