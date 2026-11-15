//! The local networks of this computer or phone: which interfaces exist, which of them can
//! reach a TV on the same LAN, and which addresses discovery may sweep.
//!
//! Only private (RFC 1918) networks are ever swept — never public address space, and never
//! VPN, virtual-machine or mobile-data interfaces.

use serde::Serialize;
use std::net::Ipv4Addr;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InterfaceKind {
    Wifi,
    Ethernet,
    /// A phone's own hotspot (TVs can join it).
    Hotspot,
    /// Mobile data — a TV is never on this network.
    Mobile,
    Vpn,
    /// Virtual machines, containers, WSL, Hyper-V …
    Virtual,
    Other,
}

impl InterfaceKind {
    /// Interfaces a TV on the user's LAN can be reached through.
    pub fn is_lan(self) -> bool {
        matches!(
            self,
            InterfaceKind::Wifi
                | InterfaceKind::Ethernet
                | InterfaceKind::Hotspot
                | InterfaceKind::Other
        )
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LocalInterface {
    pub name: String,
    pub ip: Ipv4Addr,
    pub prefix_len: u8,
    pub kind: InterfaceKind,
    /// The interface of the default route (what the OS uses for most traffic).
    pub primary: bool,
    /// A private (RFC 1918) address: discovery sweeps only these.
    pub private: bool,
}

impl LocalInterface {
    pub fn contains(&self, ip: Ipv4Addr) -> bool {
        let (network, broadcast) = network_bounds(self.ip, self.prefix_len);
        let v = u32::from(ip);
        v >= network && v <= broadcast
    }

    /// Whether discovery sweeps this interface.
    pub fn scannable(&self) -> bool {
        self.kind.is_lan() && self.private && self.prefix_len <= 30
    }
}

/// Decides what an interface is from its name (the only thing every OS reports).
pub fn classify(name: &str, point_to_point: bool) -> InterfaceKind {
    let n = name.to_lowercase();
    let starts = |p: &[&str]| p.iter().any(|x| n.starts_with(x));
    let has = |p: &[&str]| p.iter().any(|x| n.contains(x));
    if has(&[
        "docker",
        "veth",
        "virbr",
        "vmnet",
        "vbox",
        "virtualbox",
        "vmware",
        "hyper-v",
        "vethernet",
        "wsl",
        "lxc",
        "lxd",
        "podman",
        "cni",
        "flannel",
        "kube",
        "dummy",
        "npcap",
        "loopback",
        "parallels",
        "utm",
    ]) || starts(&["br-"])
    {
        return InterfaceKind::Virtual;
    }
    if has(&[
        "tailscale",
        "zerotier",
        "wireguard",
        "openvpn",
        "nordlynx",
        "proton",
        "vpn",
        "fortinet",
        "anyconnect",
        "wintun",
        "tap-windows",
    ]) || starts(&["tun", "tap", "utun", "wg", "zt", "ppp", "ipsec", "gpd"])
    {
        return InterfaceKind::Vpn;
    }
    if starts(&[
        "rmnet",
        "ccmni",
        "pdp",
        "rev_rmnet",
        "v4-rmnet",
        "clat",
        "seth_",
        "radio",
    ]) {
        return InterfaceKind::Mobile;
    }
    if starts(&["swlan", "ap0", "softap", "wlan1"]) {
        return InterfaceKind::Hotspot;
    }
    if starts(&["wlan", "wlp", "wlx", "wl0", "ath"])
        || has(&["wi-fi", "wifi", "wireless", "wlan", "беспровод"])
    {
        return InterfaceKind::Wifi;
    }
    if starts(&["eth", "enp", "eno", "ens", "enx", "lan"]) || has(&["ethernet", "локальной сети"])
    {
        return InterfaceKind::Ethernet;
    }
    if point_to_point {
        return InterfaceKind::Vpn;
    }
    InterfaceKind::Other
}

/// `(network, broadcast)` as integers for `ip/prefix`.
pub fn network_bounds(ip: Ipv4Addr, prefix_len: u8) -> (u32, u32) {
    let prefix = prefix_len.min(32) as u32;
    let mask: u32 = if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix)
    };
    let network = u32::from(ip) & mask;
    (network, network | !mask)
}

/// The IPv4 address of the interface used for the default route. A connected UDP socket is
/// used; no packet is sent.
pub fn primary_local_ip() -> Option<Ipv4Addr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?;
    match socket.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) if !ip.is_unspecified() && !ip.is_loopback() => Some(ip),
        _ => None,
    }
}

/// Every IPv4 interface that is up, except loopback and link-local (169.254.x.x) ones.
/// The primary interface comes first, then LAN interfaces, then the rest.
pub fn local_interfaces() -> Vec<LocalInterface> {
    let primary = primary_local_ip();
    let mut list: Vec<LocalInterface> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| {
            !matches!(
                i.oper_status,
                if_addrs::IfOperStatus::Down
                    | if_addrs::IfOperStatus::NotPresent
                    | if_addrs::IfOperStatus::LowerLayerDown
            )
        })
        .filter_map(|i| match &i.addr {
            if_addrs::IfAddr::V4(v4) if !v4.ip.is_loopback() && !v4.ip.is_link_local() => {
                Some(LocalInterface {
                    kind: classify(&i.name, i.is_p2p),
                    name: i.name.clone(),
                    ip: v4.ip,
                    prefix_len: v4.prefixlen,
                    primary: Some(v4.ip) == primary,
                    private: v4.ip.is_private(),
                })
            }
            _ => None,
        })
        .collect();
    list.sort_by_key(|i| (!i.primary, !i.kind.is_lan(), u32::from(i.ip)));
    list.dedup_by(|a, b| a.ip == b.ip);
    with_fallback(list, primary)
}

/// When the OS does not list interfaces (restricted platforms), the default-route address is
/// still known: treat it as a /24 LAN so the search keeps working instead of reporting no network.
fn with_fallback(list: Vec<LocalInterface>, primary: Option<Ipv4Addr>) -> Vec<LocalInterface> {
    match primary {
        Some(ip) if list.is_empty() => vec![LocalInterface {
            name: "default".into(),
            ip,
            prefix_len: 24,
            kind: InterfaceKind::Other,
            primary: true,
            private: ip.is_private(),
        }],
        _ => list,
    }
}

/// Addresses to sweep on one interface. Networks up to /22 (1022 hosts) are swept whole;
/// larger ones only around this device's own address (its /24), so a sweep never turns into
/// thousands of connections. Own address, network and broadcast addresses are skipped.
pub fn sweep_targets(iface: &LocalInterface) -> Vec<Ipv4Addr> {
    if !iface.scannable() {
        return vec![];
    }
    let prefix = if iface.prefix_len >= 22 {
        iface.prefix_len
    } else {
        24
    };
    let (network, broadcast) = network_bounds(iface.ip, prefix);
    let own = u32::from(iface.ip);
    (network + 1..broadcast)
        .filter(|v| *v != own)
        .map(Ipv4Addr::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn iface(ip: [u8; 4], prefix: u8, kind: InterfaceKind) -> LocalInterface {
        let ip = Ipv4Addr::from(ip);
        LocalInterface {
            name: "x".into(),
            ip,
            prefix_len: prefix,
            kind,
            primary: true,
            private: ip.is_private(),
        }
    }

    #[test]
    fn interface_names() {
        use InterfaceKind::*;
        for (name, kind) in [
            ("wlan0", Wifi),
            ("Wi-Fi", Wifi),
            ("Беспроводная сеть", Wifi),
            ("Подключение по локальной сети", Ethernet),
            ("wlp3s0", Wifi),
            ("eth0", Ethernet),
            ("enp0s31f6", Ethernet),
            ("Ethernet 2", Ethernet),
            ("vEthernet (WSL)", Virtual),
            ("VirtualBox Host-Only Network", Virtual),
            ("docker0", Virtual),
            ("br-1a2b3c", Virtual),
            ("tun0", Vpn),
            ("utun3", Vpn),
            ("Tailscale", Vpn),
            ("wg0", Vpn),
            ("rmnet_data0", Mobile),
            ("ccmni1", Mobile),
            ("swlan0", Hotspot),
            ("en0", Other),
        ] {
            assert_eq!(classify(name, false), kind, "{name}");
        }
        assert_eq!(classify("something", true), Vpn);
    }

    #[test]
    fn network_math() {
        let (n, b) = network_bounds(Ipv4Addr::new(192, 168, 1, 77), 24);
        assert_eq!(
            (Ipv4Addr::from(n), Ipv4Addr::from(b)),
            (
                Ipv4Addr::new(192, 168, 1, 0),
                Ipv4Addr::new(192, 168, 1, 255)
            )
        );
        let (n, b) = network_bounds(Ipv4Addr::new(10, 0, 5, 9), 22);
        assert_eq!(
            (Ipv4Addr::from(n), Ipv4Addr::from(b)),
            (Ipv4Addr::new(10, 0, 4, 0), Ipv4Addr::new(10, 0, 7, 255))
        );
        let i = iface([192, 168, 1, 77], 24, InterfaceKind::Wifi);
        assert!(i.contains(Ipv4Addr::new(192, 168, 1, 5)));
        assert!(!i.contains(Ipv4Addr::new(192, 168, 2, 5)));
    }

    #[test]
    fn sweep_targets_are_bounded_and_local() {
        let home = iface([192, 168, 1, 77], 24, InterfaceKind::Wifi);
        let t = sweep_targets(&home);
        assert_eq!(t.len(), 253);
        assert!(!t.contains(&Ipv4Addr::new(192, 168, 1, 77)));
        assert!(!t.contains(&Ipv4Addr::new(192, 168, 1, 0)));
        assert!(!t.contains(&Ipv4Addr::new(192, 168, 1, 255)));
        assert_eq!(
            sweep_targets(&iface([10, 0, 5, 9], 22, InterfaceKind::Ethernet)).len(),
            1021
        );
        // A /16 is not swept whole: only the device's own /24.
        let big = sweep_targets(&iface([172, 16, 9, 10], 16, InterfaceKind::Ethernet));
        assert_eq!(big.len(), 253);
        assert!(big.iter().all(|ip| ip.octets()[2] == 9));
        // Never public space, VPN, virtual or mobile networks.
        assert!(sweep_targets(&iface([84, 1, 2, 3], 24, InterfaceKind::Wifi)).is_empty());
        assert!(sweep_targets(&iface([10, 8, 0, 2], 24, InterfaceKind::Vpn)).is_empty());
        assert!(sweep_targets(&iface([172, 17, 0, 1], 16, InterfaceKind::Virtual)).is_empty());
        assert!(sweep_targets(&iface([10, 64, 1, 2], 24, InterfaceKind::Mobile)).is_empty());
        assert!(sweep_targets(&iface([192, 168, 1, 2], 32, InterfaceKind::Wifi)).is_empty());
    }

    #[test]
    fn default_route_fallback() {
        let ip = Ipv4Addr::new(192, 168, 0, 14);
        let list = with_fallback(vec![], Some(ip));
        assert_eq!(list.len(), 1);
        assert!(list[0].scannable());
        assert_eq!(sweep_targets(&list[0]).len(), 253);
        assert!(with_fallback(vec![], None).is_empty());
    }

    #[test]
    fn listing_interfaces_works_here() {
        // Whatever this machine has: no loopback, no link-local, primary first.
        let list = local_interfaces();
        assert!(list
            .iter()
            .all(|i| !i.ip.is_loopback() && !i.ip.is_link_local()));
        if let Some(pos) = list.iter().position(|i| i.primary) {
            assert_eq!(pos, 0);
        }
    }
}
