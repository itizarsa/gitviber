//! The environment the user's login shell builds. An app launched from Finder gets launchd's
//! bare PATH, so hooks that call node, npx or pnpm (from nvm, fnm, Volta, mise, …) failed
//! with exit 127 while the same commit worked in a terminal.

use std::ffi::OsString;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Condvar, Mutex, MutexGuard};
use std::time::Duration;

/// Where the terminal and the shell probe start: the environment launchd gives any app, not
/// ours. Run from `pnpm tauri dev` we carry npm_config_prefix, which makes nvm refuse to load.
pub fn clean_env() -> Vec<(OsString, OsString)> {
    let mut env: Vec<(OsString, OsString)> = KEEP
        .iter()
        .filter_map(|k| std::env::var_os(k).map(|v| (k.into(), v)))
        .collect();
    env.push(("PATH".into(), "/usr/bin:/bin:/usr/sbin:/sbin".into()));
    env
}

const KEEP: &[&str] = &[
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "SSH_AUTH_SOCK",
    "LANG",
    "LC_ALL",
];

/// Shells that print a banner or run a slow plugin manager still answer well within this.
const TIMEOUT: Duration = Duration::from_secs(3);
/// The background retry has nobody waiting on it, so it may take longer (a busy login).
const RETRY_AFTER: Duration = Duration::from_secs(20);
const RETRY_TIMEOUT: Duration = Duration::from_secs(10);

struct Probe {
    /// The last PATH a probe read; a failed probe later keeps it.
    path: Option<OsString>,
    running: bool,
    /// The first probe has finished, well or not.
    answered: bool,
}

static PROBE: Mutex<Probe> = Mutex::new(Probe {
    path: None,
    running: false,
    answered: false,
});
static FINISHED: Condvar = Condvar::new();
/// Bumped whenever `path` changes, so process.rs can cache its merged PATH until then.
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn probe() -> MutexGuard<'static, Probe> {
    PROBE.lock().unwrap_or_else(|e| e.into_inner())
}

/// PATH from the login shell, once one has answered.
pub fn login_path() -> Option<OsString> {
    probe().path.clone()
}

pub fn generation() -> u64 {
    GENERATION.load(Ordering::Acquire)
}

/// Asks the login shell for its PATH on a thread of its own, so the window never waits.
/// Commands that run before it answers use the fallback PATH. A failed probe (a slow
/// login, say) is tried once more a little later.
pub fn resolve_in_background() {
    std::thread::spawn(|| {
        if run(TIMEOUT).is_err() {
            std::thread::sleep(RETRY_AFTER);
            let _ = run(RETRY_TIMEOUT);
        }
    });
}

/// Probes again now (or joins a probe already running), for "Check again" after the user
/// installed something into a folder only the shell's PATH has.
pub fn reprobe() {
    let _ = run(TIMEOUT);
}

/// Waits for the first probe to finish, for a caller that found nothing on the fallback PATH.
pub fn wait_for_first_answer() {
    let wait = TIMEOUT + Duration::from_secs(1);
    drop(FINISHED.wait_timeout_while(probe(), wait, |p| !p.answered));
}

fn run(timeout: Duration) -> Result<(), String> {
    {
        let p = probe();
        if p.running {
            drop(FINISHED.wait_while(p, |p| p.running));
            return Ok(());
        }
        let mut p = p;
        p.running = true;
    }
    let found = probe_path(Path::new(&login_shell()), timeout);
    record(&found);
    found.map(|_| ())
}

/// $SHELL, else the one passwd(5) records for the user, else /bin/sh: many Linux systems have
/// no zsh. The terminal's pty is given the same one, so a `chsh` reaches both at once.
pub fn login_shell() -> OsString {
    std::env::var_os("SHELL")
        .filter(|s| runnable(Path::new(s)))
        .or_else(|| passwd_shell().filter(|s| runnable(Path::new(s))))
        .unwrap_or_else(|| "/bin/sh".into())
}

fn runnable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

fn passwd_shell() -> Option<OsString> {
    use std::os::unix::ffi::OsStrExt;
    let mut buf = vec![0 as libc::c_char; 4096];
    let mut pwd: libc::passwd = unsafe { std::mem::zeroed() };
    let mut found: *mut libc::passwd = std::ptr::null_mut();
    // The _r form: getpwuid's static buffer isn't safe beside other threads.
    let rc = unsafe {
        libc::getpwuid_r(
            libc::getuid(),
            &mut pwd,
            buf.as_mut_ptr(),
            buf.len(),
            &mut found,
        )
    };
    if rc != 0 || found.is_null() || pwd.pw_shell.is_null() {
        return None;
    }
    let shell = unsafe { std::ffi::CStr::from_ptr(pwd.pw_shell) }.to_bytes();
    // An empty field means /bin/sh, which the caller falls back to.
    (!shell.is_empty()).then(|| std::ffi::OsStr::from_bytes(shell).to_os_string())
}

fn record(found: &Result<OsString, String>) {
    let mut p = probe();
    p.running = false;
    p.answered = true;
    match found {
        Ok(path) if p.path.as_ref() != Some(path) => {
            p.path = Some(path.clone());
            GENERATION.fetch_add(1, Ordering::Release);
        }
        Ok(_) => {}
        Err(e) => eprintln!("login shell PATH: {e}; keeping the PATH we had"),
    }
    FINISHED.notify_all();
}

/// Runs `shell -ilc` (interactive and login, so both .zprofile and .zshrc run, as in a
/// terminal) and reads PATH printed between markers, past anything the rc files print.
pub fn probe_path(shell: &Path, timeout: Duration) -> Result<OsString, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.subsec_nanos());
    let mark = format!("_GITVIBER_{}_{nanos}_", std::process::id());
    let mut cmd = Command::new(shell);
    cmd.args(["-ilc", &format!("echo {mark}; printenv PATH; echo {mark}")])
        .env_clear()
        .envs(clean_env())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    detach(&mut cmd);
    let mut child = crate::process::spawn(&mut cmd)
        .map_err(|e| format!("could not run {}: {e}", shell.display()))?;
    let mut out = child.stdout.take().ok_or("no stdout")?;
    let (tx, rx) = mpsc::channel();
    // Stops at the closing marker, not at EOF: a daemon the rc files start can hold the pipe.
    std::thread::spawn(move || {
        let (mut buf, mut chunk) = (Vec::new(), [0u8; 4096]);
        while let Ok(n @ 1..) = out.read(&mut chunk) {
            buf.extend_from_slice(&chunk[..n]);
            if let Some(path) = between_marks(&String::from_utf8_lossy(&buf), &mark) {
                let _ = tx.send(path);
                return;
            }
        }
    });
    let found = rx.recv_timeout(timeout);
    let _ = child.kill();
    let _ = child.wait();
    match found {
        Ok(path) if !path.is_empty() => Ok(path.into()),
        Ok(_) => Err(format!("{} printed an empty PATH", shell.display())),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            Err(format!("{} took over {timeout:?}", shell.display()))
        }
        Err(_) => Err(format!("{} exited without printing PATH", shell.display())),
    }
}

/// A new session with no controlling terminal, like VS Code's `detached`. An interactive
/// shell started from a terminal (`pnpm tauri dev`) would otherwise take it over, or stop.
fn detach(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    extern "C" {
        fn setsid() -> i32;
    }
    // SAFETY: setsid is async-signal-safe, so it may run between fork and exec.
    unsafe {
        cmd.pre_exec(|| {
            setsid();
            Ok(())
        });
    }
}

fn between_marks(text: &str, mark: &str) -> Option<String> {
    let (_, rest) = text.split_once(mark)?;
    let (inner, _) = rest.split_once(mark)?;
    Some(inner.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passwd_names_a_shell_that_exists() {
        let shell = passwd_shell().expect("the user has a passwd entry");
        assert!(Path::new(&shell).is_file(), "{shell:?}");
    }

    #[test]
    fn reads_between_marks_only() {
        let out = "Last login: today\nwelcome!\nM\n/a/bin:/usr/bin\nM\nbye\n";
        assert_eq!(between_marks(out, "M").as_deref(), Some("/a/bin:/usr/bin"));
        assert_eq!(between_marks("M\n/a/bin", "M"), None, "still printing");
    }

    /// A later probe's PATH reaches git without a restart; a failed one keeps the last.
    #[test]
    fn a_new_login_path_replaces_the_cached_one() {
        let starts = |dir: &str| {
            crate::process::search_path()
                .to_string_lossy()
                .starts_with(dir)
        };
        let path = |dir: &str| {
            let mut p = OsString::from(dir);
            p.push(":/usr/bin:/bin");
            p
        };
        record(&Ok(path("/gitviber-test/first")));
        assert!(starts("/gitviber-test/first"));
        let before = generation();
        record(&Ok(path("/gitviber-test/second")));
        assert!(generation() > before);
        assert!(starts("/gitviber-test/second"));
        record(&Err("took too long".into()));
        assert!(starts("/gitviber-test/second"));
    }
}
