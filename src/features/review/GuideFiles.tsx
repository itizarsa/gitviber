import { Check, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { FileIcon, FolderIcon } from "@/components/FileIcon";
import { StatusLetter } from "@/components/StatusBadge";
import { pathTree } from "@/lib/ui/pathTree";
import { cn } from "@/lib/utils";
import type { ListFile } from "@/features/viewer/StackedFiles";

/**
 * The guide's changed files as a folder tree, under its sections: a click goes to the file's
 * diff. Viewed ones are ticked, as in Changes. Folders fold for the tab's life.
 */
export function GuideFiles({ files, viewed, onGo }: { files: ListFile[]; viewed: (f: ListFile) => boolean; onGo: (f: ListFile) => void }) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => pathTree(files, (f) => f.file.path, { closed: (p) => closed.has(p) }), [files, closed]);
  const fold = (path: string) =>
    setClosed((now) => {
      const next = new Set(now);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const indent = (depth: number) => ({ paddingLeft: 6 + depth * 12 });
  return (
    <section aria-label="Files" className="mt-3 border-t border-border pt-2">
      <h2 className="mb-1 flex items-center gap-1.5 px-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-subtle uppercase">
        Files <span className="font-mono text-muted-foreground">{files.length}</span>
      </h2>
      <div role="tree" aria-label="Changed files">
        {rows.map((r) =>
          r.kind === "folder" ? (
            <button
              key={`d:${r.path}`}
              role="treeitem"
              aria-expanded={r.open}
              onClick={() => fold(r.path)}
              title={r.path}
              style={indent(r.depth)}
              className="flex h-6 w-full min-w-0 items-center gap-1 rounded-sm pr-1.5 text-left text-[12px] text-muted-foreground outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring"
            >
              <ChevronRight className={cn("size-3 shrink-0 text-subtle transition-transform duration-100", r.open && "rotate-90")} />
              <FolderIcon name={r.path.slice(r.path.lastIndexOf("/") + 1)} open={r.open} />
              <span className="min-w-0 truncate">{r.label}</span>
            </button>
          ) : (
            <button
              key={`f:${r.item.file.path}`}
              role="treeitem"
              onClick={() => onGo(r.item)}
              title={r.item.file.path}
              // A file at the top level lines up with folders' names, past their chevron.
              style={indent(r.depth + 1)}
              className={cn(
                "flex h-6 w-full min-w-0 items-center gap-1.5 rounded-sm pr-1.5 text-left text-[12px] outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring",
                viewed(r.item) && "text-muted-foreground",
              )}
            >
              <FileIcon path={r.item.file.path} />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              {viewed(r.item) && (
                <>
                  <Check aria-hidden className="size-3 shrink-0 text-added" />
                  <span className="sr-only">, viewed</span>
                </>
              )}
              <StatusLetter status={r.item.file.status} className="shrink-0" />
            </button>
          ),
        )}
      </div>
    </section>
  );
}
