import type { Commit, FileChange } from "../api";

/** A branch's diff range in a comparison (merge base → head), its name as `label`. */
interface PullRange {
  label?: string;
  base: string;
  head: string;
}

/** A side of a comparison: a full ref (refs/heads/…, refs/remotes/…, refs/tags/…) or a commit id, and what to call it. */
export interface ComparePoint {
  ref: string;
  label: string;
}

/** A stored tab's point, which a build that wrote it may have shaped otherwise: the screen reads both sides' labels. */
export const isComparePoint = (p: unknown): p is ComparePoint => typeof p === "object" && p !== null && typeof (p as ComparePoint).ref === "string" && typeof (p as ComparePoint).label === "string";

export type Selection =
  | { kind: "unstaged" | "staged" | "conflict"; file: FileChange }
  | { kind: "commit"; commit: Commit; file: FileChange }
  | { kind: "file"; path: string }
  // A file of a comparison's range.
  | { kind: "pr-file"; range: PullRange; file: FileChange }
  // A branch under review: `base` is the merge base (a commit id), `label` the branch it was compared with.
  // `fixed`: History's comparison of the working tree with one commit, whose base stays as the review moves.
  | { kind: "branch"; base: string; label: string; file: FileChange; fixed?: true }
  // Every file of a Changes list in one scroll: uncommitted, staged, or the branch under review.
  | { kind: "changes"; list: ChangeList }
  // Or of a commit, or of a comparison's range.
  | { kind: "changes"; list: "commit"; commit: Commit }
  | { kind: "changes"; list: "range"; range: PullRange }
  // The Compare screen: `head` against `base`, from their merge base (what a PR shows) or as they stand.
  | { kind: "compare"; base: ComparePoint; head: ComparePoint; mergeBase: boolean }
  // Two working-tree files side by side (the explorer's Compare Selected): `file.oldPath` against `file.path`.
  | { kind: "files"; file: FileChange }
  // An agent's guided review (features/review/GuideView) of a commit, of HEAD's branch since
  // `base` (a full ref, `label` its short name), or of the worktree's uncommitted changes.
  | { kind: "guide"; of: "commit"; commit: Commit }
  /** A run of commits, `oldest` through `newest` on one line of history; `count` of them in all. */
  | { kind: "guide"; of: "commits"; oldest: Commit; newest: Commit; count: number }
  | { kind: "guide"; of: "branch"; base: string; label: string }
  | { kind: "guide"; of: "changes" };

export type GuideSelection = Extract<Selection, { kind: "guide" }>;

/** A whole list of files in one scroll. */
export type ChangesSelection = Extract<Selection, { kind: "changes" }>;

/** The explorer's comparison of two working-tree files, `left` the old side. */
export const filesSelection = (left: string, right: string): Selection => ({
  kind: "files",
  file: { path: right, oldPath: left, status: "M", additions: null, deletions: null, oid: null, indexOid: null, conflict: null, mode: null, submodule: null, nested: null },
});

/** The lists Changes shows, which open whole as one stacked diff. */
export type ChangeList = "unstaged" | "staged" | "branch";

const LIST_TITLES: Record<ChangeList, string> = { unstaged: "All Changes", staged: "All Staged Changes", branch: "All Branch Changes" };

/** The files of a range, and the dots between its ends as git writes them. */
export const rangeLabel = (range: PullRange) => range.label ?? `${range.base.slice(0, 7)}..${range.head.slice(0, 7)}`;

/** A comparison's name: `base...head` from the merge base, `base..head` as they stand. */
export const compareLabel = (s: { base: ComparePoint; head: ComparePoint; mergeBase: boolean }) => `${s.base.label}${s.mergeBase ? "..." : ".."}${s.head.label}`;

/** A comparison range's identity. */
const rangeScope = (range: PullRange) => `@${range.base}..${range.head}`;

/** File path for file-like tabs; for the others, a label. */
export function selectionPath(s: Selection) {
  if (s.kind === "file") return s.path;
  if (s.kind === "changes") return s.list === "commit" ? `Commit ${s.commit.shortSha}` : s.list === "range" ? `All Changes · ${rangeLabel(s.range)}` : LIST_TITLES[s.list];
  if (s.kind === "compare") return "Compare";
  if (s.kind === "guide") return s.of === "commit" ? `Explain ${s.commit.shortSha}` : s.of === "commits" ? `Explain ${s.count} Commits` : `Guided Review · ${s.of === "changes" ? "Uncommitted" : s.label}`;
  return s.file.path;
}

/** The tab's file is in the working tree: not a commit's version, nor deleted. */
export function onDisk(s: Selection) {
  if (s.kind === "file") return true;
  return (s.kind === "unstaged" || s.kind === "staged" || s.kind === "conflict" || s.kind === "branch") && s.file.status !== "D";
}

/**
 * What unsaved edits to the tab's file are kept under (lib/editor/edits): its path. Null for
 * anything that can't be typed into.
 */
export function editPath(s: Selection) {
  // An unstaged diff's new side is the file on disk, typed into as the file view is.
  return s.kind === "file" || s.kind === "unstaged" ? selectionPath(s) : null;
}

/** Identity of what a tab shows; also used to match list rows to the open tab. */
export function selectionKey(s: Selection) {
  // A range's file by its range too, as its range's list is.
  const scope =
    s.kind === "commit"
      ? s.commit.sha
      : s.kind === "pr-file"
        ? rangeScope(s.range)
        : s.kind === "changes"
          ? s.list === "commit"
            ? s.commit.sha
            : s.list === "range"
              ? rangeScope(s.range)
              : ""
          : s.kind === "branch"
            ? s.base
            : s.kind === "files"
              ? (s.file.oldPath ?? "")
              : s.kind === "guide"
                ? s.of === "commit"
                  ? s.commit.sha
                  : s.of === "commits"
                    ? `${s.oldest.sha}..${s.newest.sha}`
                    : s.of === "changes"
                    ? "changes"
                    : s.base
                : "";
  return `${s.kind}:${scope}:${selectionPath(s)}`;
}
