//! What every command shares: the open repo, the locks around it, and the blocking pool.

use crate::{agents, git, network, pty, suggest};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::State;

#[derive(Default)]
pub(crate) struct AppState {
    pub(crate) repo: Mutex<Option<PathBuf>>,
    pub(crate) watcher: Mutex<Option<notify::RecommendedWatcher>>,
    pub(crate) ptys: pty::Ptys,
    /// The agents running in terminals, and their state files watched.
    pub(crate) agents: agents::Agents,
    pub(crate) network: network::Running,
    /// Held by commands that write the index: two `git add`s at once fail on index.lock.
    pub(crate) index: Arc<Mutex<()>>,
    /// `git --version`, checked once; the page asks again after the user installs git.
    pub(crate) git: Mutex<Option<git::GitInfo>>,
    pub(crate) suggest: suggest::Suggester,
}

pub(crate) type Res<T> = Result<T, String>;

pub(crate) fn repo(state: &State<AppState>) -> Res<PathBuf> {
    state
        .repo
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .ok_or_else(|| "No repository is open.".to_string())
}

/// Git and disk work runs off the async runtime so a slow command never stalls the UI.
pub(crate) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Res<T> + Send + 'static,
) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// `f` with the open repo, on the blocking pool.
pub(crate) async fn in_repo<T: Send + 'static>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&Path) -> Res<T> + Send + 'static,
) -> Res<T> {
    let r = repo(state)?;
    blocking(move || f(&r)).await
}

/// `in_repo` for the reads a refresh does: each git call in `f` times out (git::reading).
pub(crate) async fn read_repo<T: Send + 'static>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&Path) -> Res<T> + Send + 'static,
) -> Res<T> {
    in_repo(state, move |r| git::reading(|| f(r))).await
}

/// Runs an index-writing git command one at a time. An agent or the terminal can hold
/// index.lock for a moment too, so that failure is retried once.
pub(crate) async fn indexed<T: Send + 'static>(
    state: &State<'_, AppState>,
    f: impl Fn(&Path) -> Res<T> + Send + 'static,
) -> Res<T> {
    let r = repo(state)?;
    let lock = state.index.clone();
    blocking(move || with_index_lock(&lock, &r, f)).await
}

/// `indexed` without the retry, for commands that do several steps: a stash push or pop that
/// hit index.lock partway has already done part of its work, and running it again would
/// stash or apply twice. The user retries once they see why it failed.
pub(crate) async fn indexed_once<T: Send + 'static>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&Path) -> Res<T> + Send + 'static,
) -> Res<T> {
    let r = repo(state)?;
    let lock = state.index.clone();
    blocking(move || {
        let _held = lock.lock().unwrap_or_else(|e| e.into_inner());
        f(&r)
    })
    .await
}

pub(crate) fn with_index_lock<T>(
    lock: &Mutex<()>,
    repo: &Path,
    f: impl Fn(&Path) -> Res<T>,
) -> Res<T> {
    let _held = lock.lock().unwrap_or_else(|e| e.into_inner());
    match f(repo) {
        Err(e) if e.contains("index.lock") => {
            std::thread::sleep(std::time::Duration::from_millis(400));
            f(repo)
        }
        done => done,
    }
}

/// `f` with the open repo on the blocking pool, without the index lock: the commands that move
/// HEAD or branches run git, which takes its own, and some hold this one around their writes.
pub(crate) async fn acting<T: Send + 'static>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&Path) -> Res<T> + Send + 'static,
) -> Res<T> {
    let r = repo(state)?;
    blocking(move || f(&r)).await
}

/// Registers a network command under the page's id, streaming its progress to `progress`.
pub(crate) fn watch_network(
    state: &State<AppState>,
    op: String,
    progress: Channel<network::Progress>,
) -> network::Net {
    state.network.start(op, move |p| {
        let _ = progress.send(p);
    })
}

/// "Commit" and the like read better with the commit's short id.
pub(crate) fn short(sha: &str) -> &str {
    &sha[..sha.len().min(7)]
}

/// The first `max` of `items` for a message: "a, b, c and 4 more".
pub(crate) fn some_of(items: &[&str], max: usize) -> String {
    let shown = items
        .iter()
        .take(max)
        .copied()
        .collect::<Vec<_>>()
        .join(", ");
    match items.len().saturating_sub(max) {
        0 => shown,
        more => format!("{shown} and {more} more"),
    }
}
