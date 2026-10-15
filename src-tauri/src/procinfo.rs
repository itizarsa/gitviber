//! What a terminal pane's processes are, read of the kernel (no `ps`): the command it runs in the
//! foreground and the folder its shell is in (pty.rs).

use std::path::PathBuf;

/// A process group's leader that is a command the shell runs: not the shell, and never a pid
/// (0, 1, ours, our group) that would stand for more than that program.
pub fn job_leader(leader: Option<i32>, shell: Option<u32>) -> Option<u32> {
    let pid = u32::try_from(leader?).ok().filter(|&p| p > 1)?;
    #[cfg(unix)]
    if pid == std::process::id() || pid as libc::pid_t == unsafe { libc::getpgrp() } {
        return None;
    }
    (Some(pid) != shell).then_some(pid)
}

#[cfg(target_os = "macos")]
pub fn cwd(pid: u32) -> Option<PathBuf> {
    use std::os::unix::ffi::OsStrExt;
    let mut info: libc::proc_vnodepathinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_vnodepathinfo>() as libc::c_int;
    let got = unsafe {
        libc::proc_pidinfo(
            pid as libc::c_int,
            libc::PROC_PIDVNODEPATHINFO,
            0,
            (&mut info as *mut libc::proc_vnodepathinfo).cast(),
            size,
        )
    };
    if got != size {
        return None;
    }
    // libc declares the path as 32 rows of 32 chars; it's one MAXPATHLEN buffer.
    let raw = &info.pvi_cdir.vip_path;
    let bytes: &[u8] =
        unsafe { std::slice::from_raw_parts(raw.as_ptr().cast(), std::mem::size_of_val(raw)) };
    let path = std::ffi::CStr::from_bytes_until_nul(bytes).ok()?;
    let path = std::path::Path::new(std::ffi::OsStr::from_bytes(path.to_bytes()));
    path.is_absolute().then(|| path.to_path_buf())
}

#[cfg(target_os = "linux")]
pub fn cwd(pid: u32) -> Option<PathBuf> {
    std::fs::read_link(format!("/proc/{pid}/cwd")).ok()
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn cwd(_pid: u32) -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn a_job_leader_is_never_the_shell_nor_a_pid_that_stands_for_more() {
        let ours = std::process::id();
        let group = unsafe { libc::getpgrp() };
        assert_eq!(job_leader(Some(4242), Some(100)), Some(4242));
        assert_eq!(job_leader(Some(100), Some(100)), None);
        for pid in [-1, 0, 1, ours as i32, group] {
            assert_eq!(job_leader(Some(pid), Some(100)), None, "{pid}");
        }
        assert_eq!(job_leader(None, Some(100)), None);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn a_process_folder_is_read() {
        let here = std::env::current_dir().unwrap().canonicalize().unwrap();
        let read = cwd(std::process::id()).unwrap();
        assert_eq!(read.canonicalize().unwrap(), here);
    }
}
