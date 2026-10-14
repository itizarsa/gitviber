import { errorMessage } from "../api";
import { toast } from "../app/toast";

type Refresh = () => unknown;

/**
 * Runs an action that rewrites working-tree files (a restore, a revert, a stash's lines), and
 * says how it went: the files a merge left conflicts in, else where the old versions went.
 * `write` returns the conflicted files, if it can have any.
 */
export async function rewriteFiles(done: string, failed: string, write: () => Promise<string[] | void>, refresh: Refresh) {
  try {
    const conflicts = await write();
    const marked = conflicts?.length ? `Conflicts are marked in ${conflicts.join(", ")}.` : undefined;
    toast(marked ? "info" : "success", done, marked ?? "The versions it replaced are in the Trash.");
  } catch (e) {
    toast("error", failed, errorMessage(e));
  }
  await refresh();
}
