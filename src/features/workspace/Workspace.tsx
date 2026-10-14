import { ChevronsDownUp, GitCompareArrows, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tip } from "@/components/ui/tooltip";
import { KeptPanel } from "@/components/KeptPanel";
import { find } from "@/lib/ui/find";
import { warmHighlighter } from "@/lib/editor/highlight";
import { setLinkHost } from "@/lib/links/linkHost";
import { prepare } from "@/lib/editor/monaco";
import { useCommands, useShortcut } from "@/lib/commands/keybindings";
import { dropReveal, revealWaits } from "@/lib/editor/reveal";
import { type ChangeList, type ComparePoint, onDisk, type Selection, selectionKey, selectionPath } from "@/lib/repo/selection";
import { useCompareAsk } from "@/lib/repo/compareRequest";
import { defaultPoints } from "@/lib/git/comparePoints";
import { codeWantsFocus, focusedPanel, focusList, focusPanel, type Panel, PANELS } from "@/lib/ui/panels";
import { usePanelSizes } from "@/lib/ui/usePanelSizes";
import { loadWorkspace, saveWorkspace } from "@/lib/repo/session";
import { DEFAULT_FONT_SIZE, updateSettings, useSettings } from "@/lib/settings";
import { goGroup, stepGroup, unmaximize, useTerminalsMaximized, useTerminalsOpen, useTerminalTabCount } from "@/lib/terminal/terminals";
import { useRepo } from "@/lib/repo/useRepo";
import type { OpenedRepo } from "@/lib/api";
import { reviewBase, shortRef } from "@/lib/git/refs";
import { cn } from "@/lib/utils";
import { revealPath } from "@/lib/app/openIn";
import { windowTitle } from "@/lib/app/windowTitle";
import { ChangesPanel } from "@/features/changes/ChangesPanel";
import { changeList } from "@/features/changes/changeList";
import { changesView, ordered } from "@/features/changes/changesView";
import { ChangesViewMenu } from "@/features/changes/ChangesViewMenu";
import { useMtimes } from "@/features/changes/useMtimes";
import { BranchReview, useBranchReview } from "@/features/changes/BranchReview";
import { showQuickOpen, useQuickOpenSource } from "@/features/palette/CommandPalette";
import { FileTree, type FileTreeHandle } from "@/features/explorer/FileTree";
import { type HistorySearch, NO_SEARCH, SearchableHistory } from "@/features/history/HistorySearch";
import { selectedText } from "@/features/viewer/activeEditor";
import { StatusBar } from "./StatusBar";
import { useTabs } from "./useTabs";
import { useViewed } from "./useViewed";
import { ListTabButton, PanelHeader } from "./PanelHeader";
import { RepoRail } from "./RepoRail";
import { headerWidth } from "./headerWidth";
import { SearchView } from "@/features/explorer/SearchView";
import { TerminalPanel, useTerminalSetup } from "@/features/terminal/TerminalPanel";
import { TerminalRestoreOffer } from "@/features/terminal/TerminalFind";
import { TopBar } from "@/features/topbar/TopBar";
import { Viewer } from "@/features/viewer/Viewer";
import { prefetchSelection, resetPairCache } from "@/features/viewer/diffPairs";
import { stackedView } from "@/features/viewer/StackedFiles";
import { openEdits } from "@/lib/editor/edits";
import { openNotes, useNoteCheck } from "@/lib/review/noteStore";
import { copyNotes, pendingNotes, sendNotes } from "@/features/review/ReviewNotes";
import { openGuide } from "@/features/review/guides";

// The sidebar's views, in its tab order. Changes and History are the git panel; Explorer and Search the explorer.
const VIEWS = ["explorer", "search", "changes", "history"] as const;
type View = (typeof VIEWS)[number];
const panelOf = (v: View): Panel => (v === "changes" || v === "history" ? "git" : "explorer");
// The sidebar and the terminal: their sizes until the user sets them, and their bounds.
const SIDES = { side: { base: 340, min: 260, max: "45", collapsible: true } };
const VIEWER_MIN = 360;
const BOTTOM = { terminal: { base: "35", min: 100 } };
const EDITOR_MIN = 120;
// Up to 0.1.10 the layouts were kept as shares of the window, under these.
const OLD_BOTTOM = ["react-resizable-panels:gitviber-viewer-v1:editor:terminal", "react-resizable-panels:gitviber-viewer-v1:editor"];

interface Props {
  root: string;
  /** The main worktree; differs from root when a linked worktree is open. */
  main: string;
  recent: string[];
  onOpenRepo: (path?: string) => Promise<unknown>;
  onForgetRepo: (path: string) => void;
  onLocateRepo: (path: string) => void;
  /** The repo's folder was deleted while open. */
  onRepoGone: (repo: OpenedRepo) => void;
}

/**
 * Diffs are cached by revision, which restarts per repo, and unsaved file edits and
 * review notes are per repo: they start over with each repo, during its first render, before
 * anything in it reads them.
 */
function useFreshCaches(root: string) {
  const cleared = useRef<string | null>(null);
  if (cleared.current === root) return;
  cleared.current = root;
  resetPairCache();
  openEdits(root);
  openNotes(root);
}

function setWindowTitle(title: string) {
  try {
    void getCurrentWindow().setTitle(title).catch(() => {});
  } catch {
    // Not in Tauri (the browser-only dev fixture).
  }
}

export function Workspace({ root, main, recent, onOpenRepo, onForgetRepo, onLocateRepo, onRepoGone }: Props) {
  useFreshCaches(root);
  const repo = useRepo(root, () => onRepoGone({ root, main }));
  const { status } = repo;
  const title = windowTitle(root, status?.branch ?? null, status?.head ?? null);
  useEffect(() => setWindowTitle(title), [title]);
  useEffect(() => () => setWindowTitle(windowTitle(null, null, null)), []);
  const s = useSettings();
  const [saved] = useState(() => loadWorkspace(root));
  const [view, setView] = useState<View>(() => VIEWS.find((t) => t === saved?.listTab) ?? "changes");
  // Here, not in History: the search outlives a switch to another list.
  const [historySearch, setHistorySearch] = useState<HistorySearch>(NO_SEARCH);
  // Until History shows and takes it: a request, not a count, so no later mount repeats it.
  const [searchFocus, setSearchFocus] = useState(false);
  const searchFocused = useCallback(() => setSearchFocus(false), []);
  // Blame clicks so far: each is a new request, even for the commit already on show.
  const reveals = useRef(0);
  // The full ref Changes reviews the branch against, in place of the uncommitted list; null: not reviewing.
  const [review, setReview] = useState<string | null>(() => (typeof saved?.review === "string" ? saved.review : null));
  const reviewing = view === "changes" && review !== null;
  // The views shown so far: each is kept once it was, but none is drawn before it's asked for.
  const [seenTabs, setSeenTabs] = useState(() => new Set([view]));
  if (!seenTabs.has(view)) setSeenTabs(new Set(seenTabs).add(view));
  // All Branch Changes on show reads the review too, with the list on another tab. It's known once
  // the tabs are, below: a change there renders this again before anything is drawn.
  const [branchOnShow, setBranchOnShow] = useState(false);
  const branchReview = useBranchReview(review, repo.revision, reviewing || branchOnShow);
  const { tabs, activeKey, setActiveKey, open: openTab, update, closeTabs, close, closeAround, reopen, canReopen, moveTab, goTab, stepTab, pin, onPathMoved } = useTabs(saved, status, branchReview.review && branchReview.rows);
  const branchTab = activeKey === selectionKey({ kind: "changes", list: "branch" });
  if (branchTab !== branchOnShow) setBranchOnShow(branchTab);
  // A file opened while the terminal covers the code view (⌘P, a path clicked in the terminal) comes into view.
  const open = useCallback(
    (sel: Selection, pin?: boolean) => {
      unmaximize();
      openTab(sel, pin);
    },
    [openTab],
  );
  const { viewedMap, viewed, setViewed, toggleViewed } = useViewed(saved, status, repo.refresh, branchReview.review);
  useNoteCheck(repo.revision);
  useEffect(() => saveWorkspace(root, { tabs, active: activeKey, listTab: view, viewed: [...viewedMap], review }), [root, tabs, activeKey, view, viewedMap, review]);
  // One sidebar, on the side Settings → Appearance puts it; it collapses to give code the room.
  const sidebars = usePanelSizes("gitviber-side-v1", "horizontal", SIDES, { flexMin: VIEWER_MIN });
  const bottom = usePanelSizes("gitviber-bottom-v1", "vertical", BOTTOM, { flexMin: EDITOR_MIN, legacy: OLD_BOTTOM });
  useTerminalSetup(root);
  // Where a terminal can start besides this repo's worktrees, without switching the window there.
  const projects = recent.filter((p) => p !== main);
  const terminalOpen = useTerminalsOpen();
  const terminalMaximized = useTerminalsMaximized();
  // goGroup and stepGroup are read as this renders: a tab opened since was out of ⌘1–⌘9's reach.
  useTerminalTabCount();
  const fileTree = useRef<FileTreeHandle>(null);
  const findKey = useShortcut("editor.find");
  // `searchAsk` brings Search's box up.
  const [searchAsk, setSearchAsk] = useState({ id: 0, seed: "" });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Focus goes to a panel once it's rendered: after a view switch or with the panel expanded.
  const [focusTo, setFocusTo] = useState<{ panel: Panel } | null>(null);
  useEffect(() => {
    if (focusTo) focusPanel(focusTo.panel);
  }, [focusTo]);
  // Shows a view, the sidebar opened if it was closed, and puts the keys in it.
  const showView = (v: View) => {
    setView(v);
    sidebars.expand("side");
    setFocusTo({ panel: panelOf(v) });
  };
  // Opening it focuses it, as in VS Code; closing it while it holds focus leaves that to the code view.
  const toggleSidebar = () => {
    if (sidebars.isCollapsed("side")) return showView(view);
    const had = focusedPanel() === panelOf(view);
    sidebars.collapse("side");
    if (had) focusPanel("code");
  };
  const askSearch = (seed: string) => {
    setView("search");
    sidebars.expand("side");
    setSearchAsk((a) => ({ id: a.id + 1, seed }));
  };
  const cycle = (dir: 1 | -1) => {
    const open = PANELS.filter((p) => (p === "git" || p === "explorer" ? sidebarOpen && panelOf(view) === p : p === "terminal" ? terminalOpen : true));
    const at = open.indexOf(focusedPanel() as Panel);
    focusPanel(open[at < 0 ? (dir > 0 ? 0 : open.length - 1) : (at + dir + open.length) % open.length]);
  };
  const revealInExplorer = useCallback((path: string) => {
    sidebars.expand("side");
    setView("explorer");
    // Once the tree shows: a hidden one can't take focus.
    requestAnimationFrame(() => fileTree.current?.reveal(path));
  }, []);
  const showInHistory = useCallback((search: HistorySearch) => {
    setHistorySearch(search);
    setView("history");
    sidebars.expand("side");
  }, []);
  // A commit's own page in History, with `path` open in it when it names one (blame, the terminal).
  const showCommit = useCallback((sha: string, path = "") => showInHistory({ query: sha, scope: null, reveal: { sha, path, id: ++reveals.current } }), [showInHistory]);
  const showHistory = useCallback((path: string, file: boolean) => showInHistory({ ...NO_SEARCH, scope: { path, file } }), [showInHistory]);
  const sideHeader = useRef<HTMLDivElement>(null);
  // Double-clicking the sidebar's edge sizes it to show its header whole, never under its default.
  const fit = () => {
    if (sideHeader.current) sidebars.resize("side", Math.max(SIDES.side.base, headerWidth(sideHeader.current)));
  };

  const changeView = changesView.use();
  const mtimes = useMtimes(status);
  const uncommitted = useMemo(() => (status ? changeList(ordered(status, changeView, mtimes)) : []), [status, changeView, mtimes]);
  // What J/K walk: the list Changes shows.
  const changes: Selection[] = review === null ? uncommitted : branchReview.rows;
  const startReview = () => {
    setReview((r) => r ?? reviewBase(repo.branches) ?? "");
    showView("changes");
  };
  const reviewLabel = shortRef(review || reviewBase(repo.branches) || "") || "a base branch";
  const remoteNames = useMemo(() => new Set(repo.branches.filter((b) => b.remote).map((b) => b.name)), [repo.branches]);

  // A merge/rebase that stopped on conflicts: bring the conflicts into view.
  const conflictCount = status?.conflicted.length ?? 0;
  // A split's stop likewise: its pieces are committed from Changes.
  const splitting = !!status?.operation?.split;
  useEffect(() => {
    if (conflictCount === 0 && !splitting) return;
    setView("changes");
    setReview(null);
  }, [conflictCount, splitting]);

  const prefetch = useCallback((sel: Selection) => prefetchSelection(sel, repo.revision), [repo.revision]);

  // Load the highlighters (and compile their WASM) while the app settles, not on the first file.
  useEffect(() => {
    const t = setTimeout(() => {
      warmHighlighter();
      void prepare("text", s.codeTheme);
    }, 300);
    return () => clearTimeout(t);
    // Once: a theme picked later is loaded when it's applied.
  }, []);

  // Reviewing is sequential: have the neighbours of the open file ready before J/K.
  useEffect(() => {
    const i = changes.findIndex((c) => selectionKey(c) === activeKey);
    if (i < 0) return;
    for (const n of [changes[i + 1], changes[i - 1]]) if (n) prefetchSelection(n, repo.revision);
  }, [changes, activeKey, repo.revision]);

  // J/K walk the changed files, the core loop of reviewing an agent's work; in a stacked view of
  // them (Open All, a guided review), its files.
  const step = (dir: 1 | -1) => {
    if (active?.sel.kind === "changes" || active?.sel.kind === "guide") return stackedView()?.step(dir);
    if (!changes.length) return;
    const i = changes.findIndex((c) => selectionKey(c) === activeKey);
    open(changes[i < 0 ? 0 : Math.min(changes.length - 1, Math.max(0, i + dir))]);
    setView("changes");
  };

  // With focus in the terminal (a pane, its tabs, its find), the tab keys pick its tabs, as in iTerm2.
  // Where focus is now, not the panel it was last in, which may be hidden since. When that side has
  // no such tab, the key goes on (⌘→ to the code view's text).
  const orTerminal = (code: (() => void) | undefined, terminal: (() => void) | undefined) =>
    code || terminal
      ? () => {
          const run = document.activeElement?.closest('[data-panel="terminal"]') ? terminal : code;
          return run ? run() : false;
        }
      : undefined;

  const active = tabs.find((t) => t.key === activeKey) ?? null;
  // From the palette, as quick open: the code view takes the keys, and the stacked view them as it opens.
  const openAll = (all: Selection | ChangeList) => {
    focusPanel("code");
    open(typeof all === "string" ? { kind: "changes", list: all } : all, true);
  };
  // The Compare screen: a request from outside (the branch picker) or the palette; a side not named is the default.
  const openCompare = (sides: { base?: ComparePoint; head?: ComparePoint } = {}) => {
    const start = defaultPoints(repo.branches, status?.branch ?? null);
    focusPanel("code");
    open({ kind: "compare", base: sides.base ?? start.base, head: sides.head ?? start.head, mergeBase: true }, true);
  };
  const ask = useCompareAsk();
  const handled = useRef(ask?.id ?? 0);
  useEffect(() => {
    // One that came before this window opened isn't its own.
    if (!ask || ask.id === handled.current) return;
    handled.current = ask.id;
    openCompare(ask);
  });
  // From a file of a commit or a range on show: the whole of it.
  const shown = active?.sel;
  const ofCommit = shown?.kind === "commit" ? shown : null;
  const ofRange = shown?.kind === "pr-file" ? shown.range : null;
  useCommands({
    "git.compareBranches": () => openCompare(),
    "review.openAllCommit": ofCommit ? () => openAll({ kind: "changes", list: "commit", commit: ofCommit.commit }) : undefined,
    "review.openAllComparison": ofRange ? () => openAll({ kind: "changes", list: "range", range: ofRange }) : undefined,
    "review.nextFile": () => step(1),
    "review.prevFile": () => step(-1),
    "review.branch": startReview,
    // Nested repositories aside, as the Changes list leaves them.
    "review.guideUncommitted": status && uncommitted.length ? () => openGuide({ kind: "guide", of: "changes" }, status, open) : undefined,
    "review.openAll": status?.unstaged.length ? () => openAll("unstaged") : undefined,
    "review.openAllStaged": status?.staged.length ? () => openAll("staged") : undefined,
    "review.openAllBranch": reviewing && branchReview.rows.length ? () => openAll("branch") : undefined,
    "review.copyNotes": () => copyNotes(pendingNotes()),
    "review.sendNotes": () => sendNotes(pendingNotes()),
    "review.toggleViewed": () => {
      const t = tabs.find((x) => x.key === activeKey);
      if (t?.sel.kind === "changes" || t?.sel.kind === "guide") return stackedView()?.toggleViewed();
      // On a staged file this would unstage it; too much for a stray single key.
      if (t && t.sel.kind !== "staged") toggleViewed(t.sel);
    },
    "diff.toggleSplit": () => updateSettings({ sideBySide: !s.sideBySide }),
    "diff.toggleCollapse": () => updateSettings({ hideUnchanged: !s.hideUnchanged }),
    "diff.toggleWhitespace": () => updateSettings({ ignoreWhitespace: !s.ignoreWhitespace }),
    "editor.toggleWrap": () => updateSettings({ wordWrap: !s.wordWrap }),
    "editor.toggleBlame": () => updateSettings({ blame: !s.blame }),
    "editor.fontZoomIn": () => updateSettings({ codeFontSize: s.codeFontSize + 0.5 }),
    "editor.fontZoomOut": () => updateSettings({ codeFontSize: s.codeFontSize - 0.5 }),
    "editor.fontZoomReset": () => updateSettings({ codeFontSize: DEFAULT_FONT_SIZE }),
    "editor.find": find,
    "search.findInFiles": () => askSearch(selectedText()),
    "view.explorer": () => showView("explorer"),
    "view.search": () => askSearch(""),
    "view.changes": () => showView("changes"),
    "view.history": () => showView("history"),
    "history.search": () => {
      setView("history");
      sidebars.expand("side");
      setSearchFocus(true);
    },
    "view.toggleSidebar": toggleSidebar,
    "view.moveSidebar": () => updateSettings({ sidebarSide: s.sidebarSide === "left" ? "right" : "left" }),
    "view.focusGitPanel": () => showView(panelOf(view) === "git" ? view : "changes"),
    "view.showExplorer": () => showView("explorer"),
    "view.focusCode": () => void focusPanel("code"),
    "view.focusNextPanel": () => cycle(1),
    "view.focusPrevPanel": () => cycle(-1),
    "tab.close": activeKey ? () => close(activeKey) : undefined,
    "tab.reopenClosed": canReopen ? reopen : undefined,
    "tab.closeOthers": closeAround("others"),
    "tab.closeLeft": closeAround("left"),
    "tab.closeRight": closeAround("right"),
    "tab.closeAll": closeAround("all"),
    "tab.goto1": orTerminal(goTab(0), goGroup(0)),
    "tab.goto2": orTerminal(goTab(1), goGroup(1)),
    "tab.goto3": orTerminal(goTab(2), goGroup(2)),
    "tab.goto4": orTerminal(goTab(3), goGroup(3)),
    "tab.goto5": orTerminal(goTab(4), goGroup(4)),
    "tab.goto6": orTerminal(goTab(5), goGroup(5)),
    "tab.goto7": orTerminal(goTab(6), goGroup(6)),
    "tab.goto8": orTerminal(goTab(7), goGroup(7)),
    "tab.last": orTerminal(goTab(tabs.length - 1), goGroup(-1)),
    "tab.next": orTerminal(stepTab(1), stepGroup(1)),
    "tab.prev": orTerminal(stepTab(-1), stepGroup(-1)),
    "file.reveal": () => revealInFinder(active?.sel),
    "file.revealInExplorer": active && onDisk(active.sel) ? () => revealInExplorer(selectionPath(active.sel)) : undefined,
    "repo.refresh": () => repo.refresh(),
    "workbench.quickOpen": () => showQuickOpen(),
    "workbench.openChange": uncommitted.length ? () => showQuickOpen("changes") : undefined,
    "terminal.newInProject": projects.length ? () => showQuickOpen("projects") : undefined,
  });

  // Quick open's picks take the code view along, where a new tab then takes focus (MonacoView).
  useQuickOpenSource({
    root,
    changes: uncommitted,
    projects,
    openFile: (path) => {
      focusPanel("code");
      open({ kind: "file", path }, true);
    },
    openChange: (change) => {
      focusPanel("code");
      open(change, true);
      setView("changes");
    },
  });

  // A tab switched to from the code view keeps the keys there (the view it replaced took focus along).
  useEffect(() => {
    if (codeWantsFocus()) focusPanel("code");
  }, [activeKey]);

  // A search result's reveal waits for its own file only: any other tab shown drops it, so it
  // can't land on a later visit (a file too large to show never takes it).
  useEffect(() => {
    const t = tabs.find((x) => x.key === activeKey);
    if (t?.sel.kind !== "file" || !revealWaits(t.sel.path)) dropReveal();
    // On a tab switch, not on every tab list change.
  }, [activeKey]);

  // ⌘-click in the code view and the terminal opens files here (lib/links/linkHost). After the
  // effect above: a file waiting for this workspace (`gitviber a.ts:12`) opens as it mounts, and
  // the first run above would drop its line.
  useEffect(() => {
    setLinkHost({
      root,
      worktrees: repo.worktrees.map((w) => w.path),
      revision: repo.revision,
      open: (path, focus) => {
        open({ kind: "file", path }, true);
        if (focus) focusPanel("code");
      },
      // A file opened from the terminal is picked in the explorer too; a closed explorer stays closed.
      reveal: (path, show) => {
        if (show) revealInExplorer(path);
        else if (!sidebars.isCollapsed("side")) fileTree.current?.reveal(path, false);
      },
      showCommit,
    });
  }, [root, repo.worktrees, repo.revision, open, revealInExplorer, showCommit]);
  useEffect(() => () => setLinkHost(null), []);

  const changeCount = uncommitted.length;

  return (
    <div className="flex h-full flex-col">
      <TopBar
        repo={repo}
        root={root}
        main={main}
        onOpenRepo={onOpenRepo}
      />
      <div className={cn("relative flex min-h-0 flex-1", s.sidebarSide === "right" && "flex-row-reverse")}>
        <RepoRail
          repo={repo}
          root={root}
          main={main}
          recent={recent}
          side={s.sidebarSide}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
          onOpenRepo={onOpenRepo}
          onForgetRepo={onForgetRepo}
          onLocateRepo={onLocateRepo}
        />
        <div className="relative min-w-0 flex-1">
        {/* The library finds a divider by where the pointer is: under the maximized terminal, the hidden ones would still drag. */}
        <ResizablePanelGroup {...sidebars.group} disabled={terminalMaximized}>
          {/* Keyed, so docking the sidebar on the other side moves the panels instead of remounting them. */}
          {[
            <ResizablePanel key="side" id="side" {...sidebars.panel("side")} onResize={(size) => setSidebarOpen(size.inPixels > 0)}>
              <div className="relative flex h-full flex-col bg-panel glass-panel">
                <PanelHeader
                  ref={sideHeader}
                  selected={view}
                  tabs={
                    <>
                      <ListTabButton active={view === "explorer"} onClick={() => setView("explorer")}>
                        Explorer
                      </ListTabButton>
                      <ListTabButton active={view === "search"} onClick={() => askSearch("")}>
                        Search
                      </ListTabButton>
                      <ListTabButton active={view === "changes"} onClick={() => setView("changes")} count={changeCount}>
                        Changes
                      </ListTabButton>
                      <ListTabButton active={view === "history"} onClick={() => setView("history")}>
                        History
                      </ListTabButton>
                    </>
                  }
                >
                  {view === "explorer" && (
                    <>
                      <Tip label="Filter files" shortcut={findKey}>
                        <button aria-label="Filter files" onClick={() => fileTree.current?.filter()} className="flex size-6 items-center justify-center rounded-sm text-subtle hover:bg-hover focus-visible:bg-hover hover:text-foreground focus-visible:text-foreground">
                          <Search className="size-3.5" />
                        </button>
                      </Tip>
                      <Tip label="Collapse folders">
                        <button aria-label="Collapse folders" onClick={() => fileTree.current?.collapseAll()} className="flex size-6 items-center justify-center rounded-sm text-subtle hover:bg-hover focus-visible:bg-hover hover:text-foreground focus-visible:text-foreground">
                          <ChevronsDownUp className="size-3.5" />
                        </button>
                      </Tip>
                    </>
                  )}
                  {view === "changes" && !reviewing && <ChangesViewMenu />}
                  {view === "changes" && (
                    <Tip label={reviewing ? "Back to uncommitted changes" : `Review branch against ${reviewLabel}`}>
                      <button
                        aria-label={reviewing ? "Back to uncommitted changes" : "Review branch"}
                        aria-pressed={reviewing}
                        onClick={reviewing ? () => setReview(null) : startReview}
                        className={cn(
                          "flex size-6 items-center justify-center rounded-sm text-subtle hover:bg-hover focus-visible:bg-hover hover:text-foreground focus-visible:text-foreground",
                          reviewing && "bg-active text-foreground",
                        )}
                      >
                        <GitCompareArrows className="size-3.5" />
                      </button>
                    </Tip>
                  )}
                </PanelHeader>
                {/* Each half is one focus target (lib/ui/panels), shown while one of its views is. */}
                <div data-panel="git" tabIndex={-1} className={cn("group/panel relative min-h-0 flex-1 flex-col outline-none", panelOf(view) === "git" ? "flex" : "hidden")}>
                  <FocusLine />
                  <div className="min-h-0 flex-1">
                    {reviewing && (
                      <BranchReview
                        base={review}
                        data={branchReview}
                        branches={repo.branches}
                        activeKey={activeKey}
                        onOpen={open}
                        onHover={prefetch}
                        viewed={viewed}
                        setViewed={setViewed}
                        onBase={setReview}
                        onGuide={(base) => openGuide({ kind: "guide", of: "branch", base, label: shortRef(base) }, status, open)}
                        onClose={() => setReview(null)}
                      />
                    )}
                    {seenTabs.has("changes") && status && (
                      <KeptPanel shown={view === "changes" && review === null}>
                        <ChangesPanel status={status} activeKey={activeKey} onOpen={open} onHover={prefetch} refresh={() => repo.refresh(false)} viewed={viewed} setViewed={setViewed} onRevealInExplorer={revealInExplorer} onShowHistory={(path) => showHistory(path, true)} mtimes={mtimes} />
                      </KeptPanel>
                    )}
                    {seenTabs.has("history") && (
                      <KeptPanel shown={view === "history"}>
                        <SearchableHistory
                          main={main}
                          revision={repo.revision}
                          search={historySearch}
                          onSearch={setHistorySearch}
                          focusRequested={searchFocus}
                          onFocused={searchFocused}
                          commits={repo.commits}
                          branches={repo.branches}
                          status={status}
                          remotes={remoteNames}
                          hasMore={repo.hasMore}
                          loadMore={repo.loadMore}
                          refresh={() => repo.refresh()}
                          activeKey={activeKey}
                          onOpen={open}
                          onHover={prefetch}
                          worktrees={repo.worktrees}
                          onOpenRepo={onOpenRepo}
                        />
                      </KeptPanel>
                    )}
                  </div>
                </div>
                <div data-panel="explorer" tabIndex={-1} className={cn("group/panel relative min-h-0 flex-1 flex-col outline-none", panelOf(view) === "explorer" ? "flex" : "hidden")}>
                  <FocusLine />
                  {/* Both stay mounted, so each keeps its state (open folders, results) while the other shows. */}
                  <div className={cn("min-h-0 flex-1", view !== "search" && "hidden")}>
                    <SearchView
                      active={view === "search"}
                      ask={searchAsk}
                      onOpen={open}
                      onLeave={() => {
                        setView("explorer");
                        // After the render that shows the tree: focusPanel skips a hidden one.
                        requestAnimationFrame(() => focusPanel("explorer"));
                      }}
                    />
                  </div>
                  <div className={cn("min-h-0 flex-1", view !== "explorer" && "hidden")}>
                    <FileTree
                      ref={fileTree}
                      status={status}
                      revision={repo.revision}
                      activeKey={activeKey}
                      onOpen={open}
                      onHover={prefetch}
                      onPathMoved={onPathMoved}
                      onShowHistory={showHistory}
                    />
                  </div>
                </div>
              </div>
            </ResizablePanel>,
            <ResizableHandle key="handle" className="bg-border" disableDoubleClick onDoubleClick={fit} />,
            <ResizablePanel key="viewer" id="viewer" {...sidebars.flex}>
              <ResizablePanelGroup {...bottom.group} disabled={terminalMaximized}>
                <ResizablePanel id="editor" {...bottom.flex}>
                  {/* Esc from the view itself (a PR, an image) or the code, when Monaco had no use for it. */}
                  <div
                    data-panel="code"
                    tabIndex={-1}
                    onKeyDown={(e) => {
                      const target = e.target as HTMLElement;
                      if (e.key === "Escape" && (target === e.currentTarget || target.matches(".monaco-editor textarea.inputarea, [data-code-scroll]"))) focusList();
                    }}
                    className="group/panel relative h-full outline-none"
                  >
                    <FocusLine />
                    <Viewer
                      root={root}
                      tabs={tabs}
                      active={active}
                      status={status}
                      branchRows={branchReview.review && branchReview.rows}
                      branches={repo.branches}
                      revision={repo.revision}
                      viewed={viewed}
                      toggleViewed={toggleViewed}
                      onActivate={setActiveKey}
                      onClose={close}
                      onCloseTabs={closeTabs}
                      refresh={repo.refresh}
                      onPin={pin}
                      onMoveTab={moveTab}
                      onOpen={(sel, pin = true) => open(sel, pin)}
                      onUpdate={update}
                      onShowHistory={(path) => showHistory(path, true)}
                      onRevealInExplorer={revealInExplorer}
                      onShowCommit={showCommit}
                    />
                  </div>
                </ResizablePanel>
                {/* Rendered only while open, so the viewer keeps its state when the panel toggles. */}
                {terminalOpen && (
                  <>
                    <ResizableHandle className="bg-border" disableDoubleClick onDoubleClick={() => bottom.resize("terminal", BOTTOM.terminal.base)} />
                    <ResizablePanel id="terminal" {...bottom.panel("terminal")}>
                      {/* Maximized, it covers the workspace, which stays mounted beneath: nothing reloads on the way back. */}
                      <div data-panel="terminal" className={cn("group/panel h-full", terminalMaximized ? "absolute inset-0 z-40" : "relative")}>
                        <FocusLine />
                        <TerminalPanel root={root} worktrees={repo.worktrees} projects={projects} />
                      </div>
                    </ResizablePanel>
                  </>
                )}
              </ResizablePanelGroup>
            </ResizablePanel>,
          ][s.sidebarSide === "left" ? "slice" : "reverse"]()}
        </ResizablePanelGroup>
        </div>
      </div>
      <StatusBar repo={repo} reviewed={uncommitted.filter(viewed).length} active={active?.sel} />
      <TerminalRestoreOffer />
    </div>
  );
}

/** Marks the panel the keys go to: a thin accent along its top while focus is inside. */
function FocusLine() {
  return <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px bg-primary opacity-0 group-focus-within/panel:opacity-100" />;
}

/** The open file's working copy, else the repository's folder (a PR or an issue has no file). */
function revealInFinder(sel: Selection | undefined) {
  const path = sel && ["file", "unstaged", "staged", "conflict", "branch"].includes(sel.kind) ? selectionPath(sel) : "";
  void revealPath(path);
}
