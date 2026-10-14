import { ChevronDown, ChevronRight, FolderDown, Plus } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { useCommands, useShortcut } from "@/lib/commands/keybindings";
import type { RepoData } from "@/lib/repo/useRepo";
import { folderName } from "@/lib/path";
import { readJson, writeJson } from "@/lib/storage";
import { createStore } from "@/lib/store";
import { openTerminal } from "@/lib/terminal/terminals";
import { cn } from "@/lib/utils";
import { openClone } from "@/features/projects/CloneDialog";
import { ProjectList } from "@/features/projects/ProjectList";

const COLLAPSED_KEY = "gitviber.sidebar.reposCollapsed";
const collapsed = createStore(readJson<boolean>(COLLAPSED_KEY, false, (v): v is boolean => typeof v === "boolean"));
const setCollapsed = (on: boolean) => {
  collapsed.set(on);
  writeJson(COLLAPSED_KEY, on);
};

export interface RepoSectionProps {
  repo: RepoData;
  /** The worktree open in the window. */
  root: string;
  /** The main worktree: the project this window belongs to, even inside a linked worktree. */
  main: string;
  recent: string[];
  onOpenRepo: (path?: string) => Promise<unknown>;
  onForgetRepo: (path: string) => void;
  onReorderRepos: (list: string[]) => void;
  onLocateRepo: (path: string) => void;
}

/**
 * The saved repositories at the top of the sidebar: one click opens one. Drag to reorder; the
 * right-click menu and the row's buttons are the project list's. Folds to its header.
 */
export function RepoSection({ repo, root, main, recent, onOpenRepo, onForgetRepo, onReorderRepos, onLocateRepo }: RepoSectionProps) {
  const closed = collapsed.use();
  const openKey = useShortcut("file.openRepo");
  // Switch Project (the palette) unfolds the list and puts the keys on the open repo's row.
  useCommands({
    "file.switchProject": () => {
      setCollapsed(false);
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-repo-section] [data-project][tabindex="0"]')?.focus());
    },
  });
  // This project's row opens where + does: the worktree the window is in.
  const terminal = (p: string) => openTerminal(p === main ? root : p);
  const away = root === main ? undefined : { folder: folderName(root), mainBranch: repo.worktrees.find((w) => w.main)?.branch ?? null };
  const button = "flex size-6 items-center justify-center rounded-sm text-subtle hover:bg-hover focus-visible:bg-hover hover:text-foreground focus-visible:text-foreground";
  return (
    <div data-repo-section className={cn("flex shrink-0 flex-col border-b border-border", !closed && "max-h-[40%]")}>
      <div className="flex h-8 shrink-0 items-center pr-1 pl-1.5">
        <button
          onClick={() => setCollapsed(!closed)}
          aria-expanded={!closed}
          className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-sm px-1 text-[10.5px] font-semibold tracking-[0.08em] text-subtle uppercase hover:text-foreground focus-visible:text-foreground"
        >
          {closed ? <ChevronRight className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}
          <span className="truncate">Repositories</span>
          {closed && <span className="ml-1 truncate font-normal tracking-normal normal-case">{folderName(main)}</span>}
        </button>
        <Tip label="Open repository…" shortcut={openKey}>
          <button aria-label="Open repository" onClick={() => void onOpenRepo()} className={button}>
            <Plus className="size-3.5" />
          </button>
        </Tip>
        <Tip label="Clone repository…">
          <button aria-label="Clone repository" onClick={() => openClone()} className={button}>
            <FolderDown className="size-3.5" />
          </button>
        </Tip>
      </div>
      {!closed && (
        <div className="min-h-0 overflow-x-hidden overflow-y-auto px-1 pb-1">
          <ProjectList compact recent={recent} current={main} away={away} onOpen={(p) => void onOpenRepo(p)} onForget={onForgetRepo} onReorder={onReorderRepos} onLocate={onLocateRepo} onTerminal={terminal} />
        </div>
      )}
    </div>
  );
}
