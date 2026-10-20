import { Baby, Bug, CodeXml, LoaderCircle, RotateCw, Sparkles, Square, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { PageFind } from "@/components/FindBox";
import { Button } from "@/components/ui/button";
import { api, type RepoStatus } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { programOf, reviewAgent } from "@/lib/git/suggest";
import { type ChangesSelection, type GuideSelection, type Selection, selectionKey } from "@/lib/repo/selection";
import { type Category, type GuideSection, type GuideStyle, matchPath, parseGuide, partCounts, placeFiles, sideOf } from "@/lib/review/guide";
import { Tip } from "@/components/ui/tooltip";
import { EMPTY_TREE } from "@/lib/git/refs";
import { type HandoffAbout, isCheckedOut } from "@/lib/review/handoff";
import { parseRisks, type Risk } from "@/lib/review/risks";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { BranchChange } from "@/features/changes/BranchReview";
import { Mermaid } from "@/features/viewer/markdown/Mermaid";
import { type Annotations, type ListFile, useStackedFiles } from "@/features/viewer/StackedFiles";
import { useFixedFiles } from "@/features/viewer/fixedFiles";
import type { Ask } from "./askAgent";
import { AskAgentButton } from "./AskAgentButton";
import { cancelGuide, cancelRisks, findRisks, generateGuide, guideId, markDone, useGuide, useRisks } from "./guides";
import { guideCopy } from "./guideCopy";
import { GuideRisks, RisksRun } from "./GuideRisks";
import { GuideDiagram } from "./GuideDiagram";
import { CATEGORY_UI } from "./categories";
import { CategoryFilter, GuideNav } from "./GuideNav";
import { GuideFiles } from "./GuideFiles";
import { GuideDanger, GuideRollout, GuideSketch, GuideStats, GuideUnknowns } from "./GuideSketch";
import { GuideMarkdown, Notice, SectionRow } from "./GuideSection";

// No files to read before a branch's guide says which range it read: a list useFixedFiles leaves be.
const NO_FILES: ChangesSelection = { kind: "changes", list: "unstaged" };
const OTHER: GuideSection = { title: "Other changes", category: "other", summary: "In no section of the guide.", files: [], check: "", risk: "", was: "", now: "", importance: "medium", fileNotes: [], lineNotes: [] };
// The category each guide shows, and whether only its high importance sections, by guide id, until GitViber quits.
interface Filter {
  category: Category | null;
  high: boolean;
}
const ALL: Filter = { category: null, high: false };
const filters = new Map<string, Filter>();

interface Props {
  sel: GuideSelection;
  status: RepoStatus | null;
  /** The branch review's files as last loaded; null while there's none. */
  branchRows: BranchChange[] | null;
  revision: number;
  viewed: (sel: Selection) => boolean;
  toggleViewed: (sel: Selection) => void;
  onOpen: (s: Selection, pin?: boolean) => void;
}

/**
 * A commit or branch explained by the user's agent CLI, kept once written: an overview and a
 * diagram of the changed parts, then a row a section in reading order, its prose beside its files'
 * diffs (a stacked diff, drawn only near the screen), each with a reviewed mark.
 */
export function GuideView({ sel, status, branchRows, revision, viewed, toggleViewed, onOpen }: Props) {
  const settings = useSettings();
  const program = programOf(reviewAgent(settings).command);
  const branch = status?.branch ?? null;
  const root = status?.root ?? "";
  const id = guideId(root, sel, branch);
  const { saved, run } = useGuide(id);
  const guide = useMemo(() => (saved ? parseGuide(saved.text) : null), [saved]);
  const risksOf = useRisks(id);
  const risks = useMemo(() => (risksOf.saved ? parseRisks(risksOf.saved.text) : null), [risksOf.saved]);
  const stamp = useChangesStamp(sel.of === "changes", revision);
  // Whether what a run read is behind.
  const movedFrom = (read: { head: string; stamp?: string }) => {
    if (sel.of === "changes") return !!stamp && !!read.stamp && read.stamp !== stamp;
    // status.head is HEAD's short id.
    if (sel.of === "branch") return !!status?.head && !read.head.startsWith(status.head);
    return false;
  };
  const moved = saved && movedFrom(saved);
  const copy = guideCopy(sel, branch);

  // The files as Open All reads them: the commit's, or the range the guide read.
  const base = saved?.base;
  const head = saved?.head;
  const changes = useMemo<ChangesSelection>(
    () =>
      !base || !head
        ? NO_FILES
        : sel.of === "commit"
          ? { kind: "changes", list: "commit", commit: sel.commit }
          : sel.of === "commits"
            ? { kind: "changes", list: "range", range: { base, head, label: `${sel.oldest.shortSha}^..${sel.newest.shortSha}` } }
            : sel.of === "changes"
              ? // `head` is a snapshot's tree, which reads back as a commit's would.
                { kind: "changes", list: "range", range: { base, head, label: "Uncommitted" } }
              : { kind: "changes", list: "range", range: { base, head, label: `${sel.label}...${head.slice(0, 7)}` } },
    [sel, base, head],
  );
  const fixed = useFixedFiles(changes);
  // Each file as the tabs it opens have it, and as viewed marks key it.
  const byPath = useMemo(() => {
    const files = (fixed.files ?? []).flatMap<ListFile>((file) =>
      changes.list === "commit" ? [{ kind: "commit", commit: changes.commit, file }] : changes.list === "range" ? [{ kind: "pr-file", range: changes.range, file }] : [],
    );
    return new Map(files.map((f) => [f.file.path, f]));
  }, [fixed.files, changes]);
  const placed = useMemo(() => (guide && fixed.files ? placeFiles(guide, [...byPath.keys()]) : null), [guide, fixed.files, byPath]);
  const titles = useMemo(() => guide?.sections.map((s) => s.title) ?? [], [guide]);
  // The agent's notes, by the changed file they're on.
  const annotations = useMemo(() => {
    const at = new Map<string, Annotations>();
    const all = new Set(byPath.keys());
    const of = (p: string) => {
      const path = matchPath(p, all);
      if (path && !at.has(path)) at.set(path, { file: [], lines: [] });
      return path ? at.get(path)! : null;
    };
    for (const s of guide?.sections ?? []) {
      for (const n of s.fileNotes) of(n.path)?.file.push({ text: n.text, critical: n.critical });
      for (const n of s.lineNotes) of(n.path)?.lines.push({ old: n.side === "old", line: n.line, text: n.text, critical: n.critical });
    }
    // Risks found on the files shown: read at another head, their lines would be off.
    if (risks && risksOf.saved?.head === saved?.head)
      for (const r of risks) {
        const text = `Risk: ${r.title}${r.why ? `. ${r.why}` : ""}`;
        const critical = r.severity === "high";
        if (r.line) of(r.path)?.lines.push({ old: r.side === "old", line: r.line, text, critical });
        else of(r.path)?.file.push({ text, critical });
      }
    return at;
  }, [guide, byPath, risks, risksOf.saved, saved]);
  const counts = useMemo(() => {
    const at = new Map<Category, number>();
    for (const s of guide?.sections ?? []) at.set(s.category, (at.get(s.category) ?? 0) + 1);
    return at;
  }, [guide]);
  const highs = useMemo(() => guide?.sections.filter((s) => s.importance === "high").length ?? 0, [guide]);
  const [picked, setPicked] = useState(() => filters.get(id) ?? ALL);
  // Only while its button shows: a regenerated guide that has none to pick shows them all.
  const filter = counts.size > 1 && picked.category && counts.has(picked.category) ? picked.category : null;
  const total = guide?.sections.length ?? 0;
  const highOnly = picked.high && highs > 0 && highs < total;
  const filtered = !!filter || highOnly;
  const fits = (s: GuideSection) => (!filter || s.category === filter) && (!highOnly || s.importance === "high");
  const setFilter = (f: Filter) => {
    if (f.category || f.high) filters.set(id, f);
    else filters.delete(id);
    setPicked(f);
  };

  // Branch Review's own row for a file, while it reads the same commits and the file has no
  // uncommitted change: the same diff, so one viewed mark for both. Other files keep this guide's.
  const shared = useMemo(() => {
    if (sel.of !== "branch" || !saved || !status?.head || moved) return new Map<string, BranchChange>();
    const dirty = new Set([...status.staged, ...status.unstaged].map((f) => f.path));
    return new Map((branchRows ?? []).filter((r) => r.base === saved.base && !dirty.has(r.file.path)).map((r) => [r.file.path, r]));
  }, [sel.of, saved, status, moved, branchRows]);
  const markOf = (f: ListFile) => shared.get(f.file.path) ?? f;
  const isViewed = (f: ListFile) => viewed(markOf(f));
  const { scroller, block } = useStackedFiles({
    root,
    status,
    revision,
    viewed: isViewed,
    toggleViewed: (f) => toggleViewed(markOf(f)),
    // A range's files take no notes, as in Open All; a commit's are marked as on it.
    notes: sel.of === "commit" && byPath.size ? { at: `commit ${sel.commit.shortSha}` } : null,
    onOpen,
  });
  // Its diffs; none to wait for once the files couldn't be read.
  const diffs = (paths: string[] | undefined) => (paths ? paths.map((p) => block(byPath.get(p)!, annotations.get(p))) : fixed.error ? [] : null);
  const goTo = (n: number) => {
    // A section the filter hides (a diagram's link, Other changes): show them all first.
    const s = guide?.sections[n - 1];
    if (filtered && (!s || !fits(s))) flushSync(() => setFilter(ALL));
    const row = scroller.current?.querySelector(`[data-section="${n}"]`);
    row?.scrollIntoView({ block: "start" });
    row?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  };

  const running = run === "running";
  // Regenerating keeps the guide's style; Explain Simply (or Technically) switches it.
  const style = saved?.style ?? "technical";
  const generate = (as: GuideStyle = style) => void generateGuide(id, sel, as);
  const findingRisks = risksOf.run === "running";
  const find = () => void findRisks(id, sel);
  // What the agent is handed: the range a run read (the guide's, or the risks'), and the part asked about.
  const askOf = (range: { base: string; head: string; stamp?: string }, about: HandoffAbout): Ask => ({
    sel,
    branch,
    base: range.base,
    head: range.head,
    guide,
    about,
    checkedOut: isCheckedOut(sel, status?.head, range.head),
    moved: movedFrom(range),
  });
  // A risk's file, where the guide shows its diff; else in a tab of its own.
  const goToRisk = (r: Risk) => {
    const path = matchPath(r.path, new Set(byPath.keys()));
    const f = path ? byPath.get(path) : undefined;
    if (f) goToFile(f);
  };
  // A file the guide names by path (a rollout step's), where its diff is.
  const goToPath = (path: string) => {
    const at = matchPath(path, new Set(byPath.keys()));
    const f = at ? byPath.get(at) : undefined;
    if (f) goToFile(f);
  };
  // A file's diff in the guide, shown first if the filter hides its section; else its own tab.
  const goToFile = (f: ListFile) => {
    if (filtered) flushSync(() => setFilter(ALL));
    const block = scroller.current?.querySelector(`[data-file="${CSS.escape(selectionKey(f))}"]`);
    if (block) block.scrollIntoView({ block: "start" });
    else onOpen(f, true);
  };
  const found = risksOf.saved;
  const risksBlock = found && (
    <GuideRisks
      risks={risks}
      saved={found}
      outdated={movedFrom(found)}
      commit={sel.of === "changes" ? null : found.head}
      running={findingRisks}
      onFind={find}
      onGo={goToRisk}
      action={(r) => <AskAgentButton root={root} ask={() => askOf(found, { risk: r })} label="Send to Agent" what="this risk" question={false} />}
    />
  );
  const done = guide && saved ? guide.sections.filter((_, i) => saved.done.includes(i)).length : 0;
  const filesViewed = [...byPath.values()].filter(isViewed).length;
  const drawn = !!guide && (guide.models.length > 0 || guide.flows.length > 0 || !!guide.diagram);
  // Before and after differ only when the change adds or removes a part (or a call between them).
  const parts = guide && partCounts(guide);
  const sides = !!guide && !!parts && (parts.new > 0 || parts.removed > 0 || guide.flows.some((f) => f.edges.some((e) => e.status !== "same")));
  const shown = (guide?.sections ?? []).flatMap((section, i) => (fits(section) ? [{ n: i + 1, section, done: !!saved?.done.includes(i) }] : []));
  const nav = shown.length > 1;
  // The section hovered in the navigator or the diagram, which the diagram lights up.
  const [focused, setFocused] = useState<number | null>(null);
  const focus = { n: drawn ? focused : null, set: setFocused };
  // The left column: the sections, each with its files' tree; files no section placed under Other changes.
  const tree = (paths: string[] | undefined) =>
    paths?.length ? <GuideFiles files={paths.flatMap((p) => byPath.get(p) ?? [])} viewed={isViewed} onGo={goToFile} /> : undefined;
  const navItems = [
    ...shown.map((i) => ({ ...i, files: tree(placed?.shown[i.n - 1]) })),
    ...(placed?.rest.length && !filtered ? [{ n: 0, section: OTHER, done: false, files: tree(placed.rest) }] : []),
  ];
  const side = nav || byPath.size > 0;

  return (
    // Focusable so the keyboard can scroll it (focusPanel("code") lands here); diffs load as they near its view.
    <div ref={scroller} data-code-scroll tabIndex={0} className="@container relative h-full overflow-auto outline-none">
      <PageFind />
      {/* --stick: the narrow navigator's height, which the files' sticky headers keep below. */}
      <div className={cn("mx-auto max-w-[1440px] px-6 py-5", nav && "[--stick:36px] @6xl:[--stick:0px]")}>
        <header className="mb-5">
          <div className="flex items-start gap-3">
            <h1 className="min-w-0 flex-1 text-[20px] leading-snug font-semibold select-text">{guide?.title || copy.title}</h1>
            {saved && <AskAgentButton root={root} ask={() => askOf(saved, null)} what="this review" />}
            {!risksOf.saved && !findingRisks && (
              <Button size="sm" variant="secondary" onClick={find}>
                <Bug /> Find Risks
              </Button>
            )}
            {running ? (
              <Button size="sm" variant="secondary" onClick={() => cancelGuide(id)}>
                <Square /> Cancel
              </Button>
            ) : (
              <>
                <Tip label={style === "plain" ? "Rewrite it for a developer who knows the code" : "Rewrite it in plain words for someone new to the code: no jargon, a one-sentence answer first, a smaller diagram"}>
                  <Button size="sm" variant="secondary" onClick={() => generate(style === "plain" ? "technical" : "plain")}>
                    {style === "plain" ? <CodeXml /> : <Baby />} {style === "plain" ? "Explain Technically" : "Explain Simply"}
                  </Button>
                </Tip>
                <Button size="sm" variant="secondary" onClick={() => generate()}>
                  {saved ? <RotateCw /> : <Sparkles />} {saved ? "Regenerate" : `Ask ${program}`}
                </Button>
              </>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
            <Sparkles className="size-3.5 shrink-0 text-subtle" />
            {sel.of === "commit" ? (
              <span>
                <span className="font-mono">{sel.commit.shortSha}</span> by {sel.commit.authorName}, {relativeTime(sel.commit.timestamp)}
              </span>
            ) : sel.of === "commits" ? (
              <span>
                {sel.count} commits, <span className="font-mono">{sel.oldest.shortSha}</span> to <span className="font-mono">{sel.newest.shortSha}</span>
              </span>
            ) : sel.of === "changes" ? (
              <span>
                Uncommitted changes{branch && <> on <span className="font-mono">{branch}</span></>}
                {saved && (
                  <>
                    {" "}
                    against <span className="font-mono">{saved.base === EMPTY_TREE ? "no commit yet" : saved.base.slice(0, 7)}</span>
                  </>
                )}
              </span>
            ) : (
              <span>
                <span className="font-mono">{branch ?? "HEAD"}</span> since <span className="font-mono">{sel.label}</span>
                {saved && (
                  <>
                    {" "}
                    at <span className="font-mono">{saved.head.slice(0, 7)}</span>
                  </>
                )}
              </span>
            )}
            {saved && (
              <span>
                · written by {saved.program}
                {saved.details?.length ? ` (${saved.details.join(", ")})` : ""}, {relativeTime(saved.at / 1000)}
              </span>
            )}
            {guide && guide.sections.length > 0 && (
              <span>
                · <Count n={done} of={guide.sections.length} /> sections reviewed
              </span>
            )}
            {byPath.size > 0 && (
              <span title={sel.of === "branch" ? "Shared with Branch Review while it reads these same commits and the file has no uncommitted change; otherwise this review's own." : undefined}>
                · <Count n={filesViewed} of={byPath.size} /> files viewed
              </span>
            )}
            {style === "plain" && saved && <span>· Plain words</span>}
          </div>
          {guide && parts && <GuideStats counts={parts} stats={guide.stats} />}
        </header>

        {running && (
          <Notice role="status" icon={<LoaderCircle className="animate-spin" />}>
            Asking {program} to explain {copy.what}. It can take a few minutes, and it goes on while you look at other tabs.
          </Notice>
        )}
        {run === "stopped" && <Notice icon={<Square />}>Stopped before {program} was done{saved ? ": this is the guided review from before." : "."}</Notice>}
        {typeof run === "object" && run && (
          <Notice role="alert" icon={<TriangleAlert />} className="text-destructive">
            <span className="whitespace-pre-wrap">Couldn't write a guided review: {run.error}</span>
          </Notice>
        )}
        {moved && !running && (
          <Notice icon={<TriangleAlert />} className="text-modified">
            {sel.of === "changes" ? (
              "Outdated: the changes have moved since this review read them. Regenerate to review them as they are now."
            ) : (
              <>
                Outdated: {branch ?? "HEAD"} has moved since this review read it at <span className="font-mono">{saved.head.slice(0, 7)}</span>. Regenerate to review where it is now.
              </>
            )}
          </Notice>
        )}
        {fixed.error && (
          <Notice role="alert" icon={<TriangleAlert />} className="text-destructive">
            Couldn't read the files: {fixed.error}
          </Notice>
        )}
        <RisksRun program={program} run={risksOf.run} onCancel={() => cancelRisks(id)} />
        {/* Under the notices, where Find Risks said it was looking, above the guide or its absence. */}
        {risksBlock}

        {!saved ? (
          <>
            {!running && (
              <p className="text-[13px] text-muted-foreground">
                {program} reads {copy.reads} and explains it as sections in the order to review them, by category, with a sketch or diagram when one helps and how risky merging it is.
              </p>
            )}
          </>
        ) : !guide ? (
          <>
            <Notice icon={<TriangleAlert />}>The answer wasn't in the shape asked for; here it is as written.</Notice>
            <GuideMarkdown text={saved.text} />
          </>
        ) : (
          <div className={cn(side && "@6xl:grid @6xl:grid-cols-[240px_minmax(0,1fr)] @6xl:gap-6")}>
            {side && <GuideNav items={navItems} onGo={goTo} focus={focus} />}
            <div className="min-w-0">
              <div className={cn("mb-6 flex flex-col gap-5", nav && "mt-4 @6xl:mt-0")}>
                {(guide.summary || guide.sketch || guide.danger || guide.unknowns.length > 0 || guide.rollout.length > 0) && (
                  <div className="max-w-[880px] min-w-0">
                    <h2 className="mb-2 text-[13px] font-semibold">Overview</h2>
                    {guide.summary && <GuideMarkdown text={guide.summary} />}
                    {guide.sketch && <GuideSketch sketch={guide.sketch} />}
                    {guide.danger && <GuideDanger danger={guide.danger} />}
                    {guide.rollout.length > 0 && <GuideRollout steps={guide.rollout} onFile={goToPath} />}
                    {guide.unknowns.length > 0 && <GuideUnknowns unknowns={guide.unknowns} />}
                  </div>
                )}
                {drawn && (
                  <div className="min-w-0 rounded-lg border border-border p-3">
                    {/* Before and after side by side when the change adds or removes parts; else one picture of what changes. */}
                    {sides ? (
                      <div className="grid gap-4 @4xl:grid-cols-2">
                        {(["before", "after"] as const).map((side) => {
                          const part = sideOf(guide, side);
                          return (
                            <div key={side} className="min-w-0">
                              <h2 className="mb-3 text-[13px] font-semibold">{side === "before" ? "Before" : "After"}</h2>
                              {part.models.length || part.flows.length ? (
                                <GuideDiagram models={part.models} flows={part.flows} titles={titles} onSection={goTo} focus={focus} />
                              ) : (
                                <p className="text-[12px] text-subtle">{side === "before" ? "None of this was here: the change adds it all." : "None of this is left: the change removes it all."}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      (guide.models.length > 0 || guide.flows.length > 0) && (
                        <>
                          <h2 className="mb-3 text-[13px] font-semibold">What changes</h2>
                          <GuideDiagram models={guide.models} flows={guide.flows} titles={titles} onSection={goTo} focus={focus} />
                        </>
                      )
                    )}
                    {guide.diagram && (
                      // A guide from before structured diagrams.
                      <div className="markdown">
                        <Mermaid
                          code={guide.diagram}
                          fallback={
                            <pre>
                              <code>{guide.diagram}</code>
                            </pre>
                          }
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
              {(counts.size > 1 || (highs > 0 && highs < total)) && (
                <CategoryFilter
                  counts={counts}
                  total={total}
                  value={filter}
                  onChange={(category) => setFilter({ ...picked, category })}
                  high={highs > 0 && highs < total ? { count: highs, on: highOnly, onChange: (high) => setFilter({ ...picked, high }) } : null}
                />
              )}
              {!!placed?.rest.length && !filtered && (
                <Notice icon={<TriangleAlert />}>
                  {placed.rest.length === 1 ? "1 file wasn't" : `${placed.rest.length} files weren't`} placed in a section by {saved.program}.{" "}
                  <button className="text-primary hover:underline" onClick={() => goTo(0)}>
                    See them under Other changes
                  </button>
                </Notice>
              )}
              {shown.map(({ n, section, done }) => (
                <SectionRow
                  key={n}
                  n={n}
                  total={guide.sections.length}
                  section={section}
                  done={done}
                  onDone={(on) => markDone(id, n - 1, on)}
                  files={diffs(placed?.shown[n - 1])}
                  named={placed?.named[n - 1]}
                  onSection={goTo}
                  action={<AskAgentButton root={root} ask={() => askOf(saved, { section, n, total: guide.sections.length })} what="this section" />}
                />
              ))}
              {filtered && !shown.length && (
                <p className="text-[13px] text-muted-foreground">
                  No {filter && CATEGORY_UI[filter].label} section is high importance.{" "}
                  <button className="text-primary hover:underline" onClick={() => setFilter(ALL)}>
                    Show all
                  </button>
                </p>
              )}
              {!!placed?.rest.length && !filtered && <SectionRow n={0} section={OTHER} files={diffs(placed.rest)} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// After the repo changes: a burst of saves asks once.
const STAMP_WAIT = 800;

/**
 * The uncommitted changes' stamp now, asked again a moment after the repo changes; null while
 * unknown, or `on` is false. Not useAsyncValue: a burst of saves cancels the wait, and asks once.
 */
function useChangesStamp(on: boolean, revision: number) {
  const [stamp, setStamp] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return setStamp(null);
    let live = true;
    const t = window.setTimeout(() => api.changesStamp().then((s) => live && setStamp(s), () => {}), STAMP_WAIT);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [on, revision]);
  return stamp;
}

function Count({ n, of }: { n: number; of: number }) {
  return (
    <>
      <span className={cn("font-semibold", n === of ? "text-added" : "text-foreground")}>{n}</span> / {of}
    </>
  );
}
