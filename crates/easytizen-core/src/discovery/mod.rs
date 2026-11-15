//! Finding Samsung TVs on the local network and explaining why one cannot be used.
//!
//! Discovery combines three independent methods, all limited to the user's own LAN:
//!
//! 1. **TCP sweep** of every LAN interface's network (up to /22, otherwise the device's own
//!    /24) for the SDB port (26101, open only with Developer Mode on) and Samsung's device API
//!    (8001, open on every Samsung Smart TV since 2016) — the reference installer's method,
//!    extended to all interfaces and to TVs whose Developer Mode is still off;
//! 2. **SSDP** M-SEARCH for Samsung's TV services, which also reaches TVs outside the swept
//!    range on a larger network;
//! 3. **saved TVs**, re-checked at their last known address.
//!
//! Every candidate is then verified: a real SDB handshake (so unrelated services on the same
//! port are never listed) and the device API (name, model, Developer Mode, Host PC IP).

pub mod netif;
pub mod samsung_api;
pub mod ssdp;

use crate::cancel::CancelToken;
use crate::connectivity::{local_ip_towards, probe_tcp, Probe, MIN_DIAGNOSTIC_TIMEOUT};
use crate::diagnostics::{self, Diagnosis};
use crate::sdb::{self, SdbError, SdbInfo, TvIdentity};
use netif::LocalInterface;
use samsung_api::SamsungTvInfo;
use serde::Serialize;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

/// What a found TV is ready for.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TvStatus {
    /// SDB answered: the TV accepts this device. Installation can start.
    Ready,
    /// The TV reports Developer Mode off.
    DevModeOff,
    /// Developer Mode is on, but for another Host PC IP.
    HostIpMismatch,
    /// SDB accepted and immediately dropped the connection (usually the Host PC IP).
    SdbRejected,
    /// A Samsung TV, but its SDB service does not answer (Developer Mode state unknown).
    SdbUnavailable,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    NetworkScan,
    Ssdp,
    Saved,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FoundTv {
    pub ip: String,
    pub port: u16,
    pub name: Option<String>,
    pub model: Option<String>,
    pub tizen_version: Option<String>,
    pub status: TvStatus,
    pub developer_mode: Option<bool>,
    pub developer_ip: Option<String>,
    /// This device's address towards the TV — the value for "Host PC IP".
    pub host_ip: Option<String>,
    pub sources: Vec<Source>,
}

pub struct DiscoverOptions {
    pub sdb_port: u16,
    pub api_port: u16,
    /// Per-connection timeout of the sweep.
    pub connect_timeout: Duration,
    /// Saved TVs: checked even when they are outside the swept networks.
    pub saved_hosts: Vec<Ipv4Addr>,
    pub ssdp: bool,
    pub ssdp_wait: Duration,
    /// Sweep exactly these hosts instead of the local networks (restricted scan, tests).
    pub only_hosts: Option<Vec<Ipv4Addr>>,
}

impl Default for DiscoverOptions {
    fn default() -> Self {
        Self {
            sdb_port: crate::validate::DEFAULT_SDB_PORT,
            api_port: samsung_api::SAMSUNG_API_PORT,
            connect_timeout: Duration::from_millis(800),
            saved_hosts: vec![],
            ssdp: true,
            ssdp_wait: Duration::from_millis(2500),
            only_hosts: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DiscoveryReport {
    pub devices: Vec<FoundTv>,
    /// Every IPv4 interface of this device, scanned or not (shown in diagnostics).
    pub interfaces: Vec<LocalInterface>,
    /// Networks that were swept, e.g. `192.168.1.0/24`.
    pub networks: Vec<String>,
    pub swept_hosts: usize,
    pub cancelled: bool,
}

/// Classifies one verified candidate. `None`: not a Samsung TV (or not one we can tell).
pub fn classify(
    sdb: &Result<SdbInfo, SdbError>,
    api: Option<&SamsungTvInfo>,
    host_ip: Option<Ipv4Addr>,
    ssdp_tv: bool,
) -> Option<TvStatus> {
    match (sdb, api) {
        (Ok(_), _) => Some(TvStatus::Ready),
        // An Android phone or box with ADB over Wi-Fi.
        (Err(SdbError::NotTizen), _) => None,
        (Err(e), Some(info)) => Some(match (info.developer_mode, info.developer_ip, host_ip) {
            (Some(false), _, _) => TvStatus::DevModeOff,
            (Some(true), Some(dev), Some(host)) if dev != host => TvStatus::HostIpMismatch,
            _ if *e == SdbError::Closed => TvStatus::SdbRejected,
            _ => TvStatus::SdbUnavailable,
        }),
        // Port 26101 accepted and dropped us: a TV that does not accept this device.
        (Err(SdbError::Closed), None) => Some(TvStatus::SdbRejected),
        (Err(_), None) if ssdp_tv => Some(TvStatus::SdbUnavailable),
        (Err(_), None) => None,
    }
}

fn probe_sdb_with_retry(
    ip: Ipv4Addr,
    port: u16,
    timeout: Duration,
    cancel: &CancelToken,
) -> Result<SdbInfo, SdbError> {
    match sdb::probe_sdb(ip, port, timeout, cancel) {
        Err(SdbError::Timeout) | Err(SdbError::Io(_)) if !cancel.is_cancelled() => {
            sdb::probe_sdb(ip, port, timeout, cancel)
        }
        other => other,
    }
}

/// Verifies one address: SDB handshake and device API in parallel.
fn verify(
    ip: Ipv4Addr,
    opts: &DiscoverOptions,
    ssdp_tv: bool,
    cancel: &CancelToken,
) -> Option<FoundTv> {
    let (sdb, api) = std::thread::scope(|s| {
        let api = s.spawn(|| {
            samsung_api::fetch_with_retry(ip, opts.api_port, Duration::from_millis(2500), cancel)
                .ok()
        });
        let sdb = probe_sdb_with_retry(ip, opts.sdb_port, Duration::from_secs(3), cancel);
        (sdb, api.join().ok().flatten())
    });
    if cancel.is_cancelled() {
        return None;
    }
    let host_ip = local_ip_towards(ip);
    let status = classify(&sdb, api.as_ref(), host_ip, ssdp_tv)?;
    let sdb_info = sdb.ok();
    Some(FoundTv {
        ip: ip.to_string(),
        port: opts.sdb_port,
        name: api.as_ref().and_then(|a| a.name.clone()),
        model: api
            .as_ref()
            .and_then(|a| a.model_name.clone())
            .or_else(|| sdb_info.as_ref().and_then(|s| s.model.clone())),
        tizen_version: sdb_info.as_ref().and_then(|s| s.tizen_version.clone()),
        status,
        developer_mode: api.as_ref().and_then(|a| a.developer_mode),
        developer_ip: api
            .as_ref()
            .and_then(|a| a.developer_ip)
            .map(|ip| ip.to_string()),
        host_ip: host_ip.map(|ip| ip.to_string()),
        sources: vec![],
    })
}

/// Finds TVs. `on_progress` gets the swept fraction (0–1); `on_found` every verified TV as
/// soon as it is known (from worker threads). Never blocks longer than the sweep plus a few
/// seconds of verification, and stops promptly on `cancel`.
pub fn discover(
    opts: &DiscoverOptions,
    cancel: &CancelToken,
    on_progress: &(dyn Fn(f32) + Sync),
    on_found: &(dyn Fn(&FoundTv) + Sync),
) -> DiscoveryReport {
    let interfaces = netif::local_interfaces();
    let mut networks = Vec::new();
    let mut targets: BTreeSet<u32> = BTreeSet::new();
    match &opts.only_hosts {
        Some(hosts) => targets.extend(hosts.iter().map(|ip| u32::from(*ip))),
        None => {
            for iface in interfaces.iter().filter(|i| i.scannable()) {
                let hosts = netif::sweep_targets(iface);
                if let (Some(first), Some(_)) = (hosts.first(), hosts.last()) {
                    let prefix = if iface.prefix_len >= 22 {
                        iface.prefix_len
                    } else {
                        24
                    };
                    let (network, _) = netif::network_bounds(*first, prefix);
                    networks.push(format!("{}/{prefix}", Ipv4Addr::from(network)));
                }
                targets.extend(hosts.iter().map(|ip| u32::from(*ip)));
            }
        }
    }
    let saved: HashSet<Ipv4Addr> = opts.saved_hosts.iter().copied().collect();
    targets.extend(saved.iter().map(|ip| u32::from(*ip)));
    networks.dedup();
    let hosts: Vec<Ipv4Addr> = targets.into_iter().map(Ipv4Addr::from).collect();
    let items: Vec<(Ipv4Addr, u16)> = hosts
        .iter()
        .flat_map(|ip| [(*ip, opts.sdb_port), (*ip, opts.api_port)])
        .collect();
    let ssdp_ifaces: Vec<Ipv4Addr> = if opts.ssdp && opts.only_hosts.is_none() {
        interfaces
            .iter()
            .filter(|i| i.scannable())
            .map(|i| i.ip)
            .collect()
    } else {
        vec![]
    };

    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    // Highest count already reported. Workers finish in any order, so reports go through this
    // lock and never step backwards (the counter alone does not order the callbacks).
    let reported = Mutex::new(0usize);
    let seen: Mutex<HashSet<Ipv4Addr>> = Mutex::new(HashSet::new());
    let ssdp_tvs: Mutex<HashSet<Ipv4Addr>> = Mutex::new(HashSet::new());
    let found: Mutex<HashMap<Ipv4Addr, FoundTv>> = Mutex::new(HashMap::new());
    let sources: Mutex<HashMap<Ipv4Addr, BTreeSet<Source>>> = Mutex::new(HashMap::new());
    let add_source = |ip: Ipv4Addr, source: Source| {
        sources
            .lock()
            .unwrap()
            .entry(ip)
            .or_default()
            .insert(source);
    };

    let (tx, rx) = mpsc::channel::<Ipv4Addr>();
    let rx = Mutex::new(rx);
    std::thread::scope(|scope| {
        let rx = &rx;
        // Verifiers: confirm candidates while the sweep continues.
        for _ in 0..8 {
            let (found, sources, saved, ssdp_tvs, add_source) =
                (&found, &sources, &saved, &ssdp_tvs, &add_source);
            scope.spawn(move || loop {
                let ip = match rx.lock().unwrap().recv() {
                    Ok(ip) => ip,
                    Err(_) => break,
                };
                if cancel.is_cancelled() {
                    continue;
                }
                let ssdp_tv = ssdp_tvs.lock().unwrap().contains(&ip);
                if let Some(mut tv) = verify(ip, opts, ssdp_tv, cancel) {
                    if saved.contains(&ip) {
                        add_source(ip, Source::Saved);
                    }
                    tv.sources = sources
                        .lock()
                        .unwrap()
                        .get(&ip)
                        .map(|s| s.iter().copied().collect())
                        .unwrap_or_default();
                    on_found(&tv);
                    found.lock().unwrap().insert(ip, tv);
                }
            });
        }
        if !ssdp_ifaces.is_empty() {
            let tx = tx.clone();
            let (seen, ssdp_tvs, add_source) = (&seen, &ssdp_tvs, &add_source);
            let ifaces = &ssdp_ifaces;
            scope.spawn(move || {
                ssdp::search(ifaces, opts.ssdp_wait, cancel, &mut |hit| {
                    if !hit.samsung_tv {
                        return;
                    }
                    ssdp_tvs.lock().unwrap().insert(hit.ip);
                    add_source(hit.ip, Source::Ssdp);
                    if seen.lock().unwrap().insert(hit.ip) {
                        let _ = tx.send(hit.ip);
                    }
                });
            });
        }
        let workers = items.len().clamp(1, 128);
        for _ in 0..workers {
            let tx = tx.clone();
            let (items, next, done, reported, seen, add_source) =
                (&items, &next, &done, &reported, &seen, &add_source);
            scope.spawn(move || loop {
                let index = next.fetch_add(1, Ordering::SeqCst);
                if index >= items.len() || cancel.is_cancelled() {
                    break;
                }
                let (ip, port) = items[index];
                if TcpStream::connect_timeout(&SocketAddr::from((ip, port)), opts.connect_timeout)
                    .is_ok()
                {
                    add_source(ip, Source::NetworkScan);
                    if seen.lock().unwrap().insert(ip) {
                        let _ = tx.send(ip);
                    }
                }
                let finished = done.fetch_add(1, Ordering::SeqCst) + 1;
                let mut last = reported.lock().unwrap();
                if finished > *last {
                    *last = finished;
                    on_progress(0.9 * finished as f32 / items.len() as f32);
                }
            });
        }
        drop(tx);
    });
    on_progress(1.0);

    let mut devices: Vec<FoundTv> = found.into_inner().unwrap().into_values().collect();
    devices.sort_by_key(|d| d.ip.parse::<Ipv4Addr>().map(u32::from).unwrap_or(0));
    DiscoveryReport {
        devices,
        interfaces,
        networks,
        swept_hosts: hosts.len(),
        cancelled: cancel.is_cancelled(),
    }
}

// ---------- connection check (manual IP, saved or found TV) ----------

#[derive(Debug, Clone, Serialize)]
pub struct TvCheck {
    pub ip: String,
    pub port: u16,
    /// This device's address towards the TV: what "Host PC IP" must be on the TV.
    pub host_ip: Option<String>,
    /// The local interface that address belongs to.
    pub interface: Option<String>,
    /// The TV's address is inside one of this device's LAN networks. `None`: no LAN at all.
    pub same_network: Option<bool>,
    /// Something answered at the address (device API, or SDB open/refused).
    pub reachable: bool,
    /// Samsung's device API answer, when the TV gave one.
    pub samsung: Option<SamsungTvInfo>,
    pub sdb_port: Probe,
    /// SDB handshake succeeded: the TV accepts this device.
    pub sdb_ok: bool,
    pub sdb: Option<SdbInfo>,
    /// DUID, model and Tizen version, when requested and readable.
    pub identity: Option<TvIdentity>,
    /// The TV's Host PC IP equals this device's address. `None`: unknown.
    pub host_ip_matches: Option<bool>,
    pub diagnosis: Option<Diagnosis>,
    pub technical: Option<String>,
}

pub struct CheckOptions {
    pub sdb_port: u16,
    pub api_port: u16,
    pub timeout: Duration,
    /// Also read the DUID (a full connection).
    pub read_identity: bool,
}

impl Default for CheckOptions {
    fn default() -> Self {
        Self {
            sdb_port: crate::validate::DEFAULT_SDB_PORT,
            api_port: samsung_api::SAMSUNG_API_PORT,
            timeout: MIN_DIAGNOSTIC_TIMEOUT,
            read_identity: true,
        }
    }
}

/// Everything that decides whether this device can install on the TV at `ip`, checked
/// independently so a failure can be explained precisely.
pub fn check_connection(ip: Ipv4Addr, opts: &CheckOptions, cancel: &CancelToken) -> TvCheck {
    let interfaces = netif::local_interfaces();
    let host_ip = local_ip_towards(ip).filter(|h| !h.is_loopback() || ip.is_loopback());
    let interface = host_ip.and_then(|h| {
        interfaces
            .iter()
            .find(|i| i.ip == h)
            .map(|i| i.name.clone())
    });
    let lan: Vec<&LocalInterface> = interfaces.iter().filter(|i| i.kind.is_lan()).collect();
    let same_network = (!lan.is_empty()).then(|| lan.iter().any(|i| i.contains(ip)));
    let probe_timeout = opts.timeout.max(MIN_DIAGNOSTIC_TIMEOUT);

    let (api, probe) = std::thread::scope(|s| {
        let api = s.spawn(|| {
            samsung_api::fetch_with_retry(ip, opts.api_port, Duration::from_millis(2500), cancel)
                .ok()
        });
        let probe = probe_tcp(ip, opts.sdb_port, probe_timeout);
        (api.join().ok().flatten(), probe)
    });

    let mut check = TvCheck {
        ip: ip.to_string(),
        port: opts.sdb_port,
        host_ip: host_ip.map(|h| h.to_string()),
        interface,
        same_network,
        reachable: api.is_some() || matches!(probe, Probe::Open | Probe::Refused),
        host_ip_matches: match (api.as_ref().and_then(|a| a.developer_ip), host_ip) {
            (Some(dev), Some(host)) => Some(dev == host),
            _ => None,
        },
        samsung: api,
        sdb_port: probe,
        sdb_ok: false,
        sdb: None,
        identity: None,
        diagnosis: None,
        technical: None,
    };
    if cancel.is_cancelled() {
        check.diagnosis = Some(Diagnosis::Cancelled);
        return check;
    }

    let mut sdb_error = None;
    if probe == Probe::Open {
        let attempt = || -> Result<(SdbInfo, Option<TvIdentity>), SdbError> {
            if opts.read_identity {
                let id = sdb::query_tv(ip, opts.sdb_port, opts.timeout, cancel)?;
                let info = SdbInfo {
                    model: id.model.clone(),
                    tizen_version: id.platform_version.clone(),
                    secure_protocol: id.secure_protocol,
                    capability_known: true,
                };
                Ok((info, Some(id)))
            } else {
                Ok((
                    sdb::probe_sdb(ip, opts.sdb_port, opts.timeout, cancel)?,
                    None,
                ))
            }
        };
        let result = match attempt() {
            Err(SdbError::Timeout) | Err(SdbError::Io(_)) if !cancel.is_cancelled() => attempt(),
            other => other,
        };
        match result {
            Ok((info, identity)) => {
                check.sdb_ok = true;
                check.sdb = Some(info);
                check.identity = identity;
            }
            Err(e) => {
                check.technical = Some(e.to_string());
                sdb_error = Some(e);
            }
        }
    }
    check.diagnosis = diagnose(
        &check,
        sdb_error.as_ref(),
        !interfaces.iter().any(|i| i.kind.is_lan()),
    );
    check
}

/// The single most useful explanation for a failed check (`None` when the TV is ready).
pub fn diagnose(check: &TvCheck, sdb_error: Option<&SdbError>, no_lan: bool) -> Option<Diagnosis> {
    if check.sdb_ok {
        return None;
    }
    if sdb_error == Some(&SdbError::Cancelled) {
        return Some(Diagnosis::Cancelled);
    }
    if let Some(info) = &check.samsung {
        if info.developer_mode == Some(false) {
            return Some(Diagnosis::DevModeOff);
        }
        if check.host_ip_matches == Some(false) {
            return Some(Diagnosis::HostIpMismatch);
        }
    }
    if let Some(e) = sdb_error {
        return Some(diagnostics::from_sdb_error(e));
    }
    Some(match check.sdb_port {
        Probe::Open => Diagnosis::Unknown,
        Probe::Refused => Diagnosis::PortClosed,
        // The TV answers its device API but the SDB port is filtered: SDB is not active.
        _ if check.samsung.is_some() => Diagnosis::PortClosed,
        _ if no_lan => Diagnosis::NoNetwork,
        Probe::NetworkUnreachable if check.same_network == Some(false) => Diagnosis::OtherNetwork,
        Probe::NetworkUnreachable => Diagnosis::NetworkUnreachable,
        _ if check.same_network == Some(false) => Diagnosis::OtherNetwork,
        _ => Diagnosis::TvUnreachable,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sdb::mock::{MockFaults, MockTv};

    fn api(mode: Option<bool>, ip: Option<[u8; 4]>) -> SamsungTvInfo {
        SamsungTvInfo {
            name: Some("TV".into()),
            developer_mode: mode,
            developer_ip: ip.map(Ipv4Addr::from),
            ..Default::default()
        }
    }

    #[test]
    fn classification() {
        let host = Some(Ipv4Addr::new(192, 168, 1, 20));
        let ok: Result<SdbInfo, SdbError> = Ok(SdbInfo::default());
        assert_eq!(classify(&ok, None, host, false), Some(TvStatus::Ready));
        let refused = Err(SdbError::Refused);
        assert_eq!(
            classify(&refused, Some(&api(Some(false), None)), host, false),
            Some(TvStatus::DevModeOff)
        );
        assert_eq!(
            classify(
                &refused,
                Some(&api(Some(true), Some([192, 168, 1, 99]))),
                host,
                false
            ),
            Some(TvStatus::HostIpMismatch)
        );
        assert_eq!(
            classify(
                &refused,
                Some(&api(Some(true), Some([192, 168, 1, 20]))),
                host,
                false
            ),
            Some(TvStatus::SdbUnavailable)
        );
        assert_eq!(
            classify(&Err(SdbError::Closed), Some(&api(None, None)), host, false),
            Some(TvStatus::SdbRejected)
        );
        assert_eq!(
            classify(&Err(SdbError::Closed), None, host, false),
            Some(TvStatus::SdbRejected)
        );
        // Something else on the network: not listed.
        assert_eq!(classify(&refused, None, host, false), None);
        assert_eq!(
            classify(
                &Err(SdbError::NotTizen),
                Some(&api(None, None)),
                host,
                false
            ),
            None
        );
        assert_eq!(
            classify(&refused, None, host, true),
            Some(TvStatus::SdbUnavailable)
        );
    }

    fn opts(sdb_port: u16, api_port: u16, hosts: Vec<Ipv4Addr>) -> DiscoverOptions {
        DiscoverOptions {
            sdb_port,
            api_port,
            connect_timeout: Duration::from_millis(300),
            ssdp: false,
            only_hosts: Some(hosts),
            ..Default::default()
        }
    }

    #[test]
    fn discovery_finds_a_ready_tv_and_reports_progress() {
        let tv = MockTv::start(Ipv4Addr::LOCALHOST, 0, "DUID12345678").unwrap();
        let api_port =
            samsung_api::mock::serve(Ipv4Addr::LOCALHOST, 0, "Kitchen", true, "127.0.0.1").unwrap();
        let progress = Mutex::new(Vec::new());
        let streamed = Mutex::new(Vec::new());
        let report = discover(
            &opts(tv.port, api_port, vec![Ipv4Addr::LOCALHOST]),
            &CancelToken::new(),
            &|f| progress.lock().unwrap().push(f),
            &|d| streamed.lock().unwrap().push(d.ip.clone()),
        );
        assert_eq!(report.devices.len(), 1);
        let d = &report.devices[0];
        assert_eq!(d.status, TvStatus::Ready);
        assert_eq!(d.name.as_deref(), Some("Kitchen"));
        assert_eq!(d.model.as_deref(), Some("UE55TU7100UXRU"));
        assert_eq!(d.tizen_version.as_deref(), Some("8.0"));
        assert_eq!(d.developer_mode, Some(true));
        assert_eq!(d.sources, [Source::NetworkScan]);
        assert_eq!(*streamed.lock().unwrap(), ["127.0.0.1"]);
        let p = progress.lock().unwrap();
        assert_eq!(p.last().copied(), Some(1.0));
        assert!(p.windows(2).all(|w| w[0] <= w[1]));
        // Nothing is ever started on the TV during a search.
        assert!(tv.state.lock().unwrap().shell_commands.is_empty());
    }

    #[test]
    fn discovery_lists_a_tv_with_developer_mode_off() {
        // Only the device API answers; the SDB port is closed.
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let sdb_port = closed.local_addr().unwrap().port();
        drop(closed);
        let api_port =
            samsung_api::mock::serve(Ipv4Addr::LOCALHOST, 0, "Bedroom", false, "0.0.0.0").unwrap();
        let report = discover(
            &opts(sdb_port, api_port, vec![Ipv4Addr::LOCALHOST]),
            &CancelToken::new(),
            &|_| {},
            &|_| {},
        );
        assert_eq!(report.devices.len(), 1);
        assert_eq!(report.devices[0].status, TvStatus::DevModeOff);
        assert_eq!(report.devices[0].developer_mode, Some(false));
    }

    #[test]
    fn discovery_ignores_unrelated_services_and_deduplicates() {
        // A plain TCP service on the SDB port that is not SDB.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for s in listener.incoming().flatten() {
                std::thread::sleep(Duration::from_millis(50));
                drop(s);
            }
        });
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let api_port = closed.local_addr().unwrap().port();
        drop(closed);
        let tv = MockTv::start(Ipv4Addr::LOCALHOST, 0, "DUID12345678").unwrap();
        let mut o = opts(
            tv.port,
            api_port,
            vec![Ipv4Addr::LOCALHOST, Ipv4Addr::LOCALHOST],
        );
        o.saved_hosts = vec![Ipv4Addr::LOCALHOST];
        let report = discover(&o, &CancelToken::new(), &|_| {}, &|_| {});
        assert_eq!(report.devices.len(), 1, "one TV, listed once");
        assert_eq!(
            report.devices[0].sources,
            [Source::NetworkScan, Source::Saved]
        );
        // Same sweep on the unrelated service's port: a dropped connection without a device
        // API is listed only as a TV that rejects us — never as ready.
        let report = discover(
            &opts(port, api_port, vec![Ipv4Addr::LOCALHOST]),
            &CancelToken::new(),
            &|_| {},
            &|_| {},
        );
        assert!(report.devices.iter().all(|d| d.status != TvStatus::Ready));
    }

    #[test]
    fn cancelled_discovery_returns_quickly() {
        let cancel = CancelToken::new();
        cancel.cancel();
        let start = std::time::Instant::now();
        let hosts: Vec<Ipv4Addr> = (1..=254).map(|i| Ipv4Addr::new(10, 255, 255, i)).collect();
        let report = discover(&opts(26101, 8001, hosts), &cancel, &|_| {}, &|_| {});
        assert!(report.cancelled);
        assert!(report.devices.is_empty());
        assert!(start.elapsed() < Duration::from_secs(3));
    }

    fn check_opts(sdb_port: u16, api_port: u16) -> CheckOptions {
        CheckOptions {
            sdb_port,
            api_port,
            timeout: Duration::from_secs(3),
            read_identity: true,
        }
    }

    #[test]
    fn check_ready_tv_reads_identity() {
        let tv = MockTv::start(Ipv4Addr::LOCALHOST, 0, "DUID12345678").unwrap();
        let api_port =
            samsung_api::mock::serve(Ipv4Addr::LOCALHOST, 0, "Hall", true, "127.0.0.1").unwrap();
        let c = check_connection(
            Ipv4Addr::LOCALHOST,
            &check_opts(tv.port, api_port),
            &CancelToken::new(),
        );
        assert!(c.sdb_ok && c.reachable);
        assert_eq!(c.diagnosis, None);
        assert_eq!(c.identity.unwrap().duid.as_deref(), Some("DUID12345678"));
        assert_eq!(c.host_ip_matches, Some(true));
        assert_eq!(c.samsung.unwrap().name.as_deref(), Some("Hall"));
    }

    #[test]
    fn check_explains_developer_mode_off() {
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let sdb_port = closed.local_addr().unwrap().port();
        drop(closed);
        let api_port =
            samsung_api::mock::serve(Ipv4Addr::LOCALHOST, 0, "Hall", false, "0.0.0.0").unwrap();
        let c = check_connection(
            Ipv4Addr::LOCALHOST,
            &check_opts(sdb_port, api_port),
            &CancelToken::new(),
        );
        assert_eq!(c.sdb_port, Probe::Refused);
        assert_eq!(c.diagnosis, Some(Diagnosis::DevModeOff));
    }

    #[test]
    fn check_explains_a_wrong_host_pc_ip() {
        let tv = MockTv::start_with(
            Ipv4Addr::LOCALHOST,
            0,
            "DUID12345678",
            MockFaults {
                close_on_connect: true,
                ..Default::default()
            },
        )
        .unwrap();
        let api_port =
            samsung_api::mock::serve(Ipv4Addr::LOCALHOST, 0, "Hall", true, "192.168.77.5").unwrap();
        let c = check_connection(
            Ipv4Addr::LOCALHOST,
            &check_opts(tv.port, api_port),
            &CancelToken::new(),
        );
        assert_eq!(c.host_ip_matches, Some(false));
        assert_eq!(c.diagnosis, Some(Diagnosis::HostIpMismatch));
        // Without the device API the dropped connection is still explained.
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let no_api = closed.local_addr().unwrap().port();
        drop(closed);
        let c = check_connection(
            Ipv4Addr::LOCALHOST,
            &check_opts(tv.port, no_api),
            &CancelToken::new(),
        );
        assert_eq!(c.diagnosis, Some(Diagnosis::ConnectionDropped));
    }

    #[test]
    fn check_port_closed_without_device_api() {
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = closed.local_addr().unwrap().port();
        drop(closed);
        let c = check_connection(
            Ipv4Addr::LOCALHOST,
            &check_opts(port, port),
            &CancelToken::new(),
        );
        assert!(c.reachable);
        assert_eq!(c.diagnosis, Some(Diagnosis::PortClosed));
    }

    #[test]
    fn diagnose_unreachable_cases() {
        let base = TvCheck {
            ip: "192.168.5.9".into(),
            port: 26101,
            host_ip: Some("192.168.1.20".into()),
            interface: None,
            same_network: Some(true),
            reachable: false,
            samsung: None,
            sdb_port: Probe::TimedOut,
            sdb_ok: false,
            sdb: None,
            identity: None,
            host_ip_matches: None,
            diagnosis: None,
            technical: None,
        };
        assert_eq!(diagnose(&base, None, false), Some(Diagnosis::TvUnreachable));
        let other = TvCheck {
            same_network: Some(false),
            ..base.clone()
        };
        assert_eq!(diagnose(&other, None, false), Some(Diagnosis::OtherNetwork));
        assert_eq!(diagnose(&base, None, true), Some(Diagnosis::NoNetwork));
        let filtered = TvCheck {
            samsung: Some(api(None, None)),
            ..base.clone()
        };
        assert_eq!(
            diagnose(&filtered, None, false),
            Some(Diagnosis::PortClosed)
        );
        let ok = TvCheck {
            sdb_ok: true,
            ..base
        };
        assert_eq!(diagnose(&ok, None, false), None);
    }
}
