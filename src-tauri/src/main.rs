// A GUI application on Windows: no console window is created at start-up. Errors are not
// lost — they go to the log file in the app data folder (see `applog.rs`). Debug builds keep
// the console for `cargo tauri dev`.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    easytizen_lib::run()
}
