# GitViber fork: work plan

What this fork changes compared to upstream GitViber (0.1.13, commit `5e0a3e8`). The goal is
a smaller app for personal use, built locally and installed through your own Homebrew tap.

Screenshots of the UI (taken from the Linux dev build up to 0.2.0) are in [`docs/fork-plan/`](docs/fork-plan/),
referenced below where relevant. A 45-second walkthrough of everything listed here is in
[`docs/fork-plan/walkthrough.mp4`](docs/fork-plan/walkthrough.mp4): the repo popover, the PRs and
Issues tabs, Undo history, a Browser tab, and the Obsidian, Notifications and Browser settings.

## Status: implemented

Everything below has been built on `arshath/compassionate-galileo-706r8j`, one commit per step.
Screenshots of the result are in [`docs/fork-plan/after/`](docs/fork-plan/after/), along with a
67-second walkthrough, [`fork-walkthrough.mp4`](docs/fork-plan/after/fork-walkthrough.mp4).

| Asked for | What was done |
|---|---|
| Repo picker → sidebar, one click | The top bar's popover is gone. The repositories sit at the window's edge as a **rail** of tiles, beside the sidebar: one click opens one, the open repo's tile shows its changed-file count, right-click opens, starts a terminal, reveals, copies the path or removes it. The sidebar, terminal and settings toggles moved from the top bar to the rail's foot. ![The rail](docs/fork-plan/after/final-rail.png) |
| One sidebar with Explorer, Search, Changes and History, docked left or right | Done. Tabs on ⌃1–⌃4 (Alt+1–4 off macOS), ⌘B toggles the sidebar, ⌥⌘B moves it, and Settings → Appearance → Sidebar position sets the side. Moving it doesn't reload the code view or terminals. |
| Remove the commit box | Done. Staging, discard, stash and review marks stay. |
| Remove PRs, Issues: "remove everything" GitHub | PRs, issues, CI checks, PR/issue tabs and terminal links, PR checkout, issue → worktree, fork-original history, permalinks and Open on GitHub, GitHub repos in Clone, protected branches, gh account switching, AI commit/PR messages, and the Rust GitHub API client with `ureq`. Settings → Commit Messages is now **Agent**: the CLI that Explain Commit and Guided Review still run. |
| Remove the Browser | Done, including the macOS WKWebView code, `gitviber browser`, the terminal's Open localhost menu, and three objc2 crates. |
| Remove Obsidian | Done. Callout colors move to `lib/markdown/calloutColors.ts`, since they style every markdown file. |
| Remove Notifications | Done, including the notification plugin. A terminal or agent that needs you still marks its pane and tab. |
| Remove Apply Patch from Clipboard | Done, along with the clipboard read only it used. |
| Remove Undo History, "all should go" | The undo/redo buttons, history, ⌘Z/⇧⌘Z, toast Undo and the journal behind them. **Kept on purpose:** what a discard, restore or revert overwrites is still copied to the Trash first (`src-tauri/src/backup.rs`). "Undo commit" in History is a git soft reset, not the journal, so it stays. |
| Homebrew tap | The in-app updater is removed (it pointed at upstream's releases). The cask template installs from `itizarsa/gitviber`, sets `auto_updates false`, and clears quarantine for an unnotarized build. `homebrew.yml` commits to `itizarsa/homebrew-tap`. |

Older saved windows can hold tabs this fork no longer has (browser, vault, PR, issue, PR guided
review). They're dropped on restore instead of crashing.

**Checks** (`pnpm check`, which CI runs): version match, `tsc`, production build, 580 JS tests,
license list, `cargo fmt`, `cargo clippy -D warnings` all pass. Rust tests: 481/486. The 5 that
fail are this container's, not the code's: 4 fail the same way on untouched upstream here (running
as root, no signing key, the sticky Trash layout), and the 5th passes on its own (it's
timing-sensitive under load).

**Not done / your call:**
- The app identifier is still `app.gitviber.desktop`. If upstream GitViber is also installed,
  they share settings, and the `gitviber` CLI opens whichever macOS picks. Change `identifier` in
  `tauri.conf.json`, `open -b` in `src-tauri/resources/gitviber`, and the cask's `zap` paths
  together if you want them apart.
- macOS-only Rust code was edited (the browser removal, the clipboard) but can only be compiled
  on a Mac: run `pnpm check:rust` there once.
- README and CHANGELOG still describe upstream.

### Build and install on your Mac

```sh
pnpm install
pnpm install:mac          # release build of the .app, copied to /Applications
# or, for your tap: pnpm tauri build --bundles dmg --target universal-apple-darwin
# upload the .dmg to a GitHub release, then fill in packaging/homebrew/gitviber.rb
```

The rest of this file is the original plan, kept for reference.

---

## 0. Where things are today

![Current layout](docs/fork-plan/01-current-layout.png)

The window (`src/features/workspace/Workspace.tsx`) is laid out like this:

```
┌───────────────────────────── TopBar ─────────────────────────────────────────┐
│ Logo │ ProjectSwitcher ▾ / BranchPicker ▾  WorktreePicker │ … │ Undo Redo ▾ │
│      Fetch  Pull▾  Push▾ │ Agents  Browser  Terminal  ◧ ◨  Settings          │
├──────────── LEFT "list" panel ────┬──── viewer ────┬──── RIGHT "files" ───────┤
│ Changes │ History │ PRs │ Issues   │  TabStrip      │ Explorer │ Search        │
│ [view-menu] [apply-patch] [review] │  Monaco / PR / │ [filter] [collapse]       │
│ …rows…                             │  Browser / …   │ FileTree                  │
│ ── CommitBox (bottom of Changes) ──│                │ ── Obsidian vault ──      │
│                                    ├── Terminal ────┤                           │
└────────────────────────────────────┴────────────────┴───────────────────────────┘
                                   StatusBar
```

* The **left sidebar** (`id="list"`, `data-panel="git"`) holds the `ListTab`s
  `changes | history | pulls | issues`.
* The **right sidebar** (`id="files"`, `data-panel="explorer"`) holds `files | search`
  (`explorerView`), plus the Obsidian vault section (`ExplorerPanes`).
* Both are fixed-pixel panels managed by `usePanelSizes("gitviber-sides-v1", …)` with the
  `SIDES` constant `{ list, files }`.
* The repo picker is `ProjectSwitcher` (`src/features/topbar/ProjectSwitcher.tsx`). It is a
  popover that wraps the reusable `ProjectList` (`src/features/projects/ProjectList.tsx`), so
  switching repos takes two clicks.
* Switching repos remounts `<Workspace key={opened.root}>` (`src/App.tsx:208`). Any
  sidebar-level repo list therefore only has to call `onOpenRepo(path)`.

Baseline checks on this branch before any change: `pnpm typecheck` passes, `pnpm test`
passes 730/730, and the Linux debug build compiles and runs (see §7).

---

## 1. Move the repo picker from the top bar to the sidebar (one-click switch)

![Repo picker today: a popover in the top bar](docs/fork-plan/02-repo-picker-popover.png)

**Target:** a "Repositories" section at the top of the merged sidebar (§2). It shows the
recent repos as rows. One click opens a repo, the current one is highlighted, and the section
keeps the existing drag-to-reorder, right-click menu, and "Open…" / "Clone…" actions.

| Step | File(s) | Notes |
|---|---|---|
| 1.1 | new `src/features/workspace/RepoSection.tsx` | Wraps `ProjectList` (already exported and self-contained) with a collapsible header (`Repositories`, `+` open, clone), similar to `VaultSection`'s collapsible header. Persist the collapsed state and height in `localStorage` (pattern in `VaultSection.tsx:24-29`). |
| 1.2 | `ProjectList.tsx` | Add a `compact` prop: 24px rows, no path subtitle. The current branch and dirty counts come from `api.projectInfo` and are already fetched. |
| 1.3 | `src/features/topbar/TopBar.tsx` | Remove `<ProjectSwitcher>` and the `/` separator. Keep `BranchPicker` and `WorktreePicker` in the top bar. |
| 1.4 | `ProjectSwitcher.tsx` | Keep only the `file.switchProject` command, now focusing the sidebar's repo list, or delete the file and drop the command from `src/lib/commands/commands.ts`. |
| 1.5 | `Workspace.tsx` | Pass `recent / onOpenRepo / onForgetRepo / onReorderRepos / onLocateRepo` to the sidebar instead of `TopBar`. |

Inside the sidebar, the repo list sits in a vertical `ResizablePanelGroup` above the view
tabs, so it can be dragged smaller or collapsed to its header.

---

## 2. One merged sidebar: Explorer, Search, Changes, History, dockable left or right

![Two sidebars today](docs/fork-plan/01-current-layout.png)

**Target layout:**

```
┌──────────── TopBar ───────────────────────────────────────────────────────┐
│ Logo │ BranchPicker ▾ WorktreePicker │ …  │ Fetch Pull▾ Push▾ │ Agents Terminal ◧ ⚙ │
├──── Sidebar (left OR right) ─┬──────────── viewer ─────────────────────────┤
│ REPOSITORIES            + ⤓ │  TabStrip                                    │
│ ● gitviber      +12 -3      │  Monaco …                                    │
│   other-repo                │                                              │
│ ─────────────────────────── │                                              │
│ Explorer Search Changes Hist│                                              │
│ …active view…               ├──────────── Terminal ────────────────────────┤
└─────────────────────────────┴──────────────────────────────────────────────┘
```

| Step | File(s) | Notes |
|---|---|---|
| 2.1 | `Workspace.tsx` | Replace `LIST_TABS` and `explorerView` with one `SidebarView = "explorer" \| "search" \| "changes" \| "history"`. Restore it from `saved.listTab` and map the old values: `pulls`/`issues` become `changes`, an unknown value becomes `explorer`. |
| 2.2 | `Workspace.tsx` | `SIDES` becomes `{ side: { base: 300, min: 220, max: "45", collapsible: true } }`, with a new storage key `gitviber-side-v1`. Render one `ResizablePanel id="side"` either before or after `id="viewer"`, depending on the setting. Keep the `KeptPanel`s and the always-mounted `SearchView`/`FileTree`, so state survives tab switches as it does today. |
| 2.3 | `src/lib/settings.ts` | Add `sidebarSide: "left" \| "right"` (default `"left"`), with validation in the loader like the other enums (around line 450). |
| 2.4 | `src/features/settings/sections/Appearance.tsx` | Add a `Segmented` "Sidebar position: Left / Right" control. |
| 2.5 | `src/lib/commands/commands.ts` + `src-tauri/src/menu.rs` | Commands: `view.toggleSidebar` (⌘B, replacing `toggleGitPanel`/`toggleExplorer`), `view.moveSidebar` ("Move Sidebar Left/Right"), and `view.explorer/search/changes/history` on ctrl+1..4, replacing `view.pulls`/`view.issues`. Update the View menu in `menu.rs` (lines ~185-200). |
| 2.6 | `src/lib/ui/panels.ts` | Keep the `git` and `explorer` focus targets as `data-panel` attributes on the inner views (Changes/History are `git`; Explorer/Search are `explorer`), so F6, Esc-back-to-list and `focusPanel` keep working. Make `PANELS` skip whichever one is hidden. |
| 2.7 | `src/features/workspace/PanelHeader.tsx` | One `CollapseButton` whose icon flips with the dock side. In `TopBar` the two ◧ ◨ buttons become one sidebar toggle. |
| 2.8 | Revealers in `Workspace.tsx` | `revealInExplorer`, `search.findInFiles`, `showInHistory`, `changes.focusMessage` and the others currently expand `"list"` or `"files"`. Point them at `"side"` and switch the view. |
| 2.9 | `src/lib/repo/session.ts` | Keep the `listTab` key name for compatibility, but store the new view value. |

The Obsidian vault section currently sits under the file tree (`ExplorerPanes`). It goes away
with §3.

---

## 3. Remove features

Each one starts with an **A (UI removal)**: unhook it from the UI and commands. That is small,
low risk, and easy to keep merging from upstream. **B (dead-code removal)** then deletes
modules, Rust commands and dependencies. B makes the app smaller, but every upstream merge
touching those files will conflict. My recommendation: A for everything, plus B for Browser,
Obsidian and Notifications (self-contained and large).

### 3.1 PRs and Issues tabs

![PRs and Issues tabs](docs/fork-plan/03-changes-tabs.png)

* **A:** drop the `pulls` and `issues` tabs and `KeptPanel`s from `Workspace.tsx:514-519,
  571-588`, the `view.pulls`/`view.issues` commands and menu items, and the `PullsPanel` and
  `IssuesPanel` imports.
* **Keep** (used elsewhere, and harmless): `features/github/*` view code for PR tabs opened from
  terminal links and the worktree picker's PR badges, `CiBadge`, `CommitChecks`, and the
  `github/` Rust module.
* **B (optional):** remove the `kind: "pull" | "issue" | "pr-file"` selections (`selection.ts`),
  the matching branches in `Viewer.tsx`/`TabStrip.tsx`/`useTabs.ts`, `useWorktreePulls`, and the
  terminal link → PR routing in `lib/links/`. This touches about 25 files, so it is not
  recommended unless you want GitHub gone completely.

### 3.2 Commit box at the bottom of Changes

![Commit box](docs/fork-plan/04-commit-box.png)

* **A:** in `src/features/changes/ChangesPanel.tsx:694-701`, remove the `CommitBox` (and the
  "operation in progress" footer, or keep that one line as a hint). Drop
  `changes.focusMessage` (`commands.ts:46`, `Workspace.tsx:382`).
* Keep `useCommitBox.ts`/`CommitBox.tsx` only if something else imports them (`grep` shows only
  ChangesPanel and Workspace do), and delete them in B. Settings → **Commit** (sign-off,
  co-authors, AI suggest) then has no effect, so remove that section too
  (`SettingsPanel.tsx:12,112`).
* Staging, discard, stash, and review/viewed marks stay. Commit from the terminal or agent.

### 3.3 Browser

![Browser button in the top bar](docs/fork-plan/05-topbar-right.png)
![A browser tab](docs/fork-plan/09-browser-tab.png)

* **A:** `TopBar.tsx` `BrowserButton`; `Workspace.tsx` `openPage`, `usePageAsk`,
  `browser.open`/`browser.clearData`, `useAgentTabs`; `Viewer.tsx:103-104`; all `browser.*`
  commands (`commands.ts:166-185`) and the menu item (`menu.rs:199`); the Settings → Browser
  section; the terminal's "open port" menu (`PaneLayout.tsx:34-36`, `PortsMenu`).
* **B:** delete `src/features/browser/`, `src/lib/browser/`, `src/lib/api/browser.ts`, the
  `kind: "browser"` selection and its session restore, Rust `src-tauri/src/browser/` (~5k lines,
  including macOS WKWebView code), `commands/browser.rs`, its 21 registrations in `lib.rs`
  (`447-467`), the `gitviber browser …` CLI hook in `main.rs`/`lib.rs:83-87`, the CSP
  `frame-src` entry, and the `browser` ask kind in `QuestionBox.tsx`. Terminal URL clicks then
  open in the system browser (`linkHost.ts` already has that fallback).

### 3.4 Obsidian

![Obsidian settings](docs/fork-plan/06-settings-obsidian.png)

* **A:** in `Workspace.tsx`, render `FileTree` directly instead of `ExplorerPanes`. Remove the
  Settings → Obsidian section and the `vault` branch in `Viewer.tsx:101-102`.
* **B:** delete `src/features/obsidian/`, `src/lib/obsidian/`, `src/lib/api/obsidian.ts`, the
  `kind: "vault"` selection, the `obsidian`/`hiddenVaults` settings, Rust `obsidian.rs` and
  `commands/obsidian.rs` (9 registrations, `lib.rs:337-345`). Careful: `lib/markdown/syntax.ts`,
  `viewer/markdown/Callout.tsx` and `Properties.tsx` support Obsidian-style markdown for **all**
  markdown files, so leave those alone.

### 3.5 Notifications

![Notifications settings](docs/fork-plan/06b-settings-notifications.png)

* **A:** remove the Settings → Notifications section. With `notify` defaulting to `false`,
  nothing is ever posted.
* **B:** make `notifyIfAway` a no-op (it is called from `lib/terminal/needsYou.ts` and
  `lib/repo/netActivity.ts`), delete `lib/app/notify.ts`, `notifyState.ts` and its test, and
  Rust `notifications.rs` plus its 4 commands (`lib.rs:206-209`) and `setup` (`lib.rs:185`).
  Drop the `tauri-plugin-notification` crate (`Cargo.toml`, `lib.rs:112`) and its permission in
  `capabilities/*.json`. Keep the in-app terminal dots and the Dock badge: those are not
  notifications.

### 3.6 Apply Patch from Clipboard

* **A:** remove the `ClipboardPaste` button (`Workspace.tsx:524-534`), `<ApplyPatchDialog>`
  (`:754`), the `git.applyPatch` command (`commands.ts:202`, `Workspace.tsx:344`).
* **B:** delete `ApplyPatchDialog.tsx`. In Rust, remove only `commands::patch::patch_preview` and
  `apply_patch` and their scenario tests (`scenario_tests/patch_edges.rs`, check which tests
  cover apply). Keep the other `patch.rs` functions: they power stash, discard lines and
  revert.

### 3.7 Undo history

![Undo/redo buttons](docs/fork-plan/05-topbar-right.png)
![Undo history dropdown](docs/fork-plan/08-undo-history.png)

* **A (recommended reading of the request):** remove `<UndoControls>` from `TopBar.tsx`
  (the ↶ ↷ buttons and the ▾ "Undo history" dropdown).
* **Decision needed:** the journal behind it (`src-tauri/src/journal.rs`, `lib/repo/undo.ts`) also
  powers the **Undo** button on toasts ("Discarded 3 files · Undo") and ⌘Z / ⇧⌘Z. Options:
  1. Remove only the top-bar controls. Toast Undo and ⌘Z keep working. *(Recommended: discard
     with undo is a safety net.)*
  2. Also remove ⌘Z/⇧⌘Z (`git.undo/redo` in `commands.ts:204-205`, `menu.rs:260-261`), keeping
     toast Undo.
  3. Remove the journal entirely. This touches about 15 files (`useGitAction`, `StashList`,
     `FileTree`, `CommitFileMenu`, …), and discard would become permanent.

---

## 4. Top bar after the changes

![Top bar today](docs/fork-plan/07-topbar.png)

Remaining: Logo · BranchPicker · WorktreePicker · "Not published" · *(activity)* · Fetch ·
Pull ▾ · Push ▾ · Agents · Terminal · Sidebar toggle · Settings.

---

## 5. Making it yours for a Homebrew tap

These are not UI changes, but they are needed so the fork doesn't fight upstream:

1. **Updater.** This one is critical. `tauri.conf.json:58-61` points at upstream's
   `latest.json`. As is, your build would offer the upstream release and replace your fork.
   Either remove the updater (`tauri-plugin-updater`, `src/lib/app/updates.ts`,
   Settings → Updates, `UpdateButton` in the status bar) or point `endpoints` and `pubkey` at
   your own releases. Removing it is simpler: `brew upgrade` handles updates. Then set
   `auto_updates false` in the cask.
2. **Identifier and name.** To install next to upstream (or to avoid sharing its
   `~/Library/WebKit/app.gitviber.desktop` localStorage/settings), change `identifier` in
   `tauri.conf.json` (e.g. `io.<you>.gitviber`) and optionally `productName`. Update the cask's
   `app`/`zap` paths to match.
3. **Cask.** Copy `packaging/homebrew/gitviber.rb` to your tap (`<you>/homebrew-tap`,
   `Casks/gitviber.rb`) and point `url` and `homepage` at your fork's releases.
   `.github/workflows/homebrew.yml` can do this automatically if you add a `HOMEBREW_TAP_KEY`
   deploy key, as `RELEASING.md` describes.
4. **Signing.** `release.yml` needs Apple Developer and Tauri signing secrets. Without them, the
   simplest route is a local `pnpm tauri build --bundles dmg` (or `--target
   universal-apple-darwin`), uploaded to a GitHub release. The cask can then de-quarantine the
   unsigned app (`postflight { system_command "xattr", args: ["-dr", "com.apple.quarantine", "#{appdir}/GitViber.app"] }`),
   or install with `brew install --cask --no-quarantine`. `pnpm install:mac` already builds and
   copies a local `.app` for quick personal use.
5. **Links.** Point About and README links, `homepage`, and the `bundle.publisher` at your fork,
   as you like.

---

## 6. Suggested order of work (one commit each)

1. Remove features, A level (§3.1–3.7). Typecheck and tests after each.
2. Merge the sidebars (§2), including the dock setting.
3. Repo list in the sidebar (§1).
4. B-level dead-code removal (Browser, Obsidian, Notifications, ApplyPatch).
5. Updater, identifier and cask (§5).
6. Update `README.md` and `CHANGELOG.md` for the fork.

Checks for every step: `pnpm typecheck && pnpm test && pnpm check:rust`, then a run of the
Linux dev build under Xvfb with screenshots (§7).

---

## 7. Build and verify environment

Until 0.2.0 the fork was checked in a Linux container: a debug build under Xvfb, driven through
`src-tauri/src/dev_bridge.rs` with `xdotool`, `import` and `ffmpeg`. That is how the screenshots in
`docs/fork-plan/` were taken.

From 0.3.0 the app builds for macOS only (§8), so that no longer runs. In a Linux container:

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm build      # the frontend, as before
sh scripts/clippy-macos-from-linux.sh          # the Rust side, type-checked and linted for macOS
```

The Rust tests and a real run need a Mac: CI (`.github/workflows/ci.yml`, macos-latest) runs
`pnpm check` on every push to `main` or an `arshath/*` branch.

## 8. 0.3.0: macOS only, trimmed further

- Linux and Windows code paths, builds, icons and CI go; `lib.rs` stops a build for another OS.
  The keyboard layer has only macOS's chords (no Ctrl-for-⌘ mapping, no `keysOther`).
- Removed: the `gitviber` command, Clone, Switch Project, Copy as Patch, agent awareness in
  terminals (status dots, Agents menu, resume on restore), Resume a Conversation, external
  diff/merge tools, installing git from the app, the website, the update proxy, upstream's
  contributor docs, and the dead Commit shortcut.
- Kept: guided reviews and Ask Agent (Settings → Agent and → Review), now always starting a new
  agent session; conflict view's Ask agent does the same.
