import { kittyNotes, type Note, osc777Note, osc9Note } from "./attention";
import { panes, type Pane, state, update } from "./terminals";

/**
 * A bell, or a notification escape (OSC 9, 777, 99: Claude Code, Codex), from a pane not being
 * looked at marks it, its tab and its worktree, until it's looked at.
 */
export function watchAttention(p: Pane) {
  p.term.onBell(() => needsYou(p));
  const readers: [number, (data: string) => Note | null][] = [[9, osc9Note], [777, osc777Note], [99, kittyNotes()]];
  for (const [code, read] of readers)
    p.term.parser.registerOscHandler(code, (data) => {
      const note = read(data);
      if (note) needsYou(p);
      // Not a notification (OSC 9;4 is a progress bar): left to any other handler.
      return !!note;
    });
}

/** Marks `p` unless it's being looked at. */
export function needsYou(p: Pane) {
  const info = state.groups.flatMap((g) => g.panes).find((i) => i.id === p.id);
  if (!info || (document.hasFocus() && document.activeElement === p.term.textarea)) return;
  if (!info.needsYou) update(p.id, (i) => ({ ...i, needsYou: true }));
}

export function lookedAt(id: number) {
  if (state.groups.some((g) => g.panes.some((p) => p.id === id && p.needsYou))) update(id, (p) => ({ ...p, needsYou: false }));
}

// Back in the window, the pane that has the keys is looked at again.
window.addEventListener("focus", () => {
  for (const p of panes.values()) if (document.activeElement === p.term.textarea) lookedAt(p.id);
});
