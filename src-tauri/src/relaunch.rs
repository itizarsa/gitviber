//! A new version installed over the running app (`brew upgrade`) opens in its place: the app
//! notices its bundle now holds another version, quits as ⌘Q does (saving its terminals, asking
//! while a command runs), and leaves a helper that opens the new one once this process is gone.
//! Homebrew can't do it itself: cask install steps run sandboxed, with no Apple Events or `open`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::AppHandle;

/// How often the bundle is looked at: cheap (one small file), and an upgrade takes longer anyway.
const EVERY: Duration = Duration::from_secs(5);

/// Set once the quit for a new version has begun: the exit then opens the new one.
static PENDING: AtomicBool = AtomicBool::new(false);

/// The running bundle's Info.plist, for an app run from a `.app` (not `tauri dev`).
fn info_plist() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let contents = exe.parent()?.parent()?;
    let bundle = contents.parent()?;
    (bundle.extension()? == "app").then(|| contents.join("Info.plist"))
}

/// CFBundleShortVersionString of an XML Info.plist, as Tauri writes it.
fn version_in(plist: &str) -> Option<&str> {
    let after = &plist[plist.find("<key>CFBundleShortVersionString</key>")?..];
    let start = after.find("<string>")? + "<string>".len();
    let len = after[start..].find("</string>")?;
    Some(after[start..start + len].trim()).filter(|v| !v.is_empty())
}

/// The version installed at `plist` now, when it's another than this one's. None while the file is
/// missing or half-written, as it is for a moment while the upgrade swaps the bundle.
fn installed_other(plist: &Path) -> Option<String> {
    let text = std::fs::read_to_string(plist).ok()?;
    let v = version_in(&text)?;
    (v != env!("CARGO_PKG_VERSION")).then(|| v.to_string())
}

/// Starts looking at the bundle. Once per new version: if the user keeps the app open (a command
/// runs and they stay), it isn't asked again until another version arrives.
pub fn watch(app: AppHandle) {
    let Some(plist) = info_plist() else {
        return;
    };
    std::thread::spawn(move || {
        let mut asked: Option<String> = None;
        loop {
            std::thread::sleep(EVERY);
            let Some(version) = installed_other(&plist) else {
                continue;
            };
            if asked.as_deref() == Some(&version) {
                continue;
            }
            // The new bundle settles: Homebrew moves it in whole, but give the move a moment.
            std::thread::sleep(Duration::from_secs(1));
            if installed_other(&plist).as_deref() != Some(&version) {
                continue;
            }
            asked = Some(version);
            PENDING.store(true, Ordering::SeqCst);
            crate::quit::request(&app);
        }
    });
}

/// The app is ending: if that's for a new version, a helper opens it once this process is gone.
/// A quit the user cancelled leaves nothing pending to act on (see `stayed`).
pub fn on_exit() {
    if !PENDING.load(Ordering::SeqCst) {
        return;
    }
    let pid = std::process::id().to_string();
    // Detached, it outlives this process; `open` before it's gone would only raise the dying app.
    let _ = std::process::Command::new("/bin/sh")
        .args([
            "-c",
            "i=0; while kill -0 \"$1\" 2>/dev/null && [ \"$i\" -lt 100 ]; do sleep 0.1; i=$((i+1)); done; \
             exec /usr/bin/open -b app.gitviber.desktop",
            "sh",
            &pid,
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

/// The user kept the app open: a later ordinary ⌘Q shouldn't reopen it.
pub fn stayed() {
    PENDING.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_version_is_read_from_tauris_plist() {
        let plist = "<?xml version=\"1.0\"?>\n<plist version=\"1.0\"><dict>\n\
            <key>CFBundleName</key>\n<string>GitViber</string>\n\
            <key>CFBundleShortVersionString</key>\n<string>0.3.3</string>\n\
            <key>CFBundleVersion</key>\n<string>0.3.3</string>\n</dict></plist>";
        assert_eq!(version_in(plist), Some("0.3.3"));
        assert_eq!(version_in("<plist><dict></dict></plist>"), None);
        assert_eq!(
            version_in("<key>CFBundleShortVersionString</key><string></string>"),
            None
        );
    }

    #[test]
    fn only_another_version_counts() {
        let dir = std::env::temp_dir().join(format!("gitviber-relaunch-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let plist = dir.join("Info.plist");
        assert_eq!(
            installed_other(&plist),
            None,
            "missing while the bundle is swapped"
        );
        let write = |v: &str| {
            std::fs::write(
                &plist,
                format!("<key>CFBundleShortVersionString</key><string>{v}</string>"),
            )
            .unwrap()
        };
        write(env!("CARGO_PKG_VERSION"));
        assert_eq!(installed_other(&plist), None);
        write("99.0.0");
        assert_eq!(installed_other(&plist).as_deref(), Some("99.0.0"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
