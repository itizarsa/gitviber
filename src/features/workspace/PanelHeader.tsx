import type { ReactNode, RefObject } from "react";
import { CountBadge } from "@/components/CountBadge";
import { useTabStrip } from "@/lib/ui/useTabStrip";
import { cn } from "@/lib/utils";

/**
 * A sidebar's header: its tabs scroll sideways when the panel is too narrow for them, rather than
 * the whole panel, and its buttons stay put on the right. headerWidth measures it.
 */
export function PanelHeader({ ref, selected, tabs, children }: { ref: RefObject<HTMLDivElement | null>; selected: string; tabs: ReactNode; children: ReactNode }) {
  const strip = useTabStrip<HTMLDivElement>(selected);
  return (
    <div ref={ref} className="flex h-9 shrink-0 items-center border-b border-border pr-1 pl-2">
      <div ref={strip.ref} onWheel={strip.onWheel} data-scrollbar="none" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {tabs}
      </div>
      {/* One group: CollapseButton's own ml-auto would split the free space. Padded, not a gap:
          headerWidth measures from its edge. */}
      <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-0.5">{children}</div>
    </div>
  );
}

export function ListTabButton({ active, onClick, count, children }: { active: boolean; onClick: () => void; count?: number; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] font-medium",
        active ? "bg-active text-foreground" : "text-subtle hover:text-foreground focus-visible:text-foreground",
      )}
    >
      {children}
      {!!count && <CountBadge active={active}>{count}</CountBadge>}
    </button>
  );
}
