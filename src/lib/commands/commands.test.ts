import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bindingsFor,
  type Command,
  COMMANDS,
  canonical,
  cleanOverrides,
  commandFor,
  eventChord,
  eventChords,
  isReserved,
  type KeyLike,
  runsInEditor,
  runsWhileTyping,
  runsInTerminal,
  takenFromTerminal,
} from "./commands.ts";

const press = (key: string, code: string, mods: Partial<Omit<KeyLike, "key" | "code">> = {}): string | null =>
  eventChord({ key, code, altKey: false, shiftKey: false, metaKey: false, ctrlKey: false, ...mods });

test("US layout", () => {
  assert.equal(press("b", "KeyB", { metaKey: true }), "cmd+b");
  assert.equal(press("B", "KeyB", { metaKey: true }), "cmd+b", "caps lock");
  // ⌥ turns letters into symbols; the physical key is used.
  assert.equal(press("∫", "KeyB", { altKey: true, metaKey: true }), "alt+cmd+b");
  assert.equal(press("E", "KeyE", { shiftKey: true, metaKey: true }), "shift+cmd+e");
  assert.equal(press("=", "Equal", { metaKey: true }), "cmd+=");
  assert.equal(press("+", "Equal", { shiftKey: true, metaKey: true }), "shift+cmd+=");
  assert.equal(press("-", "Minus", { metaKey: true }), "cmd+-");
  assert.equal(press("≠", "Equal", { altKey: true, metaKey: true }), "alt+cmd+=");
  assert.equal(press("–", "Minus", { altKey: true, metaKey: true }), "alt+cmd+-");
  assert.equal(press(",", "Comma", { metaKey: true }), "cmd+,");
  assert.equal(press("ArrowDown", "ArrowDown", { altKey: true }), "alt+down");
  assert.equal(press("F7", "F7", { shiftKey: true }), "shift+f7");
  assert.equal(press("Enter", "Enter", { metaKey: true }), "cmd+enter");
  assert.equal(press("j", "KeyJ"), "j");
  assert.equal(press("Meta", "MetaLeft", { metaKey: true }), null);
  // ⇧ turns the bracket keys into braces; the chord keeps the key's own name.
  assert.equal(press("}", "BracketRight", { shiftKey: true, metaKey: true }), "shift+cmd+]");
  assert.equal(press("{", "BracketLeft", { shiftKey: true, metaKey: true }), "shift+cmd+[");
  assert.equal(press("Tab", "Tab", { ctrlKey: true, shiftKey: true }), "ctrl+shift+tab");
  assert.equal(press("1", "Digit1", { ctrlKey: true }), "ctrl+1");
  assert.equal(press("ArrowRight", "ArrowRight", { metaKey: true }), "cmd+right");
});

test("Turkish Q layout", () => {
  // Turkish "-" and "*" sit where US has "=" and "-".
  assert.equal(press("-", "Equal", { metaKey: true }), "cmd+-");
  assert.equal(press("-", "Equal"), "-");
  // ⌥⌘- must shrink the code font, not grow it (the physical key is US "=").
  assert.equal(press("–", "Equal", { altKey: true, metaKey: true }), "alt+cmd+-");
  assert.equal(press("ş", "Semicolon", { metaKey: true }), "cmd+ş");
  assert.equal(press(",", "Backslash", { metaKey: true }), "cmd+,");
});

test("German layout", () => {
  // Z and Y are swapped; ⌥Z must stay ⌥Z once the layout has been seen.
  assert.equal(press("z", "KeyY"), "z");
  assert.equal(press("Ω", "KeyY", { altKey: true }), "alt+z");
  // ⌥ output that is plain ASCII is kept as typed.
  assert.equal(press("@", "KeyL", { altKey: true }), "alt+@");
  // "+" has its own key; "=" is ⇧0.
  assert.equal(press("+", "BracketRight", { metaKey: true }), "cmd+=");
  assert.equal(press("=", "Digit0", { shiftKey: true, metaKey: true }), "shift+cmd+=");
});

test("canonical orders modifiers and rejects unknown ones", () => {
  assert.equal(canonical("cmd+shift+E"), "shift+cmd+e");
  assert.equal(canonical("cmd+alt+ctrl+-"), "ctrl+alt+cmd+-");
  assert.equal(canonical("j"), "j");
  assert.equal(canonical("Meta+b"), null);
  assert.equal(canonical("cmd+cmd+b"), null);
  assert.equal(canonical("cmd+"), null);
});

test("cleanOverrides drops unknown commands and bad chords", () => {
  assert.deepEqual(
    cleanOverrides({ "view.toggleSidebar": ["cmd+shift+g"], "tab.close": [], "gone.command": ["cmd+g"], "view.changes": ["Meta+b"], "view.history": "cmd+2" }),
    { "view.toggleSidebar": ["shift+cmd+g"], "tab.close": [] },
  );
  assert.deepEqual(cleanOverrides(null), {});
  assert.deepEqual(cleanOverrides(["cmd+b"]), {});
});

test("the first listed command wins a shared chord", () => {
  assert.equal(commandFor("cmd+1", { "view.toggleSidebar": ["cmd+1"] })?.id, "view.toggleSidebar");
  assert.equal(commandFor("cmd+b", { "tab.goto1": ["cmd+b"] })?.id, "view.toggleSidebar");
  assert.equal(commandFor("cmd+enter", {}), undefined, "local commands never run globally");
});

test("⌘1–⌘9 pick tabs; the git panel's views moved to ⌃1–⌃4", () => {
  const run = (chord: string, overrides = {}) => commandFor(chord, overrides)?.id;
  assert.equal(run("cmd+1"), "tab.goto1");
  assert.equal(run("cmd+8"), "tab.goto8");
  assert.equal(run("cmd+9"), "tab.last");
  assert.equal(run("ctrl+1"), "view.explorer");
  assert.equal(run("ctrl+3"), "view.changes");
  assert.equal(run("ctrl+4"), "view.history");
  assert.equal(run("ctrl+2"), "view.search");
  for (const chord of ["cmd+right", "shift+cmd+]", "ctrl+tab"]) assert.equal(run(chord), "tab.next");
  for (const chord of ["cmd+left", "shift+cmd+[", "ctrl+shift+tab"]) assert.equal(run(chord), "tab.prev");
  // Only the defaults moved: someone who bound ⌘1 to Changes keeps it.
  assert.equal(run("cmd+1", { "view.changes": ["cmd+1"] }), "view.changes");
  assert.equal(run("ctrl+3", { "view.changes": ["alt+cmd+1"] }), undefined);
});

const byId = (id: string) => COMMANDS.find((c) => c.id === id) as Command;

test("what still runs while typing in a text field or the terminal", () => {
  const typing = (chord: string, id: string) => runsWhileTyping(chord, byId(id));
  // ⌘←/⌘→ move the cursor (start/end of line in the terminal); the other tab keys work everywhere.
  assert.equal(typing("cmd+right", "tab.next"), false);
  assert.equal(typing("cmd+left", "tab.prev"), false);
  assert.equal(typing("shift+cmd+]", "tab.next"), true);
  assert.equal(typing("ctrl+tab", "tab.next"), true);
  assert.equal(typing("ctrl+shift+tab", "tab.prev"), true);
  assert.equal(typing("cmd+1", "tab.goto1"), true);
  assert.equal(typing("ctrl+1", "view.changes"), true);
  // ⌃+letter edits the line (⌃A, ⌃E); plain letters and ⌥ chords type.
  assert.equal(typing("ctrl+a", "view.changes"), false);
  assert.equal(typing("j", "review.nextFile"), false);
  assert.equal(typing("alt+down", "diff.nextChange"), false);
  assert.equal(typing("f7", "diff.nextChange"), true);
});

test("a file being edited takes ⌥Z for word wrap, unless it types a letter there", () => {
  const edit = (chord: string, id: string, typed?: string) => runsInEditor(chord, byId(id), typed);
  assert.equal(edit("alt+z", "editor.toggleWrap", "Ω"), true, "US ⌥Z types a symbol");
  assert.equal(edit("alt+z", "editor.toggleWrap", "ż"), false, "Polish ⌥Z types a letter");
  assert.equal(edit("alt+z", "editor.toggleWrap"), true, "the shortcut overlay has no key");
  assert.equal(edit("z", "editor.toggleWrap", "z"), false);
  assert.equal(edit("alt+s", "diff.toggleSplit", "ß"), false, "only editor keys");
});

test("the terminal hands the app its Ctrl chords, except Ctrl+letter", () => {
  const taken = (chord: string, id: string) => takenFromTerminal(chord, byId(id));
  assert.equal(taken("ctrl+tab", "tab.next"), true);
  assert.equal(taken("ctrl+1", "view.changes"), true);
  assert.equal(taken("ctrl+a", "view.changes"), false, "⌃A is the shell's");
  // ⌘ chords reach the app anyway on macOS; this is only about ⌃.
  assert.equal(taken("cmd+1", "tab.goto1"), false);
});

test("with the terminal focused, a key goes to the app or the shell, never both", () => {
  const app = (chord: string, id: string) => runsInTerminal(chord, byId(id));
  // F-keys are the shell's (htop, mc), though a text field lets them through.
  assert.equal(app("f6", "view.focusNextPanel"), false);
  assert.equal(app("shift+f6", "view.focusPrevPanel"), false);
  assert.equal(app("f7", "diff.nextChange"), false);
  assert.equal(runsWhileTyping("f6", byId("view.focusNextPanel")), true);
  assert.equal(app("j", "review.nextFile"), false);
  assert.equal(app("alt+down", "diff.nextChange"), false);
  // What xterm skips: ⌘ chords and the ⌃ chords it hands over.
  assert.equal(app("cmd+1", "tab.goto1"), true);
  assert.equal(app("shift+cmd+]", "tab.next"), true);
  assert.equal(app("ctrl+tab", "tab.next"), true);
  assert.equal(app("ctrl+a", "view.changes"), false);
  assert.equal(app("cmd+left", "tab.prev"), false, "start of line");
});

test("a punctuation key also counts as its US name; letters and digits only as typed", () => {
  const chords = (key: string, code: string, mods: Partial<Omit<KeyLike, "key" | "code">> = {}) =>
    eventChords({ key, code, altKey: false, shiftKey: false, metaKey: false, ctrlKey: false, ...mods });
  // Turkish Q types " on the US ` key: ⌃` still toggles the terminal.
  assert.deepEqual(chords('"', "Backquote", { ctrlKey: true }), ["ctrl+\"", "ctrl+`"]);
  assert.equal(commandFor("ctrl+`", {})?.id, "terminal.toggle");
  assert.deepEqual(chords("`", "Backquote", { ctrlKey: true }), ["ctrl+`"]);
  // German ⌘Y is the US Z key, and must not undo.
  assert.deepEqual(chords("y", "KeyZ", { metaKey: true }), ["cmd+y"]);
  // Without ⌘ or ⌃ a key types: US "?" is not "/", German "-" (the US / key) is not "/".
  assert.deepEqual(chords("?", "Slash", { shiftKey: true }), ["shift+?"]);
  assert.deepEqual(chords("-", "Slash"), ["-"]);
});

test("the terminal's own keys only run there, and keep ⌘W from closing a tab only there", () => {
  assert.equal(commandFor("cmd+d", {}), undefined);
  assert.equal(commandFor("cmd+w", {})?.id, "tab.close");
  assert.deepEqual(bindingsFor("terminal.split", {}), ["cmd+d"]);
  // ⌃` reaches the app from inside the terminal instead of sending NUL.
  assert.ok(takenFromTerminal("ctrl+`", byId("terminal.toggle")));
  // Split down, pane focus and maximize: ⇧⌘D, ⇧⌘ and ⌥⌘ arrows and ⌘↵ outside the terminal stay what they were.
  assert.deepEqual(bindingsFor("terminal.splitDown", {}), ["shift+cmd+d"]);
  assert.deepEqual(bindingsFor("terminal.zoomPane", {}), ["shift+cmd+enter"]);
  assert.deepEqual(bindingsFor("terminal.focusLeft", {}), ["alt+cmd+left"], "by side");
  assert.deepEqual(bindingsFor("terminal.prevPane", {}), ["shift+cmd+left"], "pages through the numbered panes");
  assert.deepEqual(bindingsFor("terminal.focusUp", {}), ["shift+cmd+up", "alt+cmd+up"]);
  const arrows = ["left", "right", "up", "down"].flatMap((k) => [`shift+cmd+${k}`, `alt+cmd+${k}`]);
  for (const chord of ["shift+cmd+d", "alt+shift+cmd+d", ...arrows, "cmd+enter", "shift+cmd+enter", "alt+shift+cmd+enter"]) assert.equal(commandFor(chord, {}), undefined, chord);
});

test("macOS reserves chords", () => {
  assert.equal(isReserved("cmd+q"), true);
  assert.equal(isReserved("cmd+h"), true);
  assert.equal(isReserved("cmd+b"), false);
});

test("no two global commands share a default, and macOS takes none of them", () => {
  const owner = new Map<string, string>();
  for (const c of COMMANDS) {
    if ("local" in c) continue;
    for (const chord of bindingsFor(c.id, {})) {
      assert.equal(owner.get(chord), undefined, `${chord} is ${owner.get(chord)}'s and ${c.id}'s`);
      assert.equal(isReserved(chord), false, `${chord} (${c.id})`);
      owner.set(chord, c.id);
    }
  }
});

test("Reload Window is ⇧⌘R, leaving ⌘R to name a terminal pane", () => {
  assert.deepEqual(bindingsFor("window.reload", {}), ["shift+cmd+r"]);
  assert.deepEqual(bindingsFor("terminal.renamePane", {}), ["cmd+r"]);
});

test("no two commands of one place share a default", () => {
  const owner = new Map<string, string>();
  for (const c of COMMANDS) {
    if (!("local" in c)) continue;
    for (const chord of bindingsFor(c.id, {})) {
      const key: string = `${c.local} ${chord}`;
      assert.equal(owner.get(key), undefined, `${chord} is ${owner.get(key)}'s and ${c.id}'s in ${c.local}`);
      owner.set(key, c.id);
    }
  }
});

// Monaco's own ⌥⌘ keys, from its default keybindings: the code view's capture
// listener would take them from it. Find's toggles (⌥⌘C W R L P), replace (⌥⌘F), remove brackets (⌥⌘⌫).
const MONACO_ALT_CMD = ["c", "w", "r", "l", "p", "f", "backspace", "space", "[", "]", "up", "down", ".", "enter"].map((k) => `alt+cmd+${k}`);

test("stage, unstage and discard the change at the cursor leave Monaco's keys and text fields alone", () => {
  for (const id of ["diff.stageChange", "diff.unstageChange", "diff.discardChange"]) {
    for (const chord of bindingsFor(id as Command["id"], {})) {
      assert.ok(!MONACO_ALT_CMD.includes(chord), `${id}: ${chord} is Monaco's`);
      // A key meant for the code view mustn't stage or discard from a text field or the terminal.
      assert.equal(runsWhileTyping(chord, byId(id)), false, `${id}: ${chord}`);
      assert.equal(runsInTerminal(chord, byId(id)), false, `${id}: ${chord}`);
    }
  }
  assert.equal(commandFor("shift+cmd+r", {})?.id, "window.reload");
  // ⌥ turns S into ß and N into a dead key; the physical key counts.
  assert.equal(press("ß", "KeyS", { altKey: true, metaKey: true }), "alt+cmd+s");
  assert.equal(press("Dead", "KeyN", { altKey: true, metaKey: true }), "alt+cmd+n");
  // WebKit reports ⌥⌘N as the dead key's own "~": the key's letter still finds the command.
  const tilde = { key: "~", code: "KeyN", altKey: true, shiftKey: false, metaKey: true, ctrlKey: false };
  assert.deepEqual(eventChords(tilde), ["alt+cmd+~", "alt+cmd+n"]);
  assert.equal(commandFor("alt+cmd+n", {})?.id, "diff.unstageChange");
});

test("fetch, pull and push reach the app from text fields and the terminal", () => {
  const keys = { "git.fetch": "ctrl+shift+cmd+t", "git.pull": "ctrl+shift+cmd+p", "git.push": "ctrl+cmd+p" } as const;
  for (const [id, chord] of Object.entries(keys) as [keyof typeof keys, string][]) {
    assert.deepEqual(bindingsFor(id, {}), [chord]);
    assert.equal(runsWhileTyping(chord, byId(id)), true, id);
    assert.equal(runsInTerminal(chord, byId(id)), true, id);
    assert.ok(!MONACO_ALT_CMD.includes(chord), id);
  }
  assert.equal(press("t", "KeyT", { ctrlKey: true, shiftKey: true, metaKey: true }), "ctrl+shift+cmd+t");
  assert.equal(commandFor("ctrl+cmd+p", {})?.id, "git.push");
  // ⌘G stays macOS's Find Next.
  assert.equal(commandFor("cmd+g", {}), undefined);
});
