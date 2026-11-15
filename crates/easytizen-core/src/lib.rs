//! EasyTizen core library (crate name `easytizen-core`, kept for compatibility).
//!
//! Everything that touches user input, user files or child processes lives here so it
//! can be unit-tested without a UI. The Tauri layer is a thin adapter on top. No child
//! processes are ever started: TV communication, signing and certificate requests are all
//! implemented here.

pub mod cancel;
pub mod checks;
pub mod connectivity;
pub mod diagnostics;
pub mod discovery;
pub mod package;
pub mod samsung_ca;
pub mod sdb;
pub mod sign;
pub mod tizen_cert;
pub mod update;
pub mod validate;
