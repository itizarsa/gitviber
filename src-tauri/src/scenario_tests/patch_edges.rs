//! Restore, revert and patches against the files real repositories have: binaries, renames,
//! modes, links, submodules, line endings, odd names, merges in progress and long undo chains.

use super::*;
use crate::patch::{self, LinesPatch};
use crate::revert::{self, RevertLines};

fn repo(name: &str) -> (Sandbox, PathBuf) {
    let sb = Sandbox::new(name);
    let r = sb.path("r");
    init(&r);
    (sb, r)
}

fn disk(repo: &Path, path: &str) -> String {
    fs::read_to_string(repo.join(path)).unwrap()
}

fn commit_all(repo: &Path, msg: &str) {
    run(repo, &["add", "-A"]).unwrap();
    run(repo, &["commit", "-q", "-m", msg]).unwrap();
}

/// What Revert This File's Change runs (commands::patch::revert_file), journaled.
fn revert_file(
    repo: &Path,
    sha: &str,
    path: &str,
    old: Option<&str>,
) -> Result<Vec<String>, String> {
    let named: Vec<String> = old
        .map(String::from)
        .into_iter()
        .chain([path.into()])
        .collect();
    let bytes = revert::commit_change(repo, sha, &named)?;
    let paths = patch::touched(&patch::files(repo, &bytes, true)?);
    let list = paths.clone();
    crate::backup::replace(
        repo,
        "before revert",
        &paths,
        &Mutex::new(()),
        move |r: &Path| patch::apply(r, &bytes, true, &list),
    )
}

fn restore_file(repo: &Path, sha: &str, path: &str) -> Result<Vec<String>, String> {
    let (sha, p) = (sha.to_string(), path.to_string());
    crate::backup::replace(
        repo,
        "before restore",
        &[path.to_string()],
        &Mutex::new(()),
        move |r: &Path| restore_from(r, &sha, &p).map(|_| vec![]),
    )
}

// ---- a merge in progress -------------------------------------------------------------------

/// A merge stopped on c.txt, with a.txt free to change.
fn mid_merge(name: &str) -> (Sandbox, PathBuf) {
    let (sb, r) = repo(name);
    write_commit(&r, "c.txt", "1\n", "base");
    write_commit(&r, "a.txt", "a\n", "a");
    run(&r, &["switch", "-q", "-c", "other"]).unwrap();
    write_commit(&r, "c.txt", "other\n", "other");
    run(&r, &["switch", "-q", "main"]).unwrap();
    write_commit(&r, "c.txt", "main\n", "main");
    assert!(run(&r, &["merge", "-q", "other"]).is_err());
    assert!(!run_text(&r, &["ls-files", "-u"]).unwrap().is_empty());
    (sb, r)
}

#[test]
fn a_patch_applied_mid_merge_reports_no_conflicts_it_did_not_make() {
    let (_sb, r) = mid_merge("pe-midmerge-clean");
    let p = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n a\n+b\n";
    let conflicts = patch::apply(&r, p.as_bytes(), false, &["a.txt".into()]).unwrap();
    assert_eq!(disk(&r, "a.txt"), "a\nb\n");
    assert!(
        conflicts.is_empty(),
        "c.txt was conflicted before the patch, which never touched it: {conflicts:?}"
    );
}

#[test]
fn a_patch_that_fails_mid_merge_is_an_error() {
    let (_sb, r) = mid_merge("pe-midmerge-fail");
    let p = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n zzz\n+b\n";
    let out = patch::apply(&r, p.as_bytes(), false, &["a.txt".into()]);
    assert_eq!(disk(&r, "a.txt"), "a\n");
    assert!(
        out.is_err(),
        "nothing applied, yet it reads as applied with conflicts: {out:?}"
    );
}

// ---- the index stays as it was -------------------------------------------------------------

#[test]
fn reverting_keeps_a_staged_version_of_the_same_file() {
    let (_sb, r) = repo("pe-staged-same");
    write_commit(&r, "a.txt", "1\n2\n3\n4\n5\n6\n7\n8\n", "base");
    write_commit(&r, "a.txt", "1\nTWO\n3\n4\n5\n6\n7\n8\n", "two");
    let sha = rev(&r, "HEAD");
    fs::write(r.join("a.txt"), "1\nTWO\n3\n4\n5\n6\n7\nstaged\n").unwrap();
    stage(&r, &["a.txt".into()]).unwrap();
    fs::write(r.join("a.txt"), "1\nTWO\n3\n4\n5\n6\n7\nworking\n").unwrap();
    let before = run_text(&r, &["diff", "--cached"]).unwrap();

    assert!(revert_file(&r, &sha, "a.txt", None).unwrap().is_empty());
    assert_eq!(disk(&r, "a.txt"), "1\n2\n3\n4\n5\n6\n7\nworking\n");
    assert_eq!(run_text(&r, &["diff", "--cached"]).unwrap(), before);

    let req = RevertLines {
        sha: sha.clone(),
        path: "a.txt".into(),
        old_path: None,
        removed: vec![2],
        added: vec![2],
    };
    fs::write(r.join("a.txt"), "1\nTWO\n3\n4\n5\n6\n7\nworking\n").unwrap();
    assert!(revert::lines(&r, &req).unwrap().is_empty());
    assert_eq!(disk(&r, "a.txt"), "1\n2\n3\n4\n5\n6\n7\nworking\n");
    assert_eq!(run_text(&r, &["diff", "--cached"]).unwrap(), before);
    let none = run_text(&r, &["status", "--porcelain"]).unwrap();
    assert!(!none.contains("index.gitviber"), "no scratch index left");
    let left: Vec<_> = fs::read_dir(r.join(".git"))
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("index.gitviber")
        })
        .collect();
    assert!(left.is_empty(), "scratch indexes are removed");
}

// ---- binaries, renames, modes, links -------------------------------------------------------

#[test]
fn a_rename_in_a_patch_lists_both_names() {
    let (_sb, r) = repo("pe-rename-names");
    let body: String = (1..=20).map(|i| format!("line {i}\n")).collect();
    write_commit(&r, "old.txt", &body, "base");
    run(&r, &["mv", "old.txt", "new.txt"]).unwrap();
    fs::write(r.join("new.txt"), format!("{body}more\n")).unwrap();
    commit_all(&r, "rename");
    let sha = rev(&r, "HEAD");
    let named = ["old.txt".to_string(), "new.txt".to_string()];
    let bytes = revert::commit_change(&r, &sha, &named).unwrap();
    assert!(String::from_utf8_lossy(&bytes).contains("rename from old.txt"));
    // Reverting writes both: undo must have both in the journal, and the scratch index both.
    let mut touched = patch::touched(&patch::files(&r, &bytes, true).unwrap());
    touched.sort();
    assert_eq!(touched, ["new.txt", "old.txt"]);
    let files = patch::files(&r, &bytes, false).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(
        (files[0].status.as_str(), files[0].old_path.as_deref()),
        ("R", Some("old.txt"))
    );
}


#[cfg(unix)]
#[cfg(unix)]
#[cfg(unix)]
#[test]
fn a_tracked_link_that_points_out_of_the_repo_can_be_reverted() {
    let (sb, r) = repo("pe-symlink-out");
    fs::write(sb.path("outside.txt"), "secret\n").unwrap();
    std::os::unix::fs::symlink("../outside.txt", r.join("shared")).unwrap();
    commit_all(&r, "base");
    let base = rev(&r, "HEAD");
    fs::remove_file(r.join("shared")).unwrap();
    std::os::unix::fs::symlink("../elsewhere.txt", r.join("shared")).unwrap();
    commit_all(&r, "repoint");
    let sha = rev(&r, "HEAD");
    // git writes the link itself, never through it, so the outside file is never at risk.
    let out = revert_file(&r, &sha, "shared", None);
    assert!(out.is_ok(), "{out:?}");
    assert_eq!(
        fs::read_link(r.join("shared")).unwrap(),
        Path::new("../outside.txt")
    );
    assert_eq!(
        fs::read_to_string(sb.path("outside.txt")).unwrap(),
        "secret\n"
    );
    let out = restore_file(&r, &base, "shared");
    assert!(out.is_ok(), "{out:?}");
}

#[cfg(unix)]

// ---- submodules, LFS, line endings ---------------------------------------------------------

#[test]
fn reverting_a_submodule_bump_moves_it_back_or_says_it_cannot() {
    let sb = Sandbox::new("pe-submodule");
    let r = repo_with_submodule(&sb);
    let sub = r.join("sub");
    let old = rev(&sub, "HEAD");
    write_commit(&sub, "l.txt", "l2\n", "lib 2");
    commit_all(&r, "bump");
    let sha = rev(&r, "HEAD");
    let out = revert_file(&r, &sha, "sub", None);
    // Either the submodule's checkout went back, or the user hears that it didn't.
    let moved = rev(&sub, "HEAD") == old;
    assert!(
        moved || out.is_err(),
        "reported as reverted, yet the submodule is still at the bump: {out:?}"
    );
}


#[test]
fn a_file_without_a_final_newline_reverts_by_line_and_copies_lines() {
    let (_sb, r) = repo("pe-no-eol");
    write_commit(&r, "a.txt", "1\n2\n3", "base");
    write_commit(&r, "a.txt", "1\n2\nTHREE", "edit");
    let sha = rev(&r, "HEAD");
    let req = RevertLines {
        sha,
        path: "a.txt".into(),
        old_path: None,
        removed: vec![3],
        added: vec![3],
    };
    assert!(revert::lines(&r, &req).unwrap().is_empty());
    assert_eq!(disk(&r, "a.txt"), "1\n2\n3");

    let lp = LinesPatch {
        path: "a.txt".into(),
        old_path: None,
        original: Some("1\n2\n3".into()),
        modified: Some("1\n2\n3\n4".into()),
        removed: vec![3],
        added: vec![3, 4],
    };
    let p = patch::lines(&lp).unwrap();
    patch::apply(&r, p.as_bytes(), false, &["a.txt".into()]).unwrap();
    assert_eq!(disk(&r, "a.txt"), "1\n2\n3\n4");
}

// ---- deleted files, the root commit, merge commits -----------------------------------------

#[test]
fn the_root_commit_reverts_restores_and_copies() {
    let (_sb, r) = repo("pe-root");
    write_commit(&r, "a.txt", "1\n2\n", "root");
    let root = rev(&r, "HEAD");
    write_commit(&r, "a.txt", "1\n2\n3\n", "more");
    // The root added the file: reverting its change deletes it, conflicting with the edit since.
    let out = revert_file(&r, &root, "a.txt", None);
    assert!(out.is_err() || r.join("a.txt").exists());
    restore_file(&r, &root, "a.txt").unwrap();
    assert_eq!(disk(&r, "a.txt"), "1\n2\n");
    let p = patch::changes(&r, "commit", &["a.txt".into()], Some(&root)).unwrap();
    assert!(p.contains("new file mode"));
    let mail = patch::commit(&r, &root).unwrap();
    assert!(mail.contains("+1"));
    let req = RevertLines {
        sha: root,
        path: "a.txt".into(),
        old_path: None,
        removed: vec![],
        added: vec![2],
    };
    assert!(revert::lines(&r, &req).unwrap().is_empty());
    assert_eq!(disk(&r, "a.txt"), "1\n");
}

#[test]
fn copying_a_merge_commit_as_a_patch_never_copies_another_commit() {
    let (_sb, r) = repo("pe-merge-mail");
    write_commit(&r, "a.txt", "a\n", "base");
    run(&r, &["switch", "-q", "-c", "side"]).unwrap();
    write_commit(&r, "s.txt", "side\n", "side commit");
    run(&r, &["switch", "-q", "main"]).unwrap();
    write_commit(&r, "m.txt", "main\n", "main commit");
    run(&r, &["merge", "-q", "--no-ff", "-m", "merge side", "side"]).unwrap();
    let out = patch::commit(&r, &rev(&r, "HEAD"));
    assert!(
        out.is_err(),
        "a merge commit copied as some other commit: {}",
        out.unwrap_or_default().lines().nth(3).unwrap_or_default()
    );
}

// ---- odd paths -----------------------------------------------------------------------------


// ---- unsafe patches ------------------------------------------------------------------------

#[test]
fn non_utf8_files_revert_and_say_why_they_do_not_copy() {
    let (_sb, r) = repo("pe-latin1");
    fs::write(r.join("l.txt"), b"caf\xe9\n1\n2\n").unwrap();
    commit_all(&r, "base");
    fs::write(r.join("l.txt"), b"caf\xe9\nONE\n2\n").unwrap();
    commit_all(&r, "edit");
    let sha = rev(&r, "HEAD");
    revert_file(&r, &sha, "l.txt", None).unwrap();
    assert_eq!(fs::read(r.join("l.txt")).unwrap(), b"caf\xe9\n1\n2\n");
    assert!(patch::changes(&r, "commit", &["l.txt".into()], Some(&sha))
        .unwrap_err()
        .contains("UTF-8"));
    let req = RevertLines {
        sha,
        path: "l.txt".into(),
        old_path: None,
        removed: vec![2],
        added: vec![2],
    };
    assert!(
        revert::lines(&r, &req).is_err(),
        "lossy text is never written back"
    );
    assert_eq!(fs::read(r.join("l.txt")).unwrap(), b"caf\xe9\n1\n2\n");
}

// ---- odd repositories ----------------------------------------------------------------------

// ---- undo and redo chains ------------------------------------------------------------------

#[test]
fn a_large_file_copies_selected_lines_and_reverts_by_line() {
    let (_sb, r) = repo("pe-large");
    let old: String = (0..30_000).map(|i| format!("line {i}\n")).collect();
    let new = old
        .replace("line 29990\n", "LINE 29990\n")
        .replace("line 5\n", "LINE 5\n");
    write_commit(&r, "big.txt", &old, "base");
    write_commit(&r, "big.txt", &new, "edit");
    let sha = rev(&r, "HEAD");
    let req = RevertLines {
        sha,
        path: "big.txt".into(),
        old_path: None,
        removed: vec![29991],
        added: vec![29991],
    };
    let started = std::time::Instant::now();
    assert!(revert::lines(&r, &req).unwrap().is_empty());
    assert_eq!(disk(&r, "big.txt"), old.replace("line 5\n", "LINE 5\n"));
    let lp = LinesPatch {
        path: "big.txt".into(),
        old_path: None,
        original: Some(old.clone()),
        modified: Some(new.clone()),
        removed: vec![6],
        added: vec![6],
    };
    let p = patch::lines(&lp).unwrap();
    assert!(p.len() < 1000, "one small hunk, not the whole file");
    assert!(started.elapsed().as_secs() < 10);
}

// ---- comparing -----------------------------------------------------------------------------

#[test]
fn the_working_tree_compared_with_a_commit_leaves_ignored_files_out() {
    let (_sb, r) = repo("pe-compare-wt");
    write_commit(&r, ".gitignore", "*.log\n", "ignore");
    write_commit(&r, "a.txt", "a\n", "base");
    let base = rev(&r, "HEAD");
    fs::write(r.join("debug.log"), "noise\n").unwrap();
    fs::write(r.join("new file.txt"), "n\n").unwrap();
    fs::write(r.join("a.txt"), "a\nb\n").unwrap();
    let review = worktree_review(&r, &base).unwrap();
    let rows: Vec<(&str, &str)> = review
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.status.as_str()))
        .collect();
    assert_eq!(rows, [("a.txt", "M"), ("new file.txt", "?")]);
}

#[cfg(unix)]
#[test]
fn two_files_compare_the_same_a_binary_a_folder_and_a_link_out() {
    let (sb, r) = repo("pe-two-files");
    fs::write(r.join("a.txt"), "1\n2\n").unwrap();
    fs::write(r.join("bin"), b"\0\x01\x02").unwrap();
    fs::create_dir_all(r.join("dir")).unwrap();
    fs::write(sb.path("outside.txt"), "private words\n").unwrap();
    std::os::unix::fs::symlink(sb.path("outside.txt"), r.join("out")).unwrap();
    let pair = |old: &str, new: &str| {
        diff_pair(&r, "files", new, Some(old), None, None, None, |p| {
            vfs::read_diff_side(&r, p)
        })
        .unwrap()
    };
    let same = pair("a.txt", "a.txt");
    assert!(same.rows.iter().all(|row| row.k == 0));
    assert!(pair("a.txt", "bin").modified.binary);
    let folder = pair("a.txt", "dir");
    assert!(!folder.modified.exists || folder.modified.text.is_empty());
    let out = pair("a.txt", "out");
    assert!(
        !out.modified.text.contains("private words"),
        "a link's target path at most, never the outside file's text"
    );
}
