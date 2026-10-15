fn main() {
    // git and ssh run this binary to ask for a password (askpass.rs); that never opens the app.
    if let Some(code) = gitviber_lib::askpass::helper() {
        std::process::exit(code);
    }
    // `tauri dev`: on as an app bundle, which macOS gives notifications (dev_bundle.rs).
    #[cfg(debug_assertions)]
    gitviber_lib::dev_bundle::relaunch();
    gitviber_lib::run()
}
