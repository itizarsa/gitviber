import { Copy, FolderOpen, FolderSearch, PanelLeft, PanelLeftDashed, PanelRight, PanelRightDashed, Plus, Settings2, SquareTerminal, X } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Tip } from "@/components/ui/tooltip";
import { useAsyncValue } from "@/hooks/useAsyncValue";
import { api } from "@/lib/api";
import { copyText } from "@/lib/app/clipboard";
import { revealProject } from "@/lib/app/openIn";
import { useCommands, useShortcut } from "@/lib/commands/keybindings";
import { useWorktreeColors } from "@/lib/git/worktreeColors";
import { hueColor, worktreeHues, worktreeName } from "@/lib/git/worktrees";
import { folderName } from "@/lib/path";
import { REVEAL_LABEL } from "@/lib/platform";
import type { RepoData } from "@/lib/repo/useRepo";
import { openTerminal, togglePanel, useTerminalsOpen } from "@/lib/terminal/terminals";
import { cn } from "@/lib/utils";
import { changeTotals } from "@/features/changes/changeList";
import { openSettings } from "@/features/settings/SettingsDialog";

/** What the rail holds besides the repositories: nothing, the window's toggles at its foot, or the open repo's worktrees under it. */
export type RailStyle = "plain" | "actions" | "worktrees";

interface Props {
  style: RailStyle;
  repo: RepoData;
  /** The worktree open in the window. */
  root: string;
  /** The main worktree: the project this window belongs to. */
  main: string;
  recent: string[];
  side: "left" | "right";
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenRepo: (path?: string) => Promise<unknown>;
  onForgetRepo: (path: string) => void;
  onLocateRepo: (path: string) => void;
}

/**
 * The saved repositories as a column of tiles at the window's edge, beside the sidebar: one click
 * opens one, the tooltip names it, right-click has the rest.
 */
export function RepoRail({ style, repo, root, main, recent, side, sidebarOpen, onToggleSidebar, onOpenRepo, onForgetRepo, onLocateRepo }: Props) {
  const openKey = useShortcut("file.openRepo");
  const info = useAsyncValue(
    async () => {
      const all = await api.projectInfo(recent);
      return new Map(recent.map((p, i) => [p, all[i]]));
    },
    [recent.join("\n")],
    new Map<string, { exists: boolean }>(),
  );
  // Switch Project (the palette) puts the keys on the open repo's tile.
  useCommands({ "file.switchProject": () => document.querySelector<HTMLElement>('[data-repo-rail] [aria-current="true"]')?.focus() });
  const totals = changeTotals(repo);
  const colors = useWorktreeColors();
  const linked = repo.worktrees.filter((w) => !w.main && !w.bare && !w.prunable);
  const hues = worktreeHues(repo.worktrees, colors);
  return (
    <nav data-repo-rail aria-label="Repositories" className={cn("flex w-12 shrink-0 flex-col items-center gap-1.5 bg-sidebar glass-sidebar pb-2", side === "left" ? "border-r" : "border-l", "border-border")}>
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-1 pt-1.5 pb-1" data-scrollbar="none">
        {recent.map((p) => {
          const name = folderName(p);
          const current = p === main;
          const missing = info.get(p)?.exists === false;
          return (
            <div key={p} className="flex flex-col items-center gap-1">
              <ContextMenu>
                <Tip label={missing ? `${name} — folder not found` : `${name}${current && totals.files ? ` · ${totals.files} changed` : ""}`} side={side === "left" ? "right" : "left"}>
                  <ContextMenuTrigger asChild>
                    <button
                      aria-label={name}
                      aria-current={current}
                      onClick={() => (missing ? onLocateRepo(p) : !(current && root === main) && void onOpenRepo(p))}
                      className={cn(
                        "relative flex size-8 shrink-0 items-center justify-center rounded-md text-[13px] font-bold text-black/80 uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        current ? "ring-2 ring-primary ring-offset-2 ring-offset-sidebar" : "opacity-80 hover:opacity-100",
                        missing && "opacity-40",
                      )}
                      style={{ background: tileColor(name) }}
                    >
                      {name.slice(0, 2)}
                      {current && totals.files > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-modified px-1 font-mono text-[9.5px] font-semibold text-white">{totals.files}</span>
                      )}
                    </button>
                  </ContextMenuTrigger>
                </Tip>
                <ContextMenuContent>
                  <ContextMenuItem disabled={current && root === main} onSelect={() => (missing ? onLocateRepo(p) : void onOpenRepo(p))}>
                    <FolderOpen /> {missing ? "Locate…" : "Open"}
                  </ContextMenuItem>
                  <ContextMenuItem disabled={missing} onSelect={() => openTerminal(current ? root : p)}>
                    <SquareTerminal /> New Terminal
                  </ContextMenuItem>
                  <ContextMenuItem disabled={missing} onSelect={() => revealProject(p)}>
                    <FolderSearch /> {REVEAL_LABEL}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => copyText(p, "Path copied")}>
                    <Copy /> Copy Path
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem disabled={current} onSelect={() => onForgetRepo(p)}>
                    <X /> Remove from List
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {/* The open repo's linked worktrees, each a dot in its own color: one click opens it. */}
              {style === "worktrees" &&
                current &&
                linked.map((w) => {
                  const hue = hues.get(w.path) ?? null;
                  const here = w.path === root;
                  return (
                    <Tip key={w.path} label={`Worktree ${worktreeName(w)}`} side={side === "left" ? "right" : "left"}>
                      <button
                        aria-label={`Worktree ${worktreeName(w)}`}
                        onClick={() => !here && void onOpenRepo(w.path)}
                        className={cn("flex h-5 w-8 items-center justify-center rounded-sm hover:bg-hover", here && "bg-active")}
                      >
                        <span className="size-2.5 rounded-full" style={{ background: hue ? hueColor(hue) : "var(--subtle)" }} />
                      </button>
                    </Tip>
                  );
                })}
            </div>
          );
        })}
        <Tip label="Open repository…" shortcut={openKey} side={side === "left" ? "right" : "left"}>
          <button aria-label="Open repository" onClick={() => void onOpenRepo()} className="flex size-8 shrink-0 items-center justify-center rounded-md border border-dashed border-border-strong text-subtle hover:text-foreground">
            <Plus className="size-4" />
          </button>
        </Tip>
      </div>
      {style === "actions" && <RailActions root={root} side={side} sidebarOpen={sidebarOpen} onToggleSidebar={onToggleSidebar} />}
    </nav>
  );
}

/** The window's toggles, moved from the top bar to the rail's foot. */
function RailActions({ root, side, sidebarOpen, onToggleSidebar }: { root: string; side: "left" | "right"; sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const terminalOpen = useTerminalsOpen();
  const tip = side === "left" ? "right" : "left";
  const button = "flex size-8 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground";
  const Sidebar = side === "left" ? (sidebarOpen ? PanelLeft : PanelLeftDashed) : sidebarOpen ? PanelRight : PanelRightDashed;
  return (
    <div className="flex flex-col items-center gap-1 border-t border-border pt-2">
      <Tip label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} shortcut={useShortcut("view.toggleSidebar")} side={tip}>
        <button aria-label="Toggle sidebar" onClick={onToggleSidebar} className={cn(button, sidebarOpen && "text-foreground")}>
          <Sidebar className="size-4" />
        </button>
      </Tip>
      <Tip label={terminalOpen ? "Hide terminal" : "Show terminal"} shortcut={useShortcut("terminal.toggle")} side={tip}>
        <button aria-label="Toggle terminal" onClick={() => togglePanel(root)} className={cn(button, terminalOpen && "text-foreground")}>
          <SquareTerminal className="size-4" />
        </button>
      </Tip>
      <Tip label="Settings" shortcut={useShortcut("workbench.openSettings")} side={tip}>
        <button aria-label="Settings" onClick={() => openSettings()} className={button}>
          <Settings2 className="size-4" />
        </button>
      </Tip>
    </div>
  );
}

/** The project list's tile color, from the name. */
function tileColor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 62%)`;
}
