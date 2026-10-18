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

#[test]
fn guide_explains_a_run_of_commits_with_every_message_it_spans() {
    use crate::suggest::{self, Agent, Target};
    use std::sync::atomic::AtomicBool;
    let sb = Sandbox::new("suggest-commits");
    let r = sb.path("r");
    init(&r);
    let go = |oldest: &str, newest: &str| {
        let none = Agent::default();
        let target = Target::Commits {
            oldest: oldest.into(),
            newest: newest.into(),
        };
        suggest::run_guide(&r, "cat", "PROMPT", &target, &none, &AtomicBool::new(false))
    };
    let sha = |rev: &str| {
        run_text(&r, &["rev-parse", rev])
            .unwrap()
            .trim()
            .to_string()
    };
    write_commit(&r, "a.txt", "one\n", "Add a");
    let first = sha("HEAD");
    write_commit(&r, "b.txt", "bee\n", "Add b\n\nFor the tests.");
    let middle = sha("HEAD");
    write_commit(&r, "c.txt", "sea\n", "Add c");
    let last = sha("HEAD");

    // Two picked commits with one between: the diff and the messages span all three after `first`.
    let g = go(&middle, &last).unwrap();
    assert!(
        g.text
            .contains("These 2 commits, oldest first, with their messages:\n- ")
            && g.text.contains(" Add b\n  For the tests.")
            && g.text.contains(" Add c"),
        "{}",
        g.text
    );
    assert!(
        g.text.contains("+bee") && g.text.contains("+sea") && !g.text.contains("+one"),
        "{}",
        g.text
    );
    assert_eq!(
        (g.base.as_str(), g.head.as_str()),
        (format!("{middle}^").as_str(), last.as_str())
    );

    // From the root commit: everything, against the empty tree.
    let g = go(&first, &last).unwrap();
    assert!(
        g.text.contains("These 3 commits") && g.text.contains("+one"),
        "{}",
        g.text
    );

    // Not one run: a newer commit on another branch doesn't descend from `last`.
    run(&r, &["switch", "-q", "-c", "side", &middle]).unwrap();
    write_commit(&r, "d.txt", "dee\n", "Add d");
    let err = go(&last, &sha("HEAD")).unwrap_err();
    assert!(err.contains("one run of history"), "{err}");
}
