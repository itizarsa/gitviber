//! Working-tree files a discard, restore, revert or stash rewrites are copied to the Trash
//! first, so nothing a click overwrites is lost: "a.txt (discarded 2026-09-22 14.03)".

use crate::fs;
use std::path::Path;
use std::sync::Mutex;

/// The last part of a repo path: "a.txt" of "src/a.txt".
fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Rewrites the working-tree files `paths` with `write`, after copying what they are now to the
/// Trash. `word` names the copies; `index` is held while `write` runs. Returns the files `write`
/// left with conflicts.
pub fn replace(
    repo: &Path,
    word: &str,
    paths: &[String],
    index: &Mutex<()>,
    write: impl Fn(&Path) -> Result<Vec<String>, String>,
) -> Result<Vec<String>, String> {
    let when = local_minute();
    for path in paths {
        // A submodule: restoring it doesn't touch its files.
        if repo.join(path).symlink_metadata().is_ok_and(|m| m.is_dir()) {
            continue;
        }
        if fs::stamp(repo, path).is_some() {
            fs::trash_copy(repo, path, &format!("{} ({word} {when})", file_name(path)))?;
        }
    }
    crate::state::with_index_lock(index, repo, write)
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// "2026-09-22 14.03" in local time: when a discarded version went to the Trash.
fn local_minute() -> String {
    use std::ffi::{c_char, c_int, c_long};
    // `struct tm`: sec, min, hour, mday, mon, year, wday, yday, isdst, then gmtoff and zone.
    #[repr(C)]
    struct Tm {
        f: [c_int; 9],
        _gmtoff: c_long,
        _zone: *const c_char,
    }
    extern "C" {
        fn localtime_r(t: *const i64, out: *mut Tm) -> *mut Tm;
    }
    let t = now() as i64;
    let mut tm = std::mem::MaybeUninit::<Tm>::uninit();
    if unsafe { localtime_r(&t, tm.as_mut_ptr()) }.is_null() {
        return t.to_string();
    }
    let f = unsafe { tm.assume_init() }.f;
    format!(
        "{}-{:02}-{:02} {:02}.{:02}",
        f[5] + 1900,
        f[4] + 1,
        f[3],
        f[2],
        f[1]
    )
}
