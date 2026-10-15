import { api, errorMessage } from "../api";
import { copyText } from "../app/clipboard";
import { toast } from "../app/toast";
import { effortOf, modelOf, presetOf, programOf, reviewAgent, SUGGEST_PRESETS } from "../git/suggest";
import { getSettings } from "../settings";
import { openTerminal } from "./terminals";

// Text handed to the agent CLI in a worktree's terminal, one way for every caller (a review's Ask
// Agent, a conflict's): a new session started with it.

/** The agent CLI's name for the user: Claude Code, or the program the command runs. */
export function agentName(command: string) {
  const program = programOf(command);
  return program.toLowerCase() === "claude" ? "Claude Code" : program || "your agent";
}

/**
 * Something handed to the agent and what's asked of it, as one prompt. Sent as it is (pasting, then
 * Enter, is the habit), with no question it has the agent say it's ready rather than answer one
 * that isn't there.
 */
export const asPrompt = (context: string, prompt: string | null) => `${context}\n\n${prompt ?? "My question follows. If none does, just say in one line that you're ready, and wait for it."}`;

export interface StartWith {
  /** The session's name in Claude Code. */
  name: string;
  /** Sent as it starts, or left in its prompt box. */
  send: boolean;
  /** The toast titles when another CLI gets it on the clipboard, and when Claude Code can't start. */
  copied: string;
  failed: string;
  /** Claude Code's model for this one (the question box's; "" the CLI's own), else the review agent's. */
  model?: string;
}

/**
 * The user's agent CLI (the review agent's command, Settings) in a new terminal tab of `root`: Claude
 * Code with `text` in its prompt box (handoff.rs), another CLI with it on the clipboard, as it has no
 * way in at start.
 */
export async function startAgentWith(root: string, text: string, how: StartWith) {
  const { command, models, efforts } = reviewAgent(getSettings());
  const preset = presetOf(command);
  if (programOf(command).toLowerCase() !== "claude") {
    // A preset's own session; llm and a custom command have none known.
    const program = preset && "session" in SUGGEST_PRESETS[preset] ? programOf(command) : null;
    void copyText(text, how.copied, program ? `Paste it into ${program}, starting in the terminal.` : "Paste it into your agent.");
    if (program) openTerminal(root, program);
    return;
  }
  try {
    // A preset's model and effort, as the review ran with; a custom command's are its own business.
    const line = await api.handoffCommand({
      command,
      model: (how.model ?? (preset && modelOf(preset, models))) || null,
      // Settings' effort is for Settings' model: another may not take it (haiku has no max).
      effort: (preset && (how.model === undefined || how.model === modelOf(preset, models)) && effortOf(preset, efforts)) || null,
      name: how.name,
      text,
      send: how.send,
    });
    openTerminal(root, line);
  } catch (e) {
    toast("error", how.failed, errorMessage(e));
  }
}
