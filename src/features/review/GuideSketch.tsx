import { DoorClosedLocked, DoorOpen, Radar } from "lucide-react";
import type { Danger, Sketch, SketchKind, Stat } from "@/lib/review/guide";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<SketchKind, string> = {
  pseudocode: "Pseudocode",
  calls: "Call tree",
  components: "Component tree",
  files: "File tree",
  diff: "What changes",
};

/** A sketch's line's color: a diff's added and removed lines, as the diffs show them. */
const tone = (kind: SketchKind, l: string) => (kind !== "diff" ? "" : l.startsWith("+") ? "bg-added/10 text-added" : l.startsWith("-") ? "bg-removed/10 text-removed" : "text-muted-foreground");

/** The smallest view of the change the agent drew (pseudocode, a call, component or file tree, or one of those as a diff), under the overview. */
export function GuideSketch({ sketch }: { sketch: Sketch }) {
  const lines = sketch.text.split("\n");
  return (
    <figure className="mt-3 min-w-0">
      <figcaption className="mb-1 text-[11px] font-medium tracking-[0.04em] text-subtle uppercase">{KIND_LABEL[sketch.kind]}</figcaption>
      <pre aria-label={KIND_LABEL[sketch.kind]} className="overflow-x-auto rounded-md border border-border bg-panel py-2 font-mono text-[12px] leading-[1.55] select-text">
        {lines.map((l, i) => (
          <div key={i} className={cn("px-3 whitespace-pre", tone(sketch.kind, l))}>
            {l || " "}
          </div>
        ))}
      </pre>
    </figure>
  );
}

/** Whether merging can be walked back, and how far a mistake would reach. */
export function GuideDanger({ danger }: { danger: Danger }) {
  const oneWay = danger.door === "one-way";
  const Door = oneWay ? DoorClosedLocked : DoorOpen;
  return (
    <section aria-label="Merge danger" className="mt-3 rounded-md border border-border px-3 py-2 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-[11px] font-medium tracking-[0.04em] text-subtle uppercase">Merge danger</span>
        <span
          title={oneWay ? "Hard to walk back: reverting the commit won't undo it" : "Can be walked back: reverting the commit undoes it"}
          className={cn("inline-flex items-center gap-1.5", oneWay ? "font-medium text-destructive" : "text-added")}
        >
          <Door aria-hidden className="size-3.5 shrink-0" />
          {oneWay ? "One-way door" : "Two-way door"}
        </span>
        {danger.blast && (
          <span title="How far a mistake would reach" className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Radar aria-hidden className="size-3.5 shrink-0" />
            Blast radius: <span className="text-foreground">{danger.blast}</span>
          </span>
        )}
      </div>
      {(danger.why || danger.reach) && (
        <p className="mt-1 text-muted-foreground select-text">{[danger.why, danger.reach].filter(Boolean).join(" ")}</p>
      )}
    </section>
  );
}

const TONE: Record<Stat["tone"], string> = { good: "text-added", bad: "text-removed", neutral: "text-foreground" };

/**
 * The change at a glance, under the guide's title: how many of the diagram's parts it adds, alters
 * and removes (counted here, never asked for), then the agent's numbers for its effect.
 */
export function GuideStats({ counts, stats }: { counts: { new: number; changed: number; removed: number }; stats: Stat[] }) {
  const parts = [
    { n: counts.new, sign: "+", word: "new", tone: "text-added" },
    { n: counts.changed, sign: "~", word: "changed", tone: "text-modified" },
    { n: counts.removed, sign: "−", word: "removed", tone: "text-removed" },
  ].filter((p) => p.n > 0);
  if (!parts.length && !stats.length) return null;
  const chip = "inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-panel px-2.5 text-[11.5px]";
  return (
    <ul aria-label="The change at a glance" className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {parts.length > 0 && (
        <li className={chip} title="Parts of the diagram the change adds, alters and removes">
          {parts.map((p) => (
            <span key={p.word} className={cn("font-mono font-semibold", p.tone)}>
              {p.sign}
              {p.n} <span className="font-sans font-normal text-muted-foreground">{p.word}</span>
            </span>
          ))}
        </li>
      )}
      {stats.map((s, i) => (
        <li key={i} className={chip}>
          <span className="text-muted-foreground">{s.label}</span>
          <span className={cn("font-mono font-semibold", TONE[s.tone])}>{s.value}</span>
        </li>
      ))}
    </ul>
  );
}
