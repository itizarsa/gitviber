//! Patches copied and applied, and a past commit's file or change put back in the working tree.

use super::*;
use crate::patch::{self, LinesPatch};

fn repo(name: &str) -> (Sandbox, PathBuf) {
    let sb = Sandbox::new(name);
    let r = sb.path("r");
    init(&r);
    (sb, r)
}

fn disk(repo: &Path, path: &str) -> String {
    fs::read_to_string(repo.join(path)).unwrap()
}

#[test]
fn selected_lines_copy_as_a_patch_git_applies() {
    let (_sb, r) = repo("p-lines");
    write_commit(&r, "a.txt", "1\n2\n3\n4\n5\n6\n7\n8\n9\n", "base");
    let req = LinesPatch {
        path: "a.txt".into(),
        old_path: None,
        original: Some("1\n2\n3\n4\n5\n6\n7\n8\n9\n".into()),
        modified: Some("1\nTWO\n3\n4\n5\n6\n7\nEIGHT\n9\n".into()),
        removed: vec![2],
        added: vec![2],
    };
    let p = patch::lines(&req).unwrap();
    assert!(p.starts_with("diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n"));
    patch::apply(&r, p.as_bytes(), false, &["a.txt".into()]).unwrap();
    assert_eq!(disk(&r, "a.txt"), "1\nTWO\n3\n4\n5\n6\n7\n8\n9\n");
    let none = LinesPatch {
        removed: vec![],
        added: vec![],
        ..req
    };
    assert!(patch::lines(&none).is_err());
}

#[test]
fn a_stash_copies_with_its_untracked_files() {
    let (_sb, r) = repo("p-stash");
    write_commit(&r, "a.txt", "a\n", "base");
    fs::write(r.join("a.txt"), "a\nb\n").unwrap();
    fs::write(r.join("u.txt"), "u\n").unwrap();
    run(&r, &["stash", "push", "-q", "-u"]).unwrap();
    let p = patch::stash(&r, &rev(&r, "stash@{0}")).unwrap();
    assert!(p.contains("+b") && p.contains("+++ b/u.txt"));
}
