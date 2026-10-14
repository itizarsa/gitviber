//! Commit message suggestions from an agent CLI.

use super::*;

#[test]
fn guide_gets_a_commit_or_the_branch_and_names_the_range() {
    use crate::suggest::{self, Agent, Target};
    use std::sync::atomic::AtomicBool;
    let sb = Sandbox::new("suggest-guide");
    let r = sb.path("r");
    init(&r);
    let go = |target: Target| {
        let none = Agent::default();
        suggest::run_guide(&r, "cat", "PROMPT", &target, &none, &AtomicBool::new(false))
    };
    let sha = |rev: &str| {
        run_text(&r, &["rev-parse", rev])
            .unwrap()
            .trim()
            .to_string()
    };
    // A root commit is described from the empty tree.
    write_commit(&r, "a.txt", "one\n", "Add a\n\nWhy it's here.");
    let root = sha("HEAD");
    let g = go(Target::Commit { sha: root.clone() }).unwrap();
    assert!(
        g.text.starts_with("PROMPT\n\nBelow is what the change is (a commit's message")
            && g.text.contains(
                "\n\nThe commit's message:\nAdd a\n\nWhy it's here.\n\nChanged files (1):\nA +1 -0 a.txt\n\n"
            ),
        "{}",
        g.text
    );
    assert!(g.text.contains("+one") && g.head == root, "{}", g.text);

    run(&r, &["switch", "-q", "-c", "feat"]).unwrap();
    write_commit(&r, "b.txt", "bee\n", "Add b");
    write_commit(&r, "a.txt", "two\n", "Change a");
    // One commit: its own diff only, from its parent.
    let g = go(Target::Commit { sha: sha("HEAD") }).unwrap();
    assert!(
        g.text.contains("+two") && !g.text.contains("+bee"),
        "{}",
        g.text
    );
    assert!(go(Target::Commit { sha: "HEAD".into() }).is_err());

    // The branch: its commits and their diff, not uncommitted work; the range read comes back.
    fs::write(r.join("b.txt"), "local\n").unwrap();
    let g = go(Target::Branch {
        base: "refs/heads/main".into(),
    })
    .unwrap();
    assert!(
        g.text
            .contains("\n\nCommits, oldest first:\n- Add b\n- Change a\n\nChanged files (2):\n"),
        "{}",
        g.text
    );
    assert!(
        g.text.contains("+bee") && g.text.contains("+two") && !g.text.contains("local"),
        "{}",
        g.text
    );
    assert_eq!((g.base, g.head), (root.clone(), sha("HEAD")));
    let err = go(Target::Branch {
        base: "refs/heads/feat".into(),
    })
    .unwrap_err();
    assert!(err.contains("no commits"), "{err}");
}
