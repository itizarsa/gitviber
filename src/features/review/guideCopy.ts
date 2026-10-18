import type { GuideSelection } from "@/lib/repo/selection";

/** How the guide view speaks of what it reviews, by its kind: one place to add a kind to. */
export function guideCopy(sel: GuideSelection, branch: string | null) {
  switch (sel.of) {
    case "commit":
      return { what: "this commit", title: sel.commit.subject, reads: "the commit's message and diff" };
    case "commits":
      return { what: "these commits", title: `${sel.count} commits, ${sel.oldest.shortSha} to ${sel.newest.shortSha}`, reads: "the commits' messages and their combined diff" };
    case "changes":
      return { what: "these changes", title: "Uncommitted changes", reads: "the uncommitted changes (staged, unstaged and new files)" };
    case "branch":
      return { what: "this branch", title: `${branch ?? "HEAD"} since ${sel.label}`, reads: "the branch's commits and their diff (not uncommitted changes)" };
  }
}
