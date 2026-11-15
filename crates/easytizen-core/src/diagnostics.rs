//! Maps technical failures to stable, translatable diagnosis keys.
//! The UI turns each key into plain-language text and a list of things to check.

use crate::connectivity::Probe;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Diagnosis {
    /// This computer or phone has no usable local network (Wi-Fi off, only mobile data, cable
    /// unplugged).
    NoNetwork,
    /// Nothing answered at the TV's address.
    TvUnreachable,
    /// Nothing answered and the address is outside every local network of this device.
    OtherNetwork,
    /// The TV itself reports that Developer Mode is off (Samsung's own device API).
    DevModeOff,
    /// The TV reports Developer Mode on, but with a different Host PC IP than this device's.
    HostIpMismatch,
    /// TV answered but the SDB port is closed. Developer Mode is off or the Host PC IP is
    /// wrong; which one cannot be told without the TV's device API.
    PortClosed,
    /// The TV accepted the connection and closed it at once — what TVs do when the Host PC IP
    /// set in Developer Mode is another device's.
    ConnectionDropped,
    /// This device has no route to the address.
    NetworkUnreachable,
    /// The TV answered with something that is not a valid SDB conversation.
    ConnectionRejected,
    OperationTimedOut,
    Cancelled,
    /// The address answered like an Android (ADB) device, not a Samsung TV.
    NotATv,
    Unknown,
}

pub fn from_probe(p: Probe) -> Option<Diagnosis> {
    match p {
        Probe::Open => None,
        Probe::Refused => Some(Diagnosis::PortClosed),
        Probe::TimedOut => Some(Diagnosis::TvUnreachable),
        Probe::NetworkUnreachable => Some(Diagnosis::NetworkUnreachable),
        Probe::Other => Some(Diagnosis::TvUnreachable),
    }
}

/// Explains a failure of the SDB client.
pub fn from_sdb_error(e: &crate::sdb::SdbError) -> Diagnosis {
    use crate::sdb::SdbError::*;
    match e {
        Timeout => Diagnosis::OperationTimedOut,
        Refused => Diagnosis::PortClosed,
        Unreachable => Diagnosis::NetworkUnreachable,
        NotTizen => Diagnosis::NotATv,
        Cancelled => Diagnosis::Cancelled,
        Closed => Diagnosis::ConnectionDropped,
        Io(_) | Protocol(_) | ServiceRefused(_) | SyncFailed(_) => Diagnosis::ConnectionRejected,
    }
}

/// Removes lines that could carry a secret before text is shown, logged or exported.
pub fn redact(s: &str) -> String {
    s.lines()
        .map(|l| {
            let low = l.to_ascii_lowercase();
            if low.contains("password")
                || low.contains("passwd")
                || low.contains("token")
                || low.contains("secret")
                || low.contains("private key")
            {
                "[redacted line]".to_string()
            } else {
                l.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sdb::SdbError;

    #[test]
    fn probes() {
        assert_eq!(from_probe(Probe::Open), None);
        assert_eq!(from_probe(Probe::Refused), Some(Diagnosis::PortClosed));
        assert_eq!(from_probe(Probe::TimedOut), Some(Diagnosis::TvUnreachable));
        assert_eq!(
            from_probe(Probe::NetworkUnreachable),
            Some(Diagnosis::NetworkUnreachable)
        );
    }

    #[test]
    fn sdb_errors() {
        assert_eq!(
            from_sdb_error(&SdbError::Closed),
            Diagnosis::ConnectionDropped
        );
        assert_eq!(from_sdb_error(&SdbError::NotTizen), Diagnosis::NotATv);
        assert_eq!(from_sdb_error(&SdbError::Refused), Diagnosis::PortClosed);
        assert_eq!(
            from_sdb_error(&SdbError::Timeout),
            Diagnosis::OperationTimedOut
        );
    }

    #[test]
    fn redaction() {
        assert_eq!(redact("ok\nmy password is x"), "ok\n[redacted line]");
        assert_eq!(redact("access_token=abc"), "[redacted line]");
        assert_eq!(redact("plain"), "plain");
    }

    #[test]
    fn serialised_names_are_stable() {
        let names: Vec<String> = [
            Diagnosis::NoNetwork,
            Diagnosis::DevModeOff,
            Diagnosis::HostIpMismatch,
            Diagnosis::ConnectionDropped,
            Diagnosis::OtherNetwork,
        ]
        .iter()
        .map(|d| serde_json::to_string(d).unwrap())
        .collect();
        assert_eq!(
            names,
            [
                "\"no_network\"",
                "\"dev_mode_off\"",
                "\"host_ip_mismatch\"",
                "\"connection_dropped\"",
                "\"other_network\""
            ]
        );
    }
}
